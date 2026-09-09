package main

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
)

func TestLoadGoalsPreservesYAMLSemanticsAndLegacyRecords(t *testing.T) {
	goals, err := loadGoals("testdata/goals")
	if err != nil {
		t.Fatalf("loadGoals: %v", err)
	}
	if len(goals) != 4 {
		t.Fatalf("got %d goals, want 4: %#v", len(goals), goals)
	}

	byID := make(map[string]goalRecord, len(goals))
	for _, goal := range goals {
		byID[goal.ID] = goal
	}

	unquoted := byID["0043"]
	if unquoted.Title != "Unquoted ID" || unquoted.Status == nil || *unquoted.Status != "open" {
		t.Fatalf("unquoted goal lost scalar metadata: %#v", unquoted)
	}
	if unquoted.Date == nil || *unquoted.Date != "2026-09-09" {
		t.Fatalf("date was not preserved as text: %#v", unquoted.Date)
	}
	if want := []any{7, "008"}; !reflect.DeepEqual(unquoted.PRs, want) {
		t.Fatalf("prs = %#v, want %#v", unquoted.PRs, want)
	}
	if want := []any{"comma, kept", "escaped \"quote\"", "café"}; !reflect.DeepEqual(unquoted.Proof, want) {
		t.Fatalf("proof = %#v, want %#v", unquoted.Proof, want)
	}
	if want := []any{"§9.1", "dashboard"}; !reflect.DeepEqual(unquoted.SpecRefs, want) {
		t.Fatalf("spec_refs = %#v, want %#v", unquoted.SpecRefs, want)
	}

	quoted := byID["0422"]
	if !quoted.Archived || quoted.Path != "archive/0422-single-quoted.md" {
		t.Fatalf("archive metadata = %#v", quoted)
	}
	if quoted.DefectClass == nil || *quoted.DefectClass != "frontmatter-parser" {
		t.Fatalf("quoted defect class = %#v", quoted.DefectClass)
	}
	if want := []any{"single, comma"}; !reflect.DeepEqual(quoted.Proof, want) {
		t.Fatalf("block-list proof = %#v, want %#v", quoted.Proof, want)
	}

	missing := byID["0099"]
	if missing.Status != nil || missing.Date != nil || missing.DefectClass != nil {
		t.Fatalf("missing scalars must remain null: %#v", missing)
	}
	if missing.PRs == nil || missing.Proof == nil || missing.SpecRefs == nil {
		t.Fatalf("missing lists must be empty arrays: %#v", missing)
	}

	legacy := byID["legacy.md"]
	if legacy.Title != "Legacy body only" || legacy.Status != nil {
		t.Fatalf("legacy record changed: %#v", legacy)
	}
	for i := 1; i < len(goals); i++ {
		if goals[i-1].Path > goals[i].Path {
			t.Fatalf("records are not path-sorted: %q before %q", goals[i-1].Path, goals[i].Path)
		}
	}
}

func TestParseGoalHandlesDoubleQuotesCRLFAndComments(t *testing.T) {
	raw := strings.Join([]string{
		"---",
		"id: \"0044\" # keep lexical identity",
		"status: \"in progress\"",
		"date: 2026-09-09",
		"prs: [44]",
		"proof: [\"line\\nfeed\"]",
		"spec_refs: []",
		"unknown: {nested: true}",
		"---",
		"# CRLF title ✓",
		"",
	}, "\r\n")

	goal, err := parseGoal("0044-crlf.md", []byte(raw))
	if err != nil {
		t.Fatalf("parseGoal: %v", err)
	}
	if goal.ID != "0044" || goal.Title != "CRLF title ✓" {
		t.Fatalf("CRLF goal = %#v", goal)
	}
	if want := []any{"line\nfeed"}; !reflect.DeepEqual(goal.Proof, want) {
		t.Fatalf("escaped proof = %#v, want %#v", goal.Proof, want)
	}
}

func TestParseGoalRejectsMalformedYAMLAndKnownFieldShapes(t *testing.T) {
	tests := map[string]struct {
		source string
		want   string
	}{
		"unclosed":          {source: "---\nid: 0042\n# Title\n", want: "never closed"},
		"malformed yaml":    {source: "---\nid: [\n---\n# Title\n", want: "parse frontmatter"},
		"top-level list":    {source: "---\n- id\n- 0042\n---\n# Title\n", want: "must be a mapping"},
		"scalar as list":    {source: "---\nid: 0042\nproof: nope\n---\n# Title\n", want: `field "proof"`},
		"list as scalar":    {source: "---\nid: [0042]\n---\n# Title\n", want: `field "id"`},
		"mapping list item": {source: "---\nid: 0042\nproof: [{path: x}]\n---\n# Title\n", want: `field "proof"`},
		"nested list item":  {source: "---\nid: 0042\nproof: [[x]]\n---\n# Title\n", want: `field "proof"`},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			_, err := parseGoal("archive/0042-bad.md", []byte(test.source))
			if err == nil {
				t.Fatal("parseGoal unexpectedly succeeded")
			}
			if !strings.Contains(err.Error(), "archive/0042-bad.md") {
				t.Fatalf("error does not identify its file: %v", err)
			}
			if !strings.Contains(err.Error(), test.want) {
				t.Fatalf("error %q does not contain %q", err, test.want)
			}
		})
	}
}

func TestRunEmitsOnlyTheDashboardGoalSchema(t *testing.T) {
	var out bytes.Buffer
	if err := run([]string{"testdata/goals"}, &out); err != nil {
		t.Fatalf("run: %v", err)
	}
	for _, key := range []string{
		`"id"`, `"status"`, `"date"`, `"defect_class"`, `"title"`,
		`"path"`, `"archived"`, `"prs"`, `"proof"`, `"spec_refs"`,
	} {
		if !strings.Contains(out.String(), key) {
			t.Fatalf("output missing %s: %s", key, out.String())
		}
	}
	if strings.Contains(out.String(), "unknown") {
		t.Fatalf("unknown frontmatter leaked into schema: %s", out.String())
	}
}
