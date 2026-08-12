package composition

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"github.com/alicoding/mill/internal/domain/decision"
	"github.com/alicoding/mill/internal/domain/guardrail"
)

// ResolvedDecision is a Decision's config, assembled by whatever owns
// Decision storage at request time (ConfigureService) -- same injected-
// seam shape as ResolvedHTTPRequest/ResolvedMCPServer/ResolvedList:
// composition.go doesn't own Decision persistence, so this is wired
// once via SetDecisionLookup rather than composition depending on
// configuresvc directly (.claude/rules/backend.md). Outputs reuses
// decision.OutputField directly (composition already imports
// internal/domain/httprequest's structs the same way -- domain-to-
// domain is fine, only composition -> configuresvc would create the
// dependency this seam exists to avoid).
type ResolvedDecision struct {
	Label            string
	Category         string
	Outputs          []decision.OutputField
	WebhookRequestID string
}

// lookupDecisionFn defaults to erroring so a decision-outcome node run
// before ConfigureService exists (or before SetDecisionLookup wires it)
// fails loudly instead of silently no-op'ing -- same pattern every
// other lookup*Fn in this package already uses.
var lookupDecisionFn = func(decisionID string) (ResolvedDecision, error) {
	return ResolvedDecision{}, fmt.Errorf("no decision lookup registered (yet) for id %q", decisionID)
}

// SetDecisionLookup wires the function decision-outcome nodes (and
// EffectForNode's dynamic-effect hook below) use to resolve a
// decisionId into its category/outputs/webhook. Called once from
// main.go once ConfigureService exists.
func SetDecisionLookup(fn func(decisionID string) (ResolvedDecision, error)) {
	lookupDecisionFn = fn
}

// EffectForNode reports a node's ACTUAL guardrail effect class --
// static per NodeType (NodeTypeEffect) for every node type except
// decision-outcome, whose effect depends on whether the Decision it
// references carries a webhook (docs/adr/0027): declaring a fixed
// ClassExternal on the NodeType itself would make every plain
// (non-webhook) Decision ask for approval by default, violating
// SPEC.md §1's not-harder-than-baseline lock; declaring ClassLocal
// would let a webhook-bearing Decision skip the ask integration-http
// itself would get for the identical outbound call. Additive: every
// other NodeType's effect is exactly NodeTypeEffect's static answer,
// unchanged. The executionsvc guardrail gate calls this instead of
// NodeTypeEffect directly (executionservice_guardrail.go).
func EffectForNode(node Node) guardrail.EffectClass {
	if node.NodeTypeID == "decision-outcome" {
		if rd, err := lookupDecisionFn(node.Config["decisionId"]); err == nil && rd.WebhookRequestID != "" {
			return guardrail.ClassExternal
		}
	}
	return NodeTypeEffect(node.NodeTypeID)
}

// NodeAlwaysParks reports whether node unconditionally pauses for a
// human decision, regardless of any guardrail rule -- human-review's
// own drawn checkpoint (ADR-0023) and a manual-review-category
// decision-outcome node (ADR-0027) both park via the identical
// waitForApprovalFn mechanism no allow rule can skip (see each node
// type's own exec function). executionsvc's RunWorkflow pre-scan
// (mayRequireApproval) uses this so a Run click never blocks
// synchronously waiting on a park it had no way to see coming --
// guardrail.MayAsk alone can't answer this, since it only reasons
// about POLICY-driven asks (rule-evaluated), not a node that parks by
// its own drawn design regardless of policy.
func NodeAlwaysParks(node Node) bool {
	if node.NodeTypeID == "human-review" {
		return true
	}
	if node.NodeTypeID == "decision-outcome" {
		if rd, err := lookupDecisionFn(node.Config["decisionId"]); err == nil {
			return rd.Category == string(decision.CategoryManualReview)
		}
	}
	return false
}

// zeroForOutputType mirrors attributesEnv's own per-type zero value
// (graph.go) -- a Decision output field with no bound value (or one
// bound to an Attribute that hasn't been set yet) still appears in the
// outcome JSON, typed correctly, rather than being silently omitted.
func zeroForOutputType(t ConfigFieldType) any {
	switch t {
	case "number":
		return 0.0
	case "boolean":
		return false
	default:
		return ""
	}
}

// resolveDecisionOutputs resolves a decision-outcome node's outputBindings
// (JSON map of output key -> literal or "attr:<name>", same shape every
// other bindings map in this package already uses) against the running
// Attributes bag -- TYPED, reusing the same "attr: refs pull the
// Attribute's real Go-typed value, a literal is coerced to the field's
// declared type" resolution mcpcall.go's resolveMCPArguments established
// (a number output bound to a number Attribute stays a JSON number, not
// a stringified one). A field with no binding at all still appears,
// zero-valued for its type (zeroForOutputType above) -- the outcome's
// shape is always the Decision's full declared contract, not just
// whatever the node happened to bind.
func resolveDecisionOutputs(bindingsRaw string, outputs []decision.OutputField, attrs map[string]any) (map[string]any, error) {
	bindings, err := parseBindings(bindingsRaw)
	if err != nil {
		return nil, fmt.Errorf("outputBindings: %w", err)
	}
	out := make(map[string]any, len(outputs))
	for _, f := range outputs {
		zero := zeroForOutputType(f.Type)
		raw, ok := bindings[f.Key]
		if !ok {
			out[f.Key] = zero
			continue
		}
		if name, isAttr := strings.CutPrefix(raw, attrBindingPrefix); isAttr {
			if v, ok := attrs[name]; ok {
				out[f.Key] = v
			} else {
				out[f.Key] = zero
			}
			continue
		}
		out[f.Key] = coerceAttrValue(zero, raw)
	}
	return out, nil
}

func init() {
	RegisterNodeType(NodeType{
		ID: "decision-outcome", Kind: KindTerminal,
		Effect:      guardrail.ClassLocal,
		Output:      "the typed decision outcome",
		Label:       "Decision",
		Description: "Ends the workflow with a Configure-authored, typed terminal outcome (docs/adr/0027): an outcome category (approve/deny/manual-review/action-needed/uncategorized) plus this Decision's own typed result fields. A manual-review Decision parks the run in the Review queue first -- approve continues to the outcome, deny/timeout fails closed, same mechanism the human-review node uses. A Decision with a configured webhook fires it (the same HTTPRequest execution path integration-http uses, with the outcome's typed outputs as the body) once the outcome is computed, and -- unlike a plain Decision -- asks for approval by default, exactly like integration-http does for the identical kind of outbound call.",
		ConfigFields: []ConfigField{
			{
				Key: "decisionId", Label: "Decision",
				Description: "Which Configure-authored Decision this terminal step reaches.",
				Default:     "", Type: FieldText, RefKind: "decision",
			},
		},
	}, func(node Node, ctx ExecContext) (ExecContext, error) {
		rd, err := lookupDecisionFn(node.Config["decisionId"])
		if err != nil {
			return ctx, fmt.Errorf("decision-outcome: %w", err)
		}

		// Manual review always parks, regardless of any guardrail rule --
		// a deliberate checkpoint on this Decision's own category, the
		// same "not policy, drawn on purpose" shape human-review's own
		// waitForApprovalFn call already establishes (humanreview.go).
		if rd.Category == string(decision.CategoryManualReview) {
			message := fmt.Sprintf("Decision reached: %s", rd.Label)
			if _, err := waitForApprovalFn(ctx.RunContext, node, ctx, message); err != nil {
				return ctx, fmt.Errorf("decision-outcome: %w", err)
			}
		}

		outputs, err := resolveDecisionOutputs(node.Config["outputBindings"], rd.Outputs, ctx.Attributes)
		if err != nil {
			return ctx, fmt.Errorf("decision-outcome: %w", err)
		}
		outcome := map[string]any{
			"category": rd.Category,
			"decision": rd.Label,
			"outputs":  outputs,
		}
		payload, err := json.Marshal(outcome)
		if err != nil {
			return ctx, fmt.Errorf("decision-outcome: encode outcome: %w", err)
		}
		ctx.Payload = string(payload)

		// The webhook fires AFTER the outcome is computed (docs/adr/0027),
		// through the same transport tail integration-http uses
		// (httpsend.go) -- fail-safe: a webhook failure fails this step
		// (redrivable, same as any other node failure), it never silently
		// swallows a delivery error.
		if rd.WebhookRequestID != "" {
			hreq, err := lookupHTTPRequestFn(rd.WebhookRequestID)
			if err != nil {
				return ctx, fmt.Errorf("decision-outcome: webhook: %w", err)
			}
			method, path := defaultMethodAndPath(hreq, "", "")
			headers := make(map[string]string, len(hreq.Headers))
			for k, v := range hreq.Headers {
				headers[k] = v
			}
			outputsJSON, err := json.Marshal(outputs)
			if err != nil {
				return ctx, fmt.Errorf("decision-outcome: encode webhook body: %w", err)
			}
			if _, err := sendHTTPRequest(hreq, method, path, string(outputsJSON), headers, url.Values{}, nil); err != nil {
				return ctx, fmt.Errorf("decision-outcome: webhook: %w", err)
			}
		}

		return ctx, nil
	})
}
