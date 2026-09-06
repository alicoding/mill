package pluginsvc

import (
	"fmt"
	"strings"

	"github.com/Masterminds/semver/v3"
)

// How a policy judges one extension (docs/goals/0349 S6). The order is
// fixed and the first refusal wins: the block list, then the exclusive
// allow list, then the required tier, then the blocked capabilities.
// Every refusal is one sentence the row, the detail pane and the
// install prompt show verbatim.

// PolicySubject is what the policy sees of an extension: the facts a
// manifest, an install receipt and a signature check answer.
type PolicySubject struct {
	ID           string
	Version      string
	Tier         string
	Capabilities []string
	// PublisherKeyID is the id of the policy key that verified this
	// folder's signature, 0 when none did.
	PublisherKeyID uint64
	Builtin        bool
}

// capabilityDeeds names each capability the way a refusal sentence
// reads it: what the extension could DO, in the reader's words.
var capabilityDeeds = map[string]string{
	"fetch":             "reach the network",
	"write-content":     "write cards and notes",
	"open-url":          "open links",
	"open-app":          "open other apps",
	"list-files":        "list files",
	"read-file":         "read files",
	"erase-board-items": "erase board items",
}

// Refusal answers why the policy refuses the subject, "" when it does
// not. A built-in is Mill's own code and is never refused.
func (p Policy) Refusal(s PolicySubject) string {
	if s.Builtin {
		return ""
	}
	if reason := p.listRefusal(s); reason != "" {
		return reason
	}
	if reason := p.tierRefusal(s); reason != "" {
		return reason
	}
	return p.capabilityRefusal(s)
}

// listRefusal applies the two lists: the block list always wins, and a
// non-empty allow list refuses everything it does not name.
func (p Policy) listRefusal(s PolicySubject) string {
	if rule, ok := firstMatch(p.Block, s, true); ok {
		if rule.Versions != "" {
			return fmt.Sprintf("Your organisation blocks version %s of this extension.", s.Version)
		}
		return "Your organisation blocks this extension."
	}
	if len(p.Allow) > 0 {
		if _, ok := firstMatch(p.Allow, s, false); !ok {
			return "Your organisation allows only the extensions on its list."
		}
	}
	return ""
}

// tierRefusal applies requiredTier: a folder below the required tier
// is refused with the tier's sentence.
func (p Policy) tierRefusal(s PolicySubject) string {
	if tierMeets(s.Tier, p.RequiredTier) {
		return ""
	}
	if p.RequiredTier == TierVerified {
		return "Your organisation requires extensions to be verified."
	}
	return "Your organisation requires extensions to be hash-pinned or verified."
}

// capabilityRefusal applies blockedCapabilities: one declared
// capability on the organisation's blocked list refuses the extension,
// with the deed the capability grants named in the sentence.
func (p Policy) capabilityRefusal(s PolicySubject) string {
	for _, blocked := range p.BlockedCapabilities {
		for _, c := range s.Capabilities {
			if c == blocked {
				return fmt.Sprintf("Your organisation blocks extensions that can %s.", capabilityDeeds[c])
			}
		}
	}
	return ""
}

// firstMatch finds the first rule naming the subject. failClosed
// decides what a version range means for a version that does not
// parse: a block rule treats it as matched, an allow rule as not.
func firstMatch(rules []PolicyRule, s PolicySubject, failClosed bool) (PolicyRule, bool) {
	for _, r := range rules {
		if r.ID != "" && r.ID != s.ID {
			continue
		}
		if r.PublisherKey != "" && !keyMatches(r.PublisherKey, s.PublisherKeyID) {
			continue
		}
		if r.Versions != "" && !versionMatches(r.Versions, s.Version, failClosed) {
			continue
		}
		return r, true
	}
	return PolicyRule{}, false
}

func keyMatches(text string, keyID uint64) bool {
	if keyID == 0 {
		return false
	}
	for _, pk := range (Policy{Allow: []PolicyRule{{PublisherKey: text}}}).publisherKeys() {
		if pk.ID() == keyID {
			return true
		}
	}
	return false
}

func versionMatches(rangeText, version string, failClosed bool) bool {
	c, err := semver.NewConstraint(rangeText)
	if err != nil {
		return failClosed
	}
	v, err := semver.NewVersion(strings.TrimPrefix(strings.TrimSpace(version), "v"))
	if err != nil {
		return failClosed
	}
	return c.Check(v)
}

// tierRank orders the tiers the way requiredTier compares them: a
// verified folder satisfies every requirement, a dev folder none but
// "any".
var tierRank = map[string]int{TierVerified: 3, TierHashPinned: 2, TierUnverified: 1, TierDev: 0}

func tierMeets(tier, required string) bool {
	if required == "" || required == TierAny {
		return true
	}
	return tierRank[tier] >= tierRank[required]
}

// SourceAllowed answers whether an install may come from marketplace
// (its index name) or, for a link install, from locator (the pasted
// repo, address or folder). An empty allowedSources list allows every
// source; a non-empty one allows a listed marketplace name, and a
// listed address that the locator starts with.
func (p Policy) SourceAllowed(marketplace, locator string) bool {
	if len(p.AllowedSources) == 0 {
		return true
	}
	for _, allowed := range p.AllowedSources {
		if marketplace != "" && allowed == marketplace {
			return true
		}
		if locator != "" && (allowed == locator || strings.HasPrefix(locator, strings.TrimSuffix(allowed, "/")+"/")) {
			return true
		}
	}
	return false
}

// SourceRefusal is the sentence a refused source shows.
func (p Policy) SourceRefusal() string {
	return fmt.Sprintf("Your organisation allows installs only from %s.", strings.Join(p.AllowedSources, ", "))
}
