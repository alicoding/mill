package composition

import (
	"encoding/json"
	"fmt"

	"github.com/alicoding/mill/internal/adapters/fuzzymatch"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// AtlasCard is composition's own, decoupled view of one Atlas card
// (docs/adr/0038) -- deliberately NOT internal/domain/atlas.Card: that
// package already imports composition (atlas/builtin.go's
// composition.ExampleChildWorkflowID reference), so composition
// importing atlas back would cycle. The service-side wiring (main.go)
// converts a real atlas.Card into this shape at the seam boundary,
// same "opaque at the domain layer" reasoning ResolvedList/ResolvedHTTPRequest
// already establish for their own owning services.
type AtlasCard struct {
	ID     string
	KindID string
	Title  string
	Fields map[string]string
}

// atlasCardMatchParam is one row-filter criterion for atlas-card-find --
// same shape as list-search's listSearchMatchParam (listsearch.go),
// matching against a card's Title (Column: "title") or one of its typed
// Fields (any other Column).
type atlasCardMatchParam struct {
	Column    string  `json:"column"`
	Value     string  `json:"value"`
	MatchType string  `json:"matchType"` // "exact" (default) | "fuzzy"
	Threshold float64 `json:"threshold,omitempty"`
}

// atlasCardsByKindFn resolves every card of a given Kind -- injected so
// this domain package never depends on atlassvc's storage (.claude/
// rules/backend.md). Defaults to erroring so a node run before
// SetAtlasCardFinder is wired fails loudly.
var atlasCardsByKindFn = func(kindID string) ([]AtlasCard, error) {
	return nil, fmt.Errorf("no atlas card finder registered (yet) for kind %q", kindID)
}

// SetAtlasCardFinder wires the function atlas-card-find nodes use to
// resolve a Kind's current cards. Called once from main.go once
// AtlasService exists.
func SetAtlasCardFinder(fn func(kindID string) ([]AtlasCard, error)) {
	atlasCardsByKindFn = fn
}

func init() {
	RegisterNodeType(NodeType{
		ID: "process-atlas-card-find", Kind: KindProcess,
		Label: "Atlas: find cards",
		// ClassRead: reads Atlas's persisted cards, mutates nothing --
		// same classification list-search's own identical Configure-data
		// read carries.
		Effect: guardrail.ClassRead,
		// Advanced: matchParams is hand-authored JSON, same reasoning as
		// list-search's own identical field.
		Complexity: ComplexityAdvanced,
		Output: "payload unchanged; matches -> a typed Object attribute " +
			"({results, matched, first_match, match_count})",
		Description: "Searches a Kind's cards in Atlas against one or more match parameters (exact or fuzzy, " +
			"AND'd together) and writes the result into Attributes. Match against \"title\" or any of the " +
			"Kind's own field keys.",
		ConfigFields: []ConfigField{
			{
				Key: "kindId", Label: "Kind", Type: FieldText, RefKind: "atlas-kind",
				Description: "Which Atlas card kind to search.",
			},
			{
				Key: "matchParams", Label: "Match parameters", Type: FieldText, Multiline: true,
				Description: `JSON array of match criteria, ALL must match (AND): ` +
					`[{"column":"title","value":"attr:leadName","matchType":"exact"},` +
					`{"column":"status","value":"New","matchType":"exact"}]. ` +
					`value is a literal or "attr:<name>".`,
			},
			{
				Key: "firstMatchOnly", Label: "Stop at first match", Type: FieldBoolean, Default: "false",
				Description: "Stops scanning after the first match.",
			},
			{
				Key: "outputAttribute", Label: "Output attribute", Type: FieldText,
				Description: "Which Attributes field receives the typed search-result object.",
			},
		},
	}, execAtlasCardFind)
}

func execAtlasCardFind(node Node, ctx ExecContext) (ExecContext, error) {
	kindID := node.Config["kindId"]
	if kindID == "" {
		return ctx, fmt.Errorf("process-atlas-card-find: kindId is required")
	}
	cards, err := atlasCardsByKindFn(kindID)
	if err != nil {
		return ctx, fmt.Errorf("process-atlas-card-find: %w", err)
	}

	var params []atlasCardMatchParam
	if raw := node.Config["matchParams"]; raw != "" {
		if err := json.Unmarshal([]byte(raw), &params); err != nil {
			return ctx, fmt.Errorf("process-atlas-card-find: invalid matchParams: %w", err)
		}
	}
	if len(params) == 0 {
		return ctx, fmt.Errorf("process-atlas-card-find: at least one match parameter is required")
	}

	outKey := node.Config["outputAttribute"]
	if outKey == "" {
		return ctx, fmt.Errorf("process-atlas-card-find: outputAttribute is required")
	}
	firstOnly := node.Config["firstMatchOnly"] == "true"

	var results []map[string]any
	for _, c := range cards {
		if atlasCardMatches(c, params, ctx.Attributes) {
			results = append(results, map[string]any{"id": c.ID, "kindId": c.KindID, "title": c.Title, "fields": c.Fields})
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
		"results": results, "matched": len(results) > 0,
		"match_count": len(results), "first_match": firstMatch,
	}
	return ctx, nil
}

// atlasCardMatches reports whether every match parameter matches c (AND
// semantics, same as listSearchRowMatches). "title" matches c.Title;
// any other Column matches c.Fields[Column]. A Column absent from
// c.Fields simply fails to match rather than erroring.
func atlasCardMatches(c AtlasCard, params []atlasCardMatchParam, attrs map[string]any) bool {
	for _, p := range params {
		var colVal string
		if p.Column == "title" {
			colVal = c.Title
		} else {
			colVal = c.Fields[p.Column]
		}
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
		default:
			if colVal != target {
				return false
			}
		}
	}
	return true
}
