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
// steps.md is. now feeds pluginsvc.Report but never reaches the
// committed bytes (goal 0391): the table shows the evidence commit
// dates only, never a "days behind" figure computed against now, so
// the same repo state renders identically whatever clock now is.
func GenerateMaturityMarkdown(repoRoot string, now func() time.Time) string {
	ledger := pluginsvc.Report(repoRoot, now)
	var b strings.Builder
	b.WriteString("---\nkind: reference\n---\n\n# Plugin API maturity\n\n")
	fmt.Fprintf(&b, "%s\n\n", ledger.Headline)
	b.WriteString("| Family | Level | Conformance | Example | E2E | Docs | SDK types | MCP | Code changed | Docs changed | Flags |\n")
	b.WriteString("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n")
	for _, r := range ledger.Rows {
		writeMaturityRow(&b, r)
	}
	b.WriteString("\n## How a family moves\n\n")
	b.WriteString("A family's level changes only by a decision recorded in an architecture record (ADR-0047, ADR-0048), never by this table alone, however complete its evidence reads. \"Ready to promote\" is an argument for that decision, not the decision itself. This table regenerates from the repository on every `go generate ./internal/docsgen` and is checked against the committed copy on every build. The control room dashboard renders a live \"days behind\" figure from the code/docs dates below; this page shows the dates themselves, never that figure, so the committed file never depends on the day it was generated.\n")
	return b.String()
}

func writeMaturityRow(b *strings.Builder, r pluginsvc.Row) {
	flags := "—"
	if len(r.Flags) > 0 {
		flags = strings.Join(r.Flags, ", ")
	}
	fmt.Fprintf(b, "| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |\n",
		r.Family,
		r.Level,
		yesNo(r.Evidence.Conformance),
		yesNo(r.Evidence.Example),
		yesNo(r.Evidence.E2E),
		yesNo(r.Evidence.Docs),
		yesNo(r.Evidence.SDKTypes),
		r.Evidence.MCP,
		dateOrDash(r.Currency.CodeChangedAt),
		dateOrDash(r.Currency.DocsChangedAt),
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
// a git-log dump. No generatedAt key: that field is a run-time fact
// (pluginsvc.Ledger.GeneratedAt), never a per-commit one, so it is
// left out rather than baked into a file `go generate` must reproduce
// byte-for-byte on an unchanged commit regardless of the day it runs.
// No daysBehindCode key either (goal 0391): that figure is a live
// staleness metric -- today vs codeChangedAt -- not a repo fact, so a
// reader (the control room dashboard) derives it from codeChangedAt/
// docsChangedAt at render time instead of this file storing a number
// that would need reverting every time an unrelated commit regenerated
// it on a different day.
type maturityJSONRow struct {
	Family        string   `json:"family"`
	Level         string   `json:"level"`
	Conformance   bool     `json:"conformance"`
	Example       bool     `json:"example"`
	E2E           bool     `json:"e2e"`
	Docs          bool     `json:"docs"`
	SDKTypes      bool     `json:"sdkTypes"`
	MCP           string   `json:"mcp"`
	CodeCommit    string   `json:"codeCommit,omitempty"`
	CodeChangedAt string   `json:"codeChangedAt,omitempty"`
	DocsCommit    string   `json:"docsCommit,omitempty"`
	DocsChangedAt string   `json:"docsChangedAt,omitempty"`
	Flags         []string `json:"flags"`
}

type maturityJSONLedger struct {
	Headline string            `json:"headline"`
	Rows     []maturityJSONRow `json:"rows"`
}

func dateOrEmpty(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format("2006-01-02")
}

// dateOrDash is dateOrEmpty rendered for the markdown table, where an
// empty cell reads as a missing column rather than "no docs page yet".
func dateOrDash(t time.Time) string {
	s := dateOrEmpty(t)
	if s == "" {
		return "—"
	}
	return s
}

// GenerateMaturityJSON renders the same ledger as machine-readable
// JSON -- the control room dashboard's own source (scripts/dashboard),
// so a person and an agent read the identical facts. now feeds
// pluginsvc.Report but never reaches the committed bytes, the same
// guarantee GenerateMaturityMarkdown makes (goal 0391).
func GenerateMaturityJSON(repoRoot string, now func() time.Time) (string, error) {
	ledger := pluginsvc.Report(repoRoot, now)
	out := maturityJSONLedger{
		Headline: ledger.Headline,
		Rows:     make([]maturityJSONRow, 0, len(ledger.Rows)),
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
			CodeCommit:    r.Currency.CodeCommit,
			CodeChangedAt: dateOrEmpty(r.Currency.CodeChangedAt),
			DocsCommit:    r.Currency.DocsCommit,
			DocsChangedAt: dateOrEmpty(r.Currency.DocsChangedAt),
			Flags:         flags,
		})
	}
	raw, err := json.MarshalIndent(out, "", "  ")
	if err != nil {
		return "", fmt.Errorf("marshal maturity ledger: %w", err)
	}
	return string(raw) + "\n", nil
}
