package composition

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/alicoding/mill/internal/domain/list"
)

// Same injected-list harness shape TestListLookup_MissBehavior already
// establishes (listlookup_test.go) -- list-search reads the same
// SetListLookup seam, just against Columns/Rows instead of a flat
// Entries map.
func withTestList(t *testing.T, rows []list.Row) {
	t.Helper()
	SetListLookup(func(string) (ResolvedList, error) {
		return ResolvedList{
			Columns: nil,
			Rows:    rows,
		}, nil
	})
	t.Cleanup(func() {
		SetListLookup(func(id string) (ResolvedList, error) {
			return ResolvedList{}, nil
		})
	})
}

// execListSearchDirect runs list-search's own exec function directly
// (bypassing the full graph engine) so tests can assert on the real
// typed map[string]any result rather than its stringified payload
// form -- ExecContext.Attributes holds `any`, and Payload/
// capture-attribute only ever round-trips through a string.
func execListSearchDirect(t *testing.T, matchParams []listSearchMatchParam, extraConfig, attrValues map[string]string) map[string]any {
	t.Helper()
	raw, err := json.Marshal(matchParams)
	if err != nil {
		t.Fatal(err)
	}
	config := map[string]string{
		"listId": "x", "matchParams": string(raw), "outputAttribute": "result",
	}
	for k, v := range extraConfig {
		config[k] = v
	}
	attrs := map[string]any{}
	for k, v := range attrValues {
		attrs[k] = v
	}
	ctx, err := execListSearch(Node{ID: "s", NodeTypeID: "list-search", Config: config}, ExecContext{Attributes: attrs})
	if err != nil {
		t.Fatalf("execListSearch: %v", err)
	}
	result, ok := ctx.Attributes["result"].(map[string]any)
	if !ok {
		t.Fatalf("Attributes[result] = %v (%T), want map[string]any", ctx.Attributes["result"], ctx.Attributes["result"])
	}
	return result
}

var seedRows = []list.Row{
	{ID: "row-us", Values: map[string]string{"code": "US", "name": "United States"}, Status: list.RowActive},
	{ID: "row-fr", Values: map[string]string{"code": "FR", "name": "France"}, Status: list.RowActive},
	{ID: "row-su", Values: map[string]string{"code": "SU", "name": "Soviet Union"}, Status: list.RowExpired},
}

func TestListSearch_ExactMatch_Hit(t *testing.T) {
	withTestList(t, seedRows)
	result := execListSearchDirect(t,
		[]listSearchMatchParam{{Column: "code", Value: "attr:code", MatchType: "exact"}},
		nil, map[string]string{"code": "US"})

	if matched, _ := result["matched"].(bool); !matched {
		t.Fatalf("result = %+v, want matched=true", result)
	}
	if count, _ := result["match_count"].(int); count != 1 {
		t.Errorf("match_count = %v, want 1", result["match_count"])
	}
	first, ok := result["first_match"].(map[string]string)
	if !ok || first["name"] != "United States" {
		t.Errorf("first_match = %+v, want the US row", result["first_match"])
	}
	if result["list_id"] != "x" {
		t.Errorf("list_id = %v, want %q (the execution evidence bar, goal 0011 item 5)", result["list_id"], "x")
	}
}

func TestListSearch_ExactMatch_Miss(t *testing.T) {
	withTestList(t, seedRows)
	result := execListSearchDirect(t,
		[]listSearchMatchParam{{Column: "code", Value: "attr:code", MatchType: "exact"}},
		nil, map[string]string{"code": "ZZ"})

	if matched, _ := result["matched"].(bool); matched {
		t.Fatalf("result = %+v, want matched=false", result)
	}
	if count, _ := result["match_count"].(int); count != 0 {
		t.Errorf("match_count = %v, want 0", result["match_count"])
	}
	if result["first_match"] != nil {
		t.Errorf("first_match = %v, want nil on a miss", result["first_match"])
	}
}

func TestListSearch_FuzzyMatch(t *testing.T) {
	withTestList(t, seedRows)
	result := execListSearchDirect(t,
		[]listSearchMatchParam{{Column: "name", Value: "Fracne", MatchType: "fuzzy", Threshold: 0.6}},
		nil, nil)

	if matched, _ := result["matched"].(bool); !matched {
		t.Fatalf("fuzzy result = %+v, want a match against 'France' for the typo'd query 'Fracne'", result)
	}
	first, _ := result["first_match"].(map[string]string)
	if first["name"] != "France" {
		t.Errorf("first_match = %+v, want France", result["first_match"])
	}
}

func TestListSearch_FuzzyMatch_BelowThreshold_NoMatch(t *testing.T) {
	withTestList(t, seedRows)
	result := execListSearchDirect(t,
		[]listSearchMatchParam{{Column: "name", Value: "Zzzzzzzzz", MatchType: "fuzzy", Threshold: 0.9}},
		nil, nil)

	if matched, _ := result["matched"].(bool); matched {
		t.Fatalf("result = %+v, want no match for a dissimilar query at a high threshold", result)
	}
}

func TestListSearch_ExpiredRow_ExcludedByDefault(t *testing.T) {
	withTestList(t, seedRows)
	result := execListSearchDirect(t,
		[]listSearchMatchParam{{Column: "code", Value: "SU", MatchType: "exact"}},
		nil, nil)

	if matched, _ := result["matched"].(bool); matched {
		t.Fatalf("result = %+v, want the Expired SU row excluded by default", result)
	}
}

func TestListSearch_IncludeExpired_OptIn(t *testing.T) {
	withTestList(t, seedRows)
	result := execListSearchDirect(t,
		[]listSearchMatchParam{{Column: "code", Value: "SU", MatchType: "exact"}},
		map[string]string{"includeExpired": "true"}, nil)

	if matched, _ := result["matched"].(bool); !matched {
		t.Fatalf("result = %+v, want the Expired SU row matched once includeExpired=true", result)
	}
}

func TestListSearch_MultipleParams_ANDSemantics(t *testing.T) {
	withTestList(t, seedRows)
	// code=US AND name=France should match nothing -- no single row
	// satisfies both.
	result := execListSearchDirect(t, []listSearchMatchParam{
		{Column: "code", Value: "US", MatchType: "exact"},
		{Column: "name", Value: "France", MatchType: "exact"},
	}, nil, nil)
	if matched, _ := result["matched"].(bool); matched {
		t.Fatalf("result = %+v, want AND'd params with no single satisfying row to not match", result)
	}

	// code=US AND name=United States (the real pairing) should match.
	result = execListSearchDirect(t, []listSearchMatchParam{
		{Column: "code", Value: "US", MatchType: "exact"},
		{Column: "name", Value: "United States", MatchType: "exact"},
	}, nil, nil)
	if matched, _ := result["matched"].(bool); !matched {
		t.Fatalf("result = %+v, want the real US/United States pairing to match", result)
	}
}

func TestListSearch_FirstMatchOnly_StopsEarly_SameShape(t *testing.T) {
	rows := []list.Row{
		{ID: "r1", Values: map[string]string{"code": "US", "name": "United States"}, Status: list.RowActive},
		{ID: "r2", Values: map[string]string{"code": "US", "name": "USA (alias)"}, Status: list.RowActive},
	}
	withTestList(t, rows)

	all := execListSearchDirect(t,
		[]listSearchMatchParam{{Column: "code", Value: "US", MatchType: "exact"}}, nil, nil)
	if count, _ := all["match_count"].(int); count != 2 {
		t.Fatalf("without firstMatchOnly, match_count = %v, want 2", all["match_count"])
	}

	first := execListSearchDirect(t,
		[]listSearchMatchParam{{Column: "code", Value: "US", MatchType: "exact"}},
		map[string]string{"firstMatchOnly": "true"}, nil)
	if count, _ := first["match_count"].(int); count != 1 {
		t.Fatalf("with firstMatchOnly, match_count = %v, want 1", first["match_count"])
	}
	// The type never changes -- results/matched/first_match/match_count
	// are all still present, just results has fewer entries (goal
	// 0011's own "never changes the published type" requirement).
	for _, key := range []string{"results", "matched", "first_match", "match_count", "list_id"} {
		if _, ok := first[key]; !ok {
			t.Errorf("firstMatchOnly result missing key %q -- the output shape must stay identical", key)
		}
	}
}

func TestListSearch_NoMatchParams_Errors(t *testing.T) {
	withTestList(t, seedRows)
	_, err := execListSearch(Node{NodeTypeID: "list-search", Config: map[string]string{
		"listId": "x", "outputAttribute": "result",
	}}, ExecContext{Attributes: map[string]any{}})
	if err == nil || !strings.Contains(err.Error(), "at least one match parameter") {
		t.Fatalf("err = %v, want an 'at least one match parameter' error", err)
	}
}

func TestListSearch_NoOutputAttribute_Errors(t *testing.T) {
	withTestList(t, seedRows)
	raw, _ := json.Marshal([]listSearchMatchParam{{Column: "code", Value: "US", MatchType: "exact"}})
	_, err := execListSearch(Node{NodeTypeID: "list-search", Config: map[string]string{
		"listId": "x", "matchParams": string(raw),
	}}, ExecContext{Attributes: map[string]any{}})
	if err == nil || !strings.Contains(err.Error(), "outputAttribute is required") {
		t.Fatalf("err = %v, want an 'outputAttribute is required' error", err)
	}
}
