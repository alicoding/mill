package docsgen

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// TestUserDocs_MaturityMatchesCommitted is the tfplugindocs freshness
// pattern (docsgen_test.go's TestUserDocs_MatchCommitted) applied to
// the maturity ledger, with one deliberate exception: the per-row
// commit/date columns are excluded from the byte comparison. Those
// fields are derived from `git log` against the checkout's own
// history (maturity_currency.go), and CI's test-go job checks out at
// fetch-depth 1 -- a shallow clone answers `git log -- <path>` with
// the checkout's own single commit for any path that commit's tree
// carries, not the path's true last commit, so the value this job
// computes always differs from what a full local clone committed. The
// rest of the ledger (family list, level, every evidence cell, flags)
// has no such dependency and is still byte-exact. Fix a real drift
// with `go generate ./internal/docsgen`.
func TestUserDocs_MaturityMatchesCommitted(t *testing.T) {
	repoRoot := filepath.Join("..", "..")
	mdPath := filepath.Join(repoRoot, "userdocs", "reference", "plugin-api-maturity.md")
	jsonPath := filepath.Join(repoRoot, "userdocs", "reference", "plugin-api-maturity.json")

	wantMD := GenerateMaturityMarkdown(repoRoot, time.Now)
	gotMD, err := os.ReadFile(mdPath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		t.Fatalf("read plugin-api-maturity.md: %v", err)
	}
	if redactMaturityDateColumns(string(gotMD)) != redactMaturityDateColumns(wantMD) {
		t.Errorf("plugin-api-maturity.md is stale (ignoring the code/docs-changed columns) -- run `go generate ./internal/docsgen` and commit the result")
	}

	wantJSON, err := GenerateMaturityJSON(repoRoot, time.Now)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json: %v", err)
	}
	gotJSON, err := os.ReadFile(jsonPath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		t.Fatalf("read plugin-api-maturity.json: %v", err)
	}
	wantLedger, err := parseMaturityJSONForFreshness(wantJSON)
	if err != nil {
		t.Fatalf("parse generated plugin-api-maturity.json: %v", err)
	}
	gotLedger, err := parseMaturityJSONForFreshness(string(gotJSON))
	if err != nil {
		t.Fatalf("parse committed plugin-api-maturity.json: %v", err)
	}
	if !reflect.DeepEqual(gotLedger, wantLedger) {
		t.Errorf("plugin-api-maturity.json is stale (ignoring codeCommit/codeChangedAt/docsCommit/docsChangedAt) -- run `go generate ./internal/docsgen` and commit the result\ncommitted: %+v\ngenerated: %+v", gotLedger, wantLedger)
	}
}

// TestGenerateMaturityJSON_OmitsGeneratedAt pins the wire schema
// decision docsgen_maturity.go's comment states: generatedAt is a
// run-time fact, never a per-commit one, so it never appears in the
// committed file at all.
func TestGenerateMaturityJSON_OmitsGeneratedAt(t *testing.T) {
	repoRoot := filepath.Join("..", "..")
	raw, err := GenerateMaturityJSON(repoRoot, time.Now)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json: %v", err)
	}
	if strings.Contains(raw, "generatedAt") {
		t.Errorf("plugin-api-maturity.json carries a generatedAt key -- it must be a run-time-only field, never serialized")
	}
}

// TestGenerateMaturityJSON_OmitsDaysBehind pins goal 0391's decision:
// "days behind" is a live staleness metric (today vs codeChangedAt),
// never a repo fact, so it must never be serialized into the
// committed ledger -- a reader derives it from codeChangedAt/
// docsChangedAt at render time instead.
func TestGenerateMaturityJSON_OmitsDaysBehind(t *testing.T) {
	repoRoot := filepath.Join("..", "..")
	raw, err := GenerateMaturityJSON(repoRoot, time.Now)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json: %v", err)
	}
	if strings.Contains(raw, "daysBehind") {
		t.Errorf("plugin-api-maturity.json carries a daysBehind key -- that figure must be computed by a reader, never stored")
	}
}

// TestGenerateMaturity_IdempotentAcrossCallsOverTime is goal 0358 S9's
// acceptance check: `go generate` on an unchanged commit must produce
// byte-identical output no matter what day it runs. Real wall-clock
// elapses between the two calls below (however briefly); the
// generated markdown and JSON must still match exactly.
func TestGenerateMaturity_IdempotentAcrossCallsOverTime(t *testing.T) {
	repoRoot := filepath.Join("..", "..")

	firstMD := GenerateMaturityMarkdown(repoRoot, time.Now)
	firstJSON, err := GenerateMaturityJSON(repoRoot, time.Now)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json (first): %v", err)
	}

	time.Sleep(2 * time.Millisecond)

	secondMD := GenerateMaturityMarkdown(repoRoot, time.Now)
	secondJSON, err := GenerateMaturityJSON(repoRoot, time.Now)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json (second): %v", err)
	}

	if firstMD != secondMD {
		t.Error("plugin-api-maturity.md differs between two generations of the same commit")
	}
	if firstJSON != secondJSON {
		t.Error("plugin-api-maturity.json differs between two generations of the same commit")
	}
}

// TestGenerateMaturity_CommittedBytesIgnoreNow is goal 0391's own
// acceptance check, stronger than the sleep-based test above: two
// deliberately different clocks -- decades apart -- fed straight into
// generation must still produce byte-identical committed output. The
// committed ledger carries evidence dates (git facts), never a figure
// derived against whichever clock generated it.
func TestGenerateMaturity_CommittedBytesIgnoreNow(t *testing.T) {
	repoRoot := filepath.Join("..", "..")
	past := func() time.Time { return time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC) }
	future := func() time.Time { return time.Date(2099, 12, 31, 0, 0, 0, 0, time.UTC) }

	pastMD := GenerateMaturityMarkdown(repoRoot, past)
	futureMD := GenerateMaturityMarkdown(repoRoot, future)
	if pastMD != futureMD {
		t.Error("plugin-api-maturity.md differs between a 2020 and a 2099 clock")
	}

	pastJSON, err := GenerateMaturityJSON(repoRoot, past)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json (past clock): %v", err)
	}
	futureJSON, err := GenerateMaturityJSON(repoRoot, future)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json (future clock): %v", err)
	}
	if pastJSON != futureJSON {
		t.Error("plugin-api-maturity.json differs between a 2020 and a 2099 clock")
	}
}

// redactMaturityDateColumns blanks the 9th and 10th table columns
// (code changed, docs changed) on every data row, leaving header/
// separator rows and every other column untouched -- see the test's
// own comment for why.
func redactMaturityDateColumns(md string) string {
	lines := strings.Split(md, "\n")
	for i, line := range lines {
		if !strings.HasPrefix(line, "| ") {
			continue
		}
		cols := strings.Split(line, "|")
		if len(cols) != 13 {
			continue
		}
		family := strings.TrimSpace(cols[1])
		if family == "Family" || strings.HasPrefix(family, "---") {
			continue
		}
		cols[9] = " N "
		cols[10] = " N "
		lines[i] = strings.Join(cols, "|")
	}
	return strings.Join(lines, "\n")
}

// parseMaturityJSONForFreshness unmarshals the ledger and zeroes every
// git-log-derived, shallow-clone-sensitive field before comparison.
func parseMaturityJSONForFreshness(raw string) (maturityJSONLedger, error) {
	var l maturityJSONLedger
	if err := json.Unmarshal([]byte(raw), &l); err != nil {
		return maturityJSONLedger{}, err
	}
	for i := range l.Rows {
		l.Rows[i].CodeCommit = ""
		l.Rows[i].CodeChangedAt = ""
		l.Rows[i].DocsCommit = ""
		l.Rows[i].DocsChangedAt = ""
	}
	return l, nil
}
