package atlassvc

import (
	"fmt"
	"net/url"
	"strings"
)

// Recognized sources (goal 0126): a card whose Source URL host matches
// a configured Integration's base-URL host is "recognized" -- the
// match falls out of configuration the user already did, never a
// separate pattern registry (named revisit trigger: a real case that
// outgrows host matching). Both lookups arrive as injected funcs from
// main.go (WireSourceRecognition), the same seam shape
// WireCompositionSeams uses -- no service-to-service import.

// RecognizedIntegration is one host-matched Integration entity.
type RecognizedIntegration struct {
	RequestID string
	Label     string
	Host      string
}

// OfferedAction is one workflow declared for the matched Integration.
type OfferedAction struct {
	WorkflowID string
	Label      string
}

// CardSourceOffer is what the card page renders: the recognition chip
// (integration label) plus the offered-action rows.
type CardSourceOffer struct {
	Recognized bool
	RequestID  string
	Label      string
	Workflows  []OfferedAction
}

type integrationHostsFn func() []RecognizedIntegration
type offeredWorkflowsFn func(requestID string) []OfferedAction

// WireSourceRecognition injects the Configure-side host index and the
// composition-side offer lookup. Called once from main.go.
//
//wails:ignore
func (a *AtlasService) WireSourceRecognition(hosts integrationHostsFn, offers offeredWorkflowsFn) {
	a.integrationHosts = hosts
	a.offeredWorkflows = offers
}

// CardSourceOffer resolves a card's recognition state: whether its
// Source URL host matches a configured Integration, and which
// workflows declare that Integration as their offer target.
func (a *AtlasService) CardSourceOffer(cardID string) (CardSourceOffer, error) {
	a.mu.RLock()
	idx := a.findCardLocked(cardID)
	if idx == -1 {
		a.mu.RUnlock()
		return CardSourceOffer{}, fmt.Errorf("no card with id %q", cardID)
	}
	source := a.cards[idx].Source
	a.mu.RUnlock()

	if source == "" || a.integrationHosts == nil {
		return CardSourceOffer{}, nil
	}
	host := hostOf(source)
	if host == "" {
		return CardSourceOffer{}, nil
	}
	return a.offerForHost(host), nil
}

// offerForHost joins the host match with the offer declarations.
// Several Integrations can share one host (a Confluence and a Jira on
// the same on-prem box is the normal enterprise shape) -- the offer
// set is the UNION across every match; the chip names the first match.
func (a *AtlasService) offerForHost(host string) CardSourceOffer {
	var offer CardSourceOffer
	seen := map[string]bool{}
	for _, integ := range a.integrationHosts() {
		if integ.Host == "" || !strings.EqualFold(integ.Host, host) {
			continue
		}
		if !offer.Recognized {
			offer = CardSourceOffer{Recognized: true, RequestID: integ.RequestID, Label: integ.Label}
		}
		offer.Workflows = appendNewOffers(offer.Workflows, seen, a.lookupOffers(integ.RequestID))
	}
	return offer
}

func (a *AtlasService) lookupOffers(requestID string) []OfferedAction {
	if a.offeredWorkflows == nil {
		return nil
	}
	return a.offeredWorkflows(requestID)
}

func appendNewOffers(out []OfferedAction, seen map[string]bool, more []OfferedAction) []OfferedAction {
	for _, w := range more {
		if !seen[w.WorkflowID] {
			seen[w.WorkflowID] = true
			out = append(out, w)
		}
	}
	return out
}

// hostOf extracts a URL's lowercase hostname (port stripped) -- "" for
// anything unparseable or host-less, which simply never matches.
func hostOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// workflowOfferedForCard reports whether workflowID is among the
// card's recognized-source offers -- RunCardAction's second legality
// path beside explicit attachment.
func (a *AtlasService) workflowOfferedForCard(cardID, workflowID string) bool {
	offer, err := a.CardSourceOffer(cardID)
	if err != nil || !offer.Recognized {
		return false
	}
	for _, w := range offer.Workflows {
		if w.WorkflowID == workflowID {
			return true
		}
	}
	return false
}
