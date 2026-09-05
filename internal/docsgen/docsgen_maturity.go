package docsgen

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/alicoding/mill/internal/services/pluginsvc"
)

// GenerateMaturityMarkdown renders the plugin API maturity ledger
// (goal 0348) wholesale -- no hand-authored region to preserve, unlike
// commands.md/menu-bar.md, so the whole file is generated the same way
// steps.md is.
func GenerateMaturityMarkdown(repoRoot string) string {
	ledger := pluginsvc.Report(repoRoot)
	var b strings.Builder
	b.WriteString("# Plugin API maturity\n\n")
	fmt.Fprintf(&b, "%s\n\n", ledger.Headline)
	b.WriteString("| Family | Level | Conformance | Example | E2E | Docs | SDK types | MCP | Docs behind code (days) | Flags |\n")
	b.WriteString("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n")
	for _, r := range ledger.Rows {
		writeMaturityRow(&b, r)
	}
	b.WriteString("\n## How a family moves\n\n")
	b.WriteString("A family's level changes only by a decision recorded in an architecture record (ADR-0047, ADR-0048), never by this table alone, however complete its evidence reads. \"Ready to promote\" is an argument for that decision, not the decision itself. This table regenerates from the repository on every `go generate ./internal/docsgen` and is checked against the committed copy on every build.\n")
	return b.String()
}

func writeMaturityRow(b *strings.Builder, r pluginsvc.Row) {
	flags := "—"
	if len(r.Flags) > 0 {
		flags = strings.Join(r.Flags, ", ")
	}
	fmt.Fprintf(b, "| %s | %s | %s | %s | %s | %s | %s | %s | %d | %s |\n",
		r.Family,
		r.Level,
		yesNo(r.Evidence.Conformance),
		yesNo(r.Evidence.Example),
		yesNo(r.Evidence.E2E),
		yesNo(r.Evidence.Docs),
		yesNo(r.Evidence.SDKTypes),
		r.Evidence.MCP,
		r.Currency.DaysBehind,
		flags,
	)
}

func yesNo(v bool) string {
	if v {
		return "yes"
	}
	return "no"
}

// maturityJSONRow/maturityJSONLedger are the JSON ledger's own wire
// shape -- dates render as YYYY-MM-DD (goal 0348's decided design),
// never a full timestamp, so the committed file reads as a ledger, not
// a git-log dump.
type maturityJSONRow struct {
	Family        string   `json:"family"`
	Level         string   `json:"level"`
	Conformance   bool     `json:"conformance"`
	Example       bool     `json:"example"`
	E2E           bool     `json:"e2e"`
	Docs          bool     `json:"docs"`
	SDKTypes      bool     `json:"sdkTypes"`
	MCP           string   `json:"mcp"`
	CodeChangedAt string   `json:"codeChangedAt,omitempty"`
	DocsChangedAt string   `json:"docsChangedAt,omitempty"`
	DaysBehind    int      `json:"daysBehindCode"`
	Flags         []string `json:"flags"`
}

type maturityJSONLedger struct {
	GeneratedAt string            `json:"generatedAt"`
	Headline    string            `json:"headline"`
	Rows        []maturityJSONRow `json:"rows"`
}

func dateOrEmpty(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01-02")
}

// GenerateMaturityJSON renders the same ledger as machine-readable
// JSON -- the control room dashboard's own source (scripts/dashboard),
// so a person and an agent read the identical facts.
func GenerateMaturityJSON(repoRoot string) (string, error) {
	ledger := pluginsvc.Report(repoRoot)
	out := maturityJSONLedger{
		GeneratedAt: dateOrEmpty(ledger.GeneratedAt),
		Headline:    ledger.Headline,
		Rows:        make([]maturityJSONRow, 0, len(ledger.Rows)),
	}
	for _, r := range ledger.Rows {
		flags := r.Flags
		if flags == nil {
			flags = []string{}
		}
		out.Rows = append(out.Rows, maturityJSONRow{
			Family:        r.Family,
			Level:         string(r.Level),
			Conformance:   r.Evidence.Conformance,
			Example:       r.Evidence.Example,
			E2E:           r.Evidence.E2E,
			Docs:          r.Evidence.Docs,
			SDKTypes:      r.Evidence.SDKTypes,
			MCP:           r.Evidence.MCP,
			CodeChangedAt: dateOrEmpty(r.Currency.CodeChangedAt),
			DocsChangedAt: dateOrEmpty(r.Currency.DocsChangedAt),
			DaysBehind:    r.Currency.DaysBehind,
			Flags:         flags,
		})
	}
	raw, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal maturity ledger: %w", err)
	}
	return string(raw) + "\n", nil
}
