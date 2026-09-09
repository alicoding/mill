package main

import "testing"

const sampleQuarantine = `# E2e quarantine register

Some prose above the table.

| Spec:line | Class | Entered | Review by | Notes |
|---|---|---|---|---|
| a.spec.ts:1 | unclear | 2026-08-16 | 2026-09-16 | first strike |
| b.spec.ts:2 | live-run -> FIXED 2026-09-06 (goal 0358 S2) | 2026-08-16 | -- | resolved |
| c.spec.ts:3 | interaction-race | 2026-08-17 | 2026-09-22 | still open |
`

func TestCountActiveQuarantine_CountsUnresolvedOnly(t *testing.T) {
	active, ok := CountActiveQuarantine(sampleQuarantine)
	if !ok {
		t.Fatal("expected a table to be found")
	}
	if active != 2 {
		t.Fatalf("got %d active rows, want 2 (a.spec.ts and c.spec.ts, not the FIXED b.spec.ts)", active)
	}
}

func TestCountActiveQuarantine_NoTable(t *testing.T) {
	_, ok := CountActiveQuarantine("# empty file\n\nnothing here\n")
	if ok {
		t.Fatal("expected no table found")
	}
}
