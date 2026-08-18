package composition

import (
	"strings"
	"testing"
)

func TestConsumesAccepts(t *testing.T) {
	cases := []struct {
		name     string
		consumes []PayloadKind
		produced PayloadKind
		want     bool
	}{
		{"reads-nothing accepts anything", []PayloadKind{PayloadNone}, PayloadHTML, true},
		{"reads-nothing accepts none", []PayloadKind{PayloadNone}, PayloadNone, true},
		{"any accepts none", []PayloadKind{PayloadAny}, PayloadNone, true},
		{"text accepts html", []PayloadKind{PayloadText}, PayloadHTML, true},
		{"text accepts markdown", []PayloadKind{PayloadText}, PayloadMarkdown, true},
		{"text accepts json", []PayloadKind{PayloadText}, PayloadJSON, true},
		{"html refuses markdown", []PayloadKind{PayloadHTML}, PayloadMarkdown, false},
		{"empty producer is universally accepted", []PayloadKind{PayloadHTML}, PayloadNone, true},
		{"html accepts any-producer", []PayloadKind{PayloadHTML}, PayloadAny, true},
		{"optional text accepts none", []PayloadKind{PayloadText, PayloadNone}, PayloadNone, true},
		{"optional text accepts markdown", []PayloadKind{PayloadText, PayloadNone}, PayloadMarkdown, true},
		{"json refuses html", []PayloadKind{PayloadJSON}, PayloadHTML, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ConsumesAccepts(tc.consumes, tc.produced); got != tc.want {
				t.Errorf("ConsumesAccepts(%v, %v) = %v, want %v", tc.consumes, tc.produced, got, tc.want)
			}
		})
	}
}

func TestEffectivePayloadKind_ResolvesThroughPassthroughChains(t *testing.T) {
	// trigger-manual -> capture-clipboard-html -> ruleset (passthrough)
	// -> apply-notify (passthrough): the effective kind at the notify
	// step's upstream is still the capture's html.
	nodes := []Node{
		{ID: "t", NodeTypeID: "trigger-manual"},
		{ID: "c", NodeTypeID: "capture-clipboard-html"},
		{ID: "r", NodeTypeID: "ruleset"},
		{ID: "n", NodeTypeID: "apply-notify"},
	}
	edges := []Edge{
		{ID: "e1", Source: "t", Target: "c"},
		{ID: "e2", Source: "c", Target: "r"},
		{ID: "e3", Source: "r", Target: "n"},
	}
	byID := map[string]Node{}
	for _, n := range nodes {
		byID[n.ID] = n
	}
	incoming := map[string][]Edge{}
	for _, e := range edges {
		incoming[e.Target] = append(incoming[e.Target], e)
	}
	if got := EffectivePayloadKind("r", byID, incoming, map[string]bool{}); got != PayloadHTML {
		t.Errorf("effective kind through the passthrough ruleset = %q, want html", got)
	}
	if got := EffectivePayloadKind("t", byID, incoming, map[string]bool{}); got != PayloadNone {
		t.Errorf("effective kind at the bare trigger = %q, want none", got)
	}
}

func TestValidateGraph_RefusesKindIncompatibleEdge(t *testing.T) {
	// The double-convert mistake: Convert HTML to Markdown feeding a
	// second converter -- the second one needs HTML but receives
	// Markdown. The exact "any step into any step" hole the contract
	// closes (ADR-0042).
	nodes := []Node{
		{ID: "t", NodeTypeID: "trigger-manual", Kind: KindTrigger},
		{ID: "c", NodeTypeID: "capture-clipboard-html", Kind: KindCapture},
		{ID: "p1", NodeTypeID: "process-html-to-markdown", Kind: KindProcess},
		{ID: "p2", NodeTypeID: "process-html-to-markdown", Kind: KindProcess},
	}
	edges := []Edge{
		{ID: "e0", Source: "t", Target: "c"},
		{ID: "e1", Source: "c", Target: "p1"},
		{ID: "e2", Source: "p1", Target: "p2"},
	}
	issues := ValidateGraph(nodes, edges, nil)
	found := false
	for _, i := range issues {
		if i.EdgeID == "e2" && i.Severity == SeverityError && strings.Contains(i.Message, "needs HTML") && strings.Contains(i.Message, "Markdown") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected a kind-incompatibility error on e2, got issues: %+v", issues)
	}
}

func TestValidateGraph_AcceptsTheSeededClipboardChain(t *testing.T) {
	// The canonical seeded shape stays valid end to end: capture html ->
	// convert -> write text (markdown IS text) -> notify (reads nothing,
	// passthrough).
	nodes := []Node{
		{ID: "t", NodeTypeID: "trigger-manual", Kind: KindTrigger},
		{ID: "c", NodeTypeID: "capture-clipboard-html", Kind: KindCapture},
		{ID: "p", NodeTypeID: "process-html-to-markdown", Kind: KindProcess},
		{ID: "a", NodeTypeID: "apply-clipboard-write-text", Kind: KindApply},
		{ID: "n", NodeTypeID: "apply-notify", Kind: KindApply},
	}
	edges := []Edge{
		{ID: "e0", Source: "t", Target: "c"},
		{ID: "e1", Source: "c", Target: "p"},
		{ID: "e2", Source: "p", Target: "a"},
		{ID: "e3", Source: "a", Target: "n"},
	}
	for _, i := range ValidateGraph(nodes, edges, nil) {
		if i.Severity == SeverityError {
			t.Errorf("unexpected error issue on the seeded chain: %+v", i)
		}
	}
}
