package composition

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/fuzzymatch"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/domain/list"
)

// listSearchMatchParam is one row-filter criterion, JSON-encoded into
// the list-search node's "matchParams" ConfigField -- the same
// one-string-field-carries-a-JSON-array shape integration-http's
// inputBindings and mcp-tool-call's argumentsJSON already establish
// (Node.Config stays map[string]string, so a repeated/array-shaped
// config value is always JSON inside one field, never a second
// mechanism). Value is a literal or an "attr:<name>" reference,
// resolved the same way every other binding in this package already
// does (resolveBindingValue, attributebinding.go).
//
// Multiple match parameters are AND'd together (docs/goals/0011-
// lists-maturation.md item 4: "multiple match parameters" reads as a
// composite-key filter -- e.g. matching first_name AND last_name --
// the standard reading for "search using several criteria," not an OR
// union).
type listSearchMatchParam struct {
	Column    string  `json:"column"`
	Value     string  `json:"value"`
	MatchType string  `json:"matchType"` // "exact" (default) | "fuzzy"
	Threshold float64 `json:"threshold,omitempty"`
}

// defaultFuzzyThreshold applies when a fuzzy match param omits (or
// zeroes) its own Threshold -- 0.7 keeps typo-tolerance real without
// matching two genuinely different values.
const defaultFuzzyThreshold = 0.7

func init() {
	RegisterNodeType(NodeType{
		ID: "list-search", Kind: KindProcess,
		Label: "List: search",
		// ClassRead: same classification as list-lookup above -- reads a
		// Configure-authored List's persisted rows, not left at the zero
		// value (docs/goals/0030-node-standard.md item b).
		Effect: guardrail.ClassRead,
		// Advanced: matchParams is a hand-authored JSON array of
		// {column,value,matchType,threshold} criteria (this node's own
		// ConfigField description below), not a plain value -- unlike
		// list-lookup's single input/output key pair.
		Complexity: ComplexityAdvanced,
		Output: "payload unchanged; matches -> a typed Object attribute " +
			"({results, matched, first_match, match_count, list_id})",
		Description: "Searches a Configure-authored List's rows against one or more match parameters " +
			"(exact or fuzzy, per-column, AND'd together) and writes the result into Attributes. " +
			"Supersedes list-lookup for anything beyond a single exact key match -- list-lookup keeps " +
			"working unchanged for existing workflows. Expired rows are excluded by default " +
			"(docs/goals/0011-lists-maturation.md's own researched default, uniform across exact and " +
			"fuzzy matching); \"Include expired rows\" opts in.",
		ConfigFields: []ConfigField{
			{
				Key: "listId", Label: "List", Type: FieldText, RefKind: "list",
				Description: "The Configure-authored List to search.",
			},
			{
				Key: "matchParams", Label: "Match parameters", Type: FieldText, Multiline: true,
				Description: `JSON array of match criteria, ALL must match (AND): ` +
					`[{"column":"code","value":"attr:code","matchType":"exact"},` +
					`{"column":"name","value":"Untied States","matchType":"fuzzy","threshold":0.7}]. ` +
					`value is a literal or "attr:<name>". Authored via the Inspector's match-parameter ` +
					`rows; this raw field stays the LLM-authoring vocabulary (docs/adr/0025).`,
			},
			{
				Key: "includeExpired", Label: "Include expired rows", Type: FieldBoolean, Default: "false",
				Description: "Off by default -- Expired rows never match unless explicitly included.",
			},
			{
				Key: "firstMatchOnly", Label: "Stop at first match", Type: FieldBoolean, Default: "false",
				Description: "Stops scanning after the first match. The output shape stays the same " +
					"typed Object either way -- results just has at most one entry -- so turning this on " +
					"or off never changes what a downstream Decision/binding can reference.",
			},
			{
				Key: "outputAttribute", Label: "Output attribute", Type: FieldText,
				Description: "Which Attributes field receives the typed search-result object.",
			},
			{
				// docs/adr/0040 decision 4's version pin, applied to List
				// by goal 0070 -- same shape and precedent as
				// decision-outcome's own "version" config.
				Key: "version", Label: "Pin to version (optional)",
				Description: "Leave empty to always resolve this List's current rows. Enter a version number to pin this step to that exact published snapshot, unaffected by later row edits.",
				Default:     "", Type: FieldText,
			},
		},
	}, execListSearch)
}

func execListSearch(node Node, ctx ExecContext) (ExecContext, error) {
	listID := node.Config["listId"]
	pinned, err := listPinnedVersion(node)
	if err != nil {
		return ctx, fmt.Errorf("list-search: %w", err)
	}
	rl, err := lookupListFn(listID, pinned)
	if err != nil {
		return ctx, fmt.Errorf("list-search: %w", err)
	}

	var params []listSearchMatchParam
	if raw := node.Config["matchParams"]; raw != "" {
		if err := json.Unmarshal([]byte(raw), &params); err != nil {
			return ctx, fmt.Errorf("list-search: invalid matchParams: %w", err)
		}
	}
	if len(params) == 0 {
		return ctx, fmt.Errorf("list-search: at least one match parameter is required")
	}

	outKey := node.Config["outputAttribute"]
	if outKey == "" {
		return ctx, fmt.Errorf("list-search: outputAttribute is required")
	}

	includeExpired := node.Config["includeExpired"] == "true"
	firstOnly := node.Config["firstMatchOnly"] == "true"

	var results []map[string]string
	for _, row := range rl.Rows {
		if !includeExpired && row.Status == list.RowExpired {
			continue
		}
		if listSearchRowMatches(row, params, ctx.Attributes) {
			results = append(results, row.Values)
			if firstOnly {
				break
			}
		}
	}

	var firstMatch any
	if len(results) > 0 {
		firstMatch = results[0]
	}
	if ctx.Attributes == nil {
		ctx.Attributes = map[string]any{}
	}
	ctx.Attributes[outKey] = map[string]any{
		"results":     results,
		"matched":     len(results) > 0,
		"match_count": len(results),
		"first_match": firstMatch,
		// list_id: goal 0011 item 5's minimum evidence bar ("record the
		// List identity used ... at minimum log it" -- full
		// per-execution dataset-version snapshotting is deliberately
		// deferred, see the goal file). Recorded inline with the very
		// result it produced -- visible wherever the output Attribute
		// itself is (e.g. a workflow's Runs tab) -- rather than an
		// out-of-band log line: no logging convention exists anywhere
		// in internal/domain/composition today, and introducing one
		// here for a single node type would be a bigger, separate
		// decision than this goal's own "at minimum" bar asks for.
		"list_id": listID,
		// resolved_version is the run-stamping audit label (docs/adr/0040
		// decision 5, applied to List by goal 0070) -- "v<N>" for a
		// pinned resolution, "live@<N>"/"live@draft" for an unpinned
		// one, recorded inline with the result it produced (the same
		// convention list_id above already establishes).
		"resolved_version": rl.VersionStamp,
	}
	return ctx, nil
}

// listSearchRowMatches reports whether every match parameter matches
// row (AND semantics -- see listSearchMatchParam's own doc comment).
// A column name that doesn't exist on the row (row.Values[p.Column]
// zero-valuing to "") simply fails to match rather than erroring --
// the same permissive-miss reasoning list-lookup's own onMiss="fail"
// default still surfaces as a run failure, just one level up (no
// results at all), not a hard error from this function.
func listSearchRowMatches(row list.Row, params []listSearchMatchParam, attrs map[string]any) bool {
	for _, p := range params {
		colVal := row.Values[p.Column]
		target := resolveBindingValue(p.Value, attrs)
		switch p.MatchType {
		case "fuzzy":
			threshold := p.Threshold
			if threshold <= 0 {
				threshold = defaultFuzzyThreshold
			}
			if len(fuzzymatch.Search(target, []string{colVal}, threshold)) == 0 {
				return false
			}
		default: // "exact" and any unrecognized value -- plain equality, never through the fuzzy lib
			if colVal != target {
				return false
			}
		}
	}
	return true
}
