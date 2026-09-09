package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// CurrencyEntry is one toolchain's pinned vs latest reading, gathered by
// the workflow (go.dev/dl JSON, nodejs.org's index, `npm view`, `go list
// -m -versions`) and handed to this tool as plain version strings -- the
// LAG math (how many minors/betas behind) is this tool's own job, per
// the "the computation lives in enghealth" adoption lock.
type CurrencyEntry struct {
	Pinned string `json:"pinned"`
	Latest string `json:"latest"`
}

type CurrencySet struct {
	Go         CurrencyEntry `json:"go"`
	Node       CurrencyEntry `json:"node"`
	Wails      CurrencyEntry `json:"wails"`
	Playwright CurrencyEntry `json:"playwright"`
}

// parseMajorMinor reads the leading "vN.N" / "N.N" of a version string,
// tolerating a leading "v" and any trailing pre-release/build suffix.
func parseMajorMinor(version string) (major, minor int, ok bool) {
	v := strings.TrimPrefix(strings.TrimSpace(version), "v")
	parts := strings.SplitN(v, ".", 3)
	if len(parts) < 2 {
		return 0, 0, false
	}
	maj, err1 := strconv.Atoi(onlyDigits(parts[0]))
	min, err2 := strconv.Atoi(onlyDigits(parts[1]))
	if err1 != nil || err2 != nil {
		return 0, 0, false
	}
	return maj, min, true
}

func onlyDigits(s string) string {
	var b strings.Builder
	for _, r := range s {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// MinorsBehind computes how many minor releases pinned trails latest.
// A major-version gap is folded in at a 1000x weight so it always reads
// as far behind rather than silently cancelling against a minor
// difference in the other direction.
func MinorsBehind(pinned, latest string) (int, bool) {
	pMaj, pMin, ok1 := parseMajorMinor(pinned)
	lMaj, lMin, ok2 := parseMajorMinor(latest)
	if !ok1 || !ok2 {
		return 0, false
	}
	return (lMaj-pMaj)*1000 + (lMin - pMin), true
}

// parseBetaNumber reads the trailing "-beta.N" / "betaN" ordinal off a
// Wails-style pre-release version string.
func parseBetaNumber(version string) (int, bool) {
	idx := strings.LastIndex(strings.ToLower(version), "beta")
	if idx < 0 {
		return 0, false
	}
	digits := onlyDigits(version[idx+len("beta"):])
	if digits == "" {
		return 0, false
	}
	n, err := strconv.Atoi(digits)
	if err != nil {
		return 0, false
	}
	return n, true
}

// BetasBehind computes how many beta ordinals pinned trails latest.
func BetasBehind(pinned, latest string) (int, bool) {
	p, ok1 := parseBetaNumber(pinned)
	l, ok2 := parseBetaNumber(latest)
	if !ok1 || !ok2 {
		return 0, false
	}
	return l - p, true
}

// maturityLedger is the subset of userdocs/reference/plugin-api-maturity.json
// (goal 0348/0397's docsgen output) this tool reads: one row per
// contribution family, each carrying its maturity level.
type maturityLedger struct {
	Rows []struct {
		Level string `json:"level"`
	} `json:"rows"`
}

func loadMaturity(repoRoot string) (stable, total int, ok bool) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, "userdocs", "reference", "plugin-api-maturity.json")) // #nosec G304 -- a fixed repo-owned path under --repo-root
	if err != nil {
		return 0, 0, false
	}
	var m maturityLedger
	if err := json.Unmarshal(raw, &m); err != nil {
		return 0, 0, false
	}
	for _, r := range m.Rows {
		if r.Level == "stable" {
			stable++
		}
	}
	return stable, len(m.Rows), true
}

// CountActiveQuarantine reads frontend/e2e/QUARANTINE.md's own committed
// table (testing.md's 2-strike register) and counts rows whose class
// column does not carry a "-> FIXED" resolution marker -- the table's
// own documented convention (testing.md: "Entries leave by fix ... or
// by their review date"). Plain line/column splitting, matching the
// convention this repo's own dashboard awk adapter already uses for
// another committed table (backlog-queue.awk) --
// not a markdown parser, since the table is a fixed pipe-delimited
// shape this repo authors and owns.
func CountActiveQuarantine(md string) (active int, ok bool) {
	lines := strings.Split(md, "\n")
	seenHeader := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "|") {
			continue
		}
		cols := strings.Split(trimmed, "|")
		if len(cols) < 3 {
			continue
		}
		classCol := strings.TrimSpace(cols[2])
		if strings.Contains(classCol, "---") {
			continue // the header separator row
		}
		if !seenHeader {
			seenHeader = true // the header row itself ("Spec:line | Class | ...")
			continue
		}
		ok = true
		if !strings.Contains(classCol, "FIXED") {
			active++
		}
	}
	return active, ok
}
