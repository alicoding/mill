package docsgen

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestUserDocs_MaturityMatchesCommitted is the tfplugindocs freshness
// pattern (docsgen_test.go's TestUserDocs_MatchCommitted) applied to
// the maturity ledger: a plain byte comparison. The ledger carries no
// git-derived field (goal 0397), so a full local clone and a shallow
// CI checkout regenerate identical bytes; there is nothing left to
// exclude. Fix a real drift with `go generate ./internal/docsgen`.
func TestUserDocs_MaturityMatchesCommitted(t *testing.T) {
	repoRoot := filepath.Join("..", "..")
	mdPath := filepath.Join(repoRoot, "userdocs", "reference", "plugin-api-maturity.md")
	jsonPath := filepath.Join(repoRoot, "userdocs", "reference", "plugin-api-maturity.json")

	wantMD := GenerateMaturityMarkdown(repoRoot, time.Now)
	gotMD, err := os.ReadFile(mdPath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		t.Fatalf("read plugin-api-maturity.md: %v", err)
	}
	if string(gotMD) != wantMD {
		t.Errorf("plugin-api-maturity.md is stale -- run `go generate ./internal/docsgen` and commit the result")
	}

	wantJSON, err := GenerateMaturityJSON(repoRoot, time.Now)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json: %v", err)
	}
	gotJSON, err := os.ReadFile(jsonPath) // #nosec G304 -- fixed path under this repo's own userdocs tree
	if err != nil {
		t.Fatalf("read plugin-api-maturity.json: %v", err)
	}
	if string(gotJSON) != wantJSON {
		t.Errorf("plugin-api-maturity.json is stale -- run `go generate ./internal/docsgen` and commit the result")
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

// TestGenerateMaturityJSON_OmitsDaysBehind pins the decision that
// "days behind" is a live staleness metric (today vs codeChangedAt),
// never a repo fact, so it must never be serialized into the
// committed ledger -- a reader derives it at render time instead.
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

// TestGenerateMaturityJSON_OmitsCurrency pins goal 0397's decision:
// codeCommit/codeChangedAt/docsCommit/docsChangedAt are git-log facts
// that differ by branch and checkout depth for the same tracked
// content, so none of them may reach the committed ledger -- a live
// reader (the control room dashboard) gets them from
// `go run ./internal/docsgen/gen -currency` instead.
func TestGenerateMaturityJSON_OmitsCurrency(t *testing.T) {
	repoRoot := filepath.Join("..", "..")
	raw, err := GenerateMaturityJSON(repoRoot, time.Now)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json: %v", err)
	}
	for _, key := range []string{"codeCommit", "codeChangedAt", "docsCommit", "docsChangedAt"} {
		if strings.Contains(raw, key) {
			t.Errorf("plugin-api-maturity.json carries a %s key -- currency must never reach the committed ledger", key)
		}
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

// TestGenerateMaturity_CommittedBytesIgnoreNow is a stronger version
// of the sleep-based test above: two deliberately different clocks --
// decades apart -- fed straight into generation must still produce
// byte-identical committed output.
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

// TestGenerateMaturity_IsBranchInvariant is goal 0397's own acceptance
// check: two branches regenerating on different bases must produce
// byte-identical committed files. The maturity ledger's only possible
// source of branch-to-branch difference was git history
// (maturity_currency.go's gitLastTouch, shelled out to `git`); this
// proves the committed generator no longer reaches it at all by
// making every `git` invocation fail (PATH stripped to a directory
// with no `git` binary) and asserting the output is byte-identical to
// a normal run. A real branch difference in `git log` answers would
// therefore change nothing either.
func TestGenerateMaturity_IsBranchInvariant(t *testing.T) {
	repoRoot := filepath.Join("..", "..")

	withGitMD := GenerateMaturityMarkdown(repoRoot, time.Now)
	withGitJSON, err := GenerateMaturityJSON(repoRoot, time.Now)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json (git reachable): %v", err)
	}

	t.Setenv("PATH", t.TempDir())

	withoutGitMD := GenerateMaturityMarkdown(repoRoot, time.Now)
	withoutGitJSON, err := GenerateMaturityJSON(repoRoot, time.Now)
	if err != nil {
		t.Fatalf("generate plugin-api-maturity.json (git unreachable): %v", err)
	}

	if withGitMD != withoutGitMD {
		t.Error("plugin-api-maturity.md differs depending on whether `git` is reachable -- a git-derived field leaked back into the committed table")
	}
	if withGitJSON != withoutGitJSON {
		t.Error("plugin-api-maturity.json differs depending on whether `git` is reachable -- a git-derived field leaked back into the committed ledger")
	}
}
