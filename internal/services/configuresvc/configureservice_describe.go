package configuresvc

import (
	"fmt"
	"strings"

	"github.com/alicoding/mill/internal/domain/httprequest"
	"github.com/alicoding/mill/internal/domain/vaultref"
)

// The reference peek (goal 0312): a step's reference field can show
// what the chosen entity IS without leaving the canvas, and say when
// it cannot work. One door for every Configure kind, answering the
// entity's own identifying fields as label/value lines plus the
// problems its own existing checks already know (a request whose auth
// needs a secret the keychain lacks; a header or env value naming a
// vault entry that no longer exists). Never a second validation.

// SummaryLine is one label/value pair of a reference summary.
type SummaryLine struct {
	Label string `json:"label"`
	Value string `json:"value"`
}

// ReferenceSummary is what the peek renders.
type ReferenceSummary struct {
	Kind     string        `json:"kind"`
	ID       string        `json:"id"`
	Label    string        `json:"label"`
	Lines    []SummaryLine `json:"lines"`
	Problems []string      `json:"problems"`
}

// DescribeReference answers a summary for kind (a ConfigField RefKind)
// and id. An unknown kind or id is an error naming it.
func (c *ConfigureService) DescribeReference(kind, id string) (ReferenceSummary, error) {
	out := ReferenceSummary{Kind: kind, ID: id, Lines: []SummaryLine{}, Problems: []string{}}
	var ok bool
	switch kind {
	case "request":
		ok = c.describeRequest(&out)
	case "list":
		ok = c.describeList(&out)
	case "mcpserver":
		ok = c.describeMCPServer(&out)
	case "decision":
		ok = c.describeDecision(&out)
	case "execenv":
		ok = c.describeExecEnv(&out)
	case "aiprovider":
		ok = c.describeAIProvider(&out)
	case "conversionprofile":
		ok = c.describeConversionProfile(&out)
	default:
		return out, fmt.Errorf("no summary for references of kind %q", kind)
	}
	if !ok {
		return out, fmt.Errorf("no %s with id %q", kind, id)
	}
	return out, nil
}

func (c *ConfigureService) describeRequest(out *ReferenceSummary) bool {
	var found *httprequest.HTTPRequest
	for _, r := range c.HTTPRequests() {
		if r.ID == out.ID {
			rr := r
			found = &rr
			break
		}
	}
	if found == nil {
		return false
	}
	out.Label = found.Label
	method := found.Method
	if method == "" {
		method = "GET"
	}
	out.Lines = append(out.Lines,
		SummaryLine{Label: "Address", Value: found.BaseURL},
		SummaryLine{Label: "Method", Value: method},
		SummaryLine{Label: "Auth", Value: authLabel(found.AuthType)},
	)
	if found.AuthType != httprequest.AuthNone && strings.TrimSpace(string(found.AuthType)) != "" {
		if missing, _ := c.RequestCredentialGap(found.ID); missing {
			out.Lines = append(out.Lines, SummaryLine{Label: "Secret", Value: "Missing"})
			out.Problems = append(out.Problems, "No secret is stored for this auth. Open the integration and add it.")
		} else {
			out.Lines = append(out.Lines, SummaryLine{Label: "Secret", Value: "Stored"})
		}
	}
	for name, value := range found.Headers {
		if problem := c.vaultRefProblem("Header "+name, value); problem != "" {
			out.Problems = append(out.Problems, problem)
		}
	}
	return true
}

func authLabel(t httprequest.AuthType) string {
	switch t {
	case "", httprequest.AuthNone:
		return "None"
	case httprequest.AuthAPIKey:
		return "API key"
	case httprequest.AuthBearer:
		return "Bearer token"
	case httprequest.AuthHMAC:
		return "HMAC"
	case httprequest.AuthQueryParam:
		return "Query parameter"
	case httprequest.AuthMTLS:
		return "Mutual TLS"
	}
	return string(t)
}

// vaultRefProblem names a "vault:<id>" value whose entry is gone; ""
// for a plain value, an env/provider reference, or a live entry.
func (c *ConfigureService) vaultRefProblem(what, value string) string {
	provider, ref, ok := vaultref.Split(strings.TrimSpace(value))
	if !ok || provider != vaultref.ProviderVault {
		return ""
	}
	entries, err := c.secretLabelsLister()
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if e.ID == ref {
			return ""
		}
	}
	return what + " points at a secret that no longer exists."
}

func (c *ConfigureService) describeList(out *ReferenceSummary) bool {
	for _, l := range c.Lists() {
		if l.ID != out.ID {
			continue
		}
		out.Label = l.Label
		names := make([]string, 0, len(l.Columns))
		for _, col := range l.Columns {
			names = append(names, col.Label)
		}
		out.Lines = append(out.Lines,
			SummaryLine{Label: "Columns", Value: strings.Join(names, ", ")},
			SummaryLine{Label: "Rows", Value: fmt.Sprint(len(l.Rows))},
		)
		return true
	}
	return false
}

func (c *ConfigureService) describeMCPServer(out *ReferenceSummary) bool {
	for _, s := range c.MCPServers() {
		if s.ID != out.ID {
			continue
		}
		out.Label = s.Label
		out.Lines = append(out.Lines, SummaryLine{Label: "Command", Value: strings.TrimSpace(s.Command + " " + strings.Join(s.Args, " "))})
		for _, kv := range s.Env {
			name, value, _ := strings.Cut(kv, "=")
			if problem := c.vaultRefProblem("Environment "+name, value); problem != "" {
				out.Problems = append(out.Problems, problem)
			}
		}
		return true
	}
	return false
}

func (c *ConfigureService) describeDecision(out *ReferenceSummary) bool {
	for _, d := range c.Decisions() {
		if d.ID != out.ID {
			continue
		}
		out.Label = d.Label
		out.Lines = append(out.Lines,
			SummaryLine{Label: "Category", Value: string(d.Category)},
			SummaryLine{Label: "Outputs", Value: fmt.Sprint(len(d.Outputs))},
		)
		return true
	}
	return false
}

func (c *ConfigureService) describeExecEnv(out *ReferenceSummary) bool {
	for _, e := range c.ExecEnvs() {
		if e.ID != out.ID {
			continue
		}
		out.Label = e.Label
		out.Lines = append(out.Lines,
			SummaryLine{Label: "Shell", Value: string(e.Shell)},
			SummaryLine{Label: "Directory", Value: e.Dir},
		)
		for _, kv := range e.Env {
			name, value, _ := strings.Cut(kv, "=")
			if problem := c.vaultRefProblem("Environment "+name, value); problem != "" {
				out.Problems = append(out.Problems, problem)
			}
		}
		return true
	}
	return false
}

func (c *ConfigureService) describeAIProvider(out *ReferenceSummary) bool {
	for _, p := range c.AIProviders() {
		if p.ID != out.ID {
			continue
		}
		out.Label = p.Label
		out.Lines = append(out.Lines,
			SummaryLine{Label: "Kind", Value: string(p.Kind)},
			SummaryLine{Label: "Model", Value: p.Model},
			SummaryLine{Label: "Address", Value: p.BaseURL},
		)
		return true
	}
	return false
}

func (c *ConfigureService) describeConversionProfile(out *ReferenceSummary) bool {
	for _, p := range c.ConversionProfiles() {
		if p.ID != out.ID {
			continue
		}
		out.Label = p.Label
		rules := "Stock converter only"
		if len(p.RuleSets) > 0 {
			rules = strings.Join(p.RuleSets, ", ")
		}
		out.Lines = append(out.Lines, SummaryLine{Label: "Rules applied", Value: rules})
		return true
	}
	return false
}
