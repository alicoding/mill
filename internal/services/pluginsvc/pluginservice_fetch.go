package pluginsvc

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/alicoding/mill/internal/adapters/httpconnector"
	"github.com/alicoding/mill/internal/domain/secret"
	"github.com/alicoding/mill/internal/services/guardrailsvc"
)

// The plugin network door (docs/goals/0288): a plugin with the "fetch"
// capability asks Mill to perform an HTTP request against a host its
// manifest declares. The ask is a guarded action (kind net.fetch) the
// owner's rules allow, park, or deny exactly like an agent's write;
// on approval Mill executes it confined to the declared host on
// every hop and hands back the response. Split from pluginservice.go
// along the capability seam (the file-size convention).

// FetchKind is the guardrail action kind a plugin fetch is evaluated
// under; its attributes are host, method, and url.
const FetchKind = "net.fetch"

// fetchMaxBody caps a response a plugin may receive: enough for any
// API payload, small enough that a plugin cannot pull a file dump
// through the door.
const fetchMaxBody int64 = 4 << 20

var hostPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$`)

var allowedMethods = map[string]bool{"GET": true, "HEAD": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true}

// validateNetwork fail-closes a contributes.network block like every
// other contribution: a malformed host or an unknown method blocks
// the load with the reason named.
// AnyHost is the network declaration whose meaning is fixed (docs/
// goals/0291): a request to a host the manifest does not otherwise
// declare is ALWAYS a live ask, never rule-allowable -- an any-host
// plugin can never be made silent.
const AnyHost = "*"

func validateNetwork(entries []NetworkContribution) string {
	for _, n := range entries {
		if n.Host != AnyHost && !hostPattern.MatchString(n.Host) {
			return fmt.Sprintf("contributed network host %q must be a lowercase hostname with an optional port", n.Host)
		}
		for _, m := range n.Methods {
			if !allowedMethods[strings.ToUpper(m)] {
				return fmt.Sprintf("contributed network host %q lists unknown method %q", n.Host, m)
			}
		}
	}
	return ""
}

// PluginFetchRequest is what a plugin asks for; Headers and Body are
// the plugin's own (a credential belongs in the vault -- goal 0281's
// secretRef -- never here; nothing stops a plugin from passing a
// token it holds, but the description in Review names the host so
// whoever decides in Review sees where it goes).
type PluginFetchRequest struct {
	Method  string            `json:"method"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Body    string            `json:"body"`
	// Secret names a declared secretRef setting whose vault entry Mill
	// attaches host-side (pluginservice_fetch_secret.go); nil sends
	// the request exactly as given.
	Secret *PluginFetchSecret `json:"secret"`
}

// PluginFetchResult carries the guardrail decision and, when
// approved and performed, the response.
type PluginFetchResult struct {
	Approved  bool              `json:"approved"`
	Effect    string            `json:"effect"`
	RuleLabel string            `json:"ruleLabel"`
	Status    int               `json:"status"`
	Headers   map[string]string `json:"headers"`
	Body      string            `json:"body"`
}

// FetchForPlugin performs one guarded fetch. Refusals that need no
// rule -- undeclared capability, undeclared host, undeclared method,
// a non-http(s) URL -- happen BEFORE the guardrail is consulted.
func (p *PluginService) FetchForPlugin(pluginID string, req PluginFetchRequest) (PluginFetchResult, error) {
	plugin := p.resolvePlugin(pluginID)
	if plugin.Error != "" {
		return PluginFetchResult{}, fmt.Errorf("plugin %q: %s", pluginID, plugin.Error)
	}
	if !hasCapability(plugin.Manifest, "fetch") {
		return PluginFetchResult{}, fmt.Errorf("plugin %q does not declare the \"fetch\" capability in its manifest", pluginID)
	}
	method := strings.ToUpper(strings.TrimSpace(req.Method))
	if method == "" {
		method = "GET"
	}
	host, err := hostOf(req.URL)
	if err != nil {
		return PluginFetchResult{}, err
	}
	network := plugin.Manifest.Contributes.Network
	declared := networkAllows(network, host, method)
	anyHost := !declared && networkAllows(network, AnyHost, method)
	if !declared && !anyHost {
		return PluginFetchResult{}, fmt.Errorf("plugin %q does not declare %s %s in its manifest's contributes.network", pluginID, method, host)
	}
	// Confinement is to the host being asked about (redirects included):
	// a wildcard plugin still cannot hop to a second host silently.
	allowHost := func(h string) bool { return h == host || networkAllows(network, h, method) }
	sec, err := p.secretForFetch(plugin, req)
	if err != nil {
		return PluginFetchResult{}, err
	}
	if p.guardrail == nil {
		return PluginFetchResult{}, errors.New("guardrail unavailable: a plugin fetch is always guarded")
	}
	action := guardrailsvc.GuardedAction{
		Kind:        FetchKind,
		Attributes:  map[string]string{"host": host, "method": method, "url": req.URL, "declared": strconv.FormatBool(declared)},
		Description: fmt.Sprintf("%s %s", method, host),
		Source:      "plugin:" + pluginID,
	}
	if sec != nil {
		// The secret's TITLE is the rule vocabulary and the Review
		// wording; the value is resolved only after approval.
		action.Attributes["secret"] = sec.title
		action.Description += fmt.Sprintf(" · uses secret ‘%s’", sec.title)
	}
	var decision guardrailsvc.Decision
	if anyHost {
		// Undeclared host under "*": always a live ask, rules skipped.
		action.Description += " (a host this plugin did not declare)"
		decision, err = p.guardrail.AskGuardedAction(context.Background(), action)
	} else {
		decision, err = p.guardrail.RequestGuardedAction(context.Background(), action)
	}
	if err != nil {
		return PluginFetchResult{}, err
	}
	out := PluginFetchResult{Approved: decision.Approved, Effect: string(decision.Effect), RuleLabel: decision.RuleLabel}
	if !decision.Approved {
		return out, nil
	}
	headers := req.Headers
	value := ""
	if sec != nil {
		value, err = p.secretRefs.Resolve(sec.id, pluginID)
		if err != nil {
			return out, fmt.Errorf("fetch: secret ‘%s’: %w", sec.title, err)
		}
		headers = withSecretHeader(headers, sec, value)
	}
	resp, err := httpconnector.ExecuteConfined(httpconnector.Request{Method: method, URL: req.URL, Headers: headers, Body: req.Body}, allowHost, fetchMaxBody)
	if err != nil {
		return out, fmt.Errorf("fetch: %s", secret.Redact([]string{value}, err.Error()))
	}
	out.Status = resp.StatusCode
	out.Headers = resp.Headers
	out.Body = resp.Body
	redactSecret(&out, value)
	return out, nil
}

func hasCapability(m Manifest, cap string) bool {
	for _, c := range m.Capabilities {
		if c == cap {
			return true
		}
	}
	return false
}

func hostOf(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "https" && u.Scheme != "http" {
		return "", fmt.Errorf("only http(s) URLs can be fetched, got %q", u.Scheme)
	}
	if u.Host == "" {
		return "", errors.New("URL has no host")
	}
	return strings.ToLower(u.Host), nil
}

// networkAllows answers whether the manifest declares host for method
// (an entry with no methods means GET only). Asking about AnyHost
// answers whether the wildcard entry exists for that method.
func networkAllows(entries []NetworkContribution, host, method string) bool {
	for _, n := range entries {
		if n.Host != host {
			continue
		}
		if len(n.Methods) == 0 {
			return method == "GET"
		}
		for _, m := range n.Methods {
			if strings.ToUpper(m) == method {
				return true
			}
		}
	}
	return false
}
