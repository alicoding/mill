package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestRetryPassed_MergedShards proves the round trip goal 0413 S1c wires
// end to end: ci.yml's e2e job uploads one Playwright JSON-reporter
// artifact PER SHARD (testdata/pw-shards/shard-*.json are two such
// artifacts, each in Playwright's own real json-reporter shape --
// top-level config/suites, a title per suite/spec, goal 0413 S1c);
// engineering-health.yml's gather step downloads every shard artifact by
// glob and merges them with `jq -s '{suites: [.[] | .suites[]?]}'`
// before this tool ever sees a file. This test performs that identical
// merge (same jq expression semantics, restated in Go) and confirms
// LoadSources + retryPassed read the result as if it were one window's
// worth of shards.
func TestRetryPassed_MergedShards(t *testing.T) {
	shard1 := readPlaywrightReport(t, "testdata/pw-shards/shard-1.json")
	shard2 := readPlaywrightReport(t, "testdata/pw-shards/shard-2.json")

	merged := PlaywrightReport{}
	merged.Suites = append(merged.Suites, shard1.Suites...)
	merged.Suites = append(merged.Suites, shard2.Suites...)

	dataDir := t.TempDir()
	mergedRaw, err := json.Marshal(merged)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, "playwright-7.json"), mergedRaw, 0o600); err != nil {
		t.Fatal(err)
	}

	sources := LoadSources(dataDir, t.TempDir())
	if !sources.HasPlaywright7 {
		t.Fatal("HasPlaywright7 = false, want true (merged shard file present)")
	}

	count, rate, ok := retryPassed(sources.Playwright7, sources.HasPlaywright7)
	if !ok {
		t.Fatal("retryPassed ok = false, want true")
	}
	// 5 leaf results total across both shards (shard-1's flaky test
	// contributes two: a failed attempt then a retry-passed attempt;
	// the other three tests each contribute one passing, non-retried
	// result), exactly 1 of which is retry>0 and passed.
	if count != 1 {
		t.Errorf("retry-passed count = %v, want 1", count)
	}
	wantRate := 100.0 / 5.0
	if rate != wantRate {
		t.Errorf("retry-passed rate = %v, want %v", rate, wantRate)
	}
}

func readPlaywrightReport(t *testing.T, path string) PlaywrightReport {
	t.Helper()
	raw, err := os.ReadFile(path) // #nosec G304 -- a fixed testdata path, not external input
	if err != nil {
		t.Fatal(err)
	}
	var report PlaywrightReport
	if err := json.Unmarshal(raw, &report); err != nil {
		t.Fatal(err)
	}
	return report
}
