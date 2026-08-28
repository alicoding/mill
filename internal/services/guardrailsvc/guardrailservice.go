// Package guardrailsvc is the Wails-facing layer over
// internal/domain/guardrail: rule storage/CRUD and the dry-run tester.
// Rule evaluation itself stays in the domain package; this package owns
// only persistence and the composition-aware lookups (resolving which
// workflow/node a rule targets) a stateless domain package can't hold.
package guardrailsvc

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/alicoding/mill/internal/adapters/settings"
	"github.com/alicoding/mill/internal/domain/composition"
	"github.com/alicoding/mill/internal/domain/guardrail"
	"github.com/alicoding/mill/internal/services/compositionsvc"
	"github.com/alicoding/mill/internal/services/dataevent"
	"github.com/alicoding/mill/internal/services/seeding"
	"github.com/google/uuid"
)

// secretLabelsFn resolves a node's own vault-reference use into sorted
// LABELS (goal 0203 S2) -- wired to configuresvc.ConfigureService.
// DeriveSecretLabels (main.go), never imported directly
// (.claude/rules/backend.md: guardrailsvc must not import configuresvc).
// Defaults to reporting no secret use so a Step built before wiring (a
// unit test constructing one directly) still gets a present, empty
// Attributes["secrets"] rather than a nil-map read.
var secretLabelsFn = func(nodeTypeID string, config map[string]string) []string { return nil }

// SetSecretLabelsLookup wires the derivation seam above. Exported for
// main.go wiring only, never a frontend RPC.
//
//wails:ignore
func SetSecretLabelsLookup(fn func(nodeTypeID string, config map[string]string) []string) {
	secretLabelsFn = fn
}

// guardrailRulesKey mirrors workflowsKey/listsKey's shape: one JSON
// array under one settings key.
const guardrailRulesKey = "guardrail-rules"

// GuardrailService is the Wails-facing layer over
// internal/domain/guardrail -- rule storage/CRUD plus the dry-run
// tester §8 locks as a requirement ("a policy rule that's silently
// broader than intended is exactly how a guardrail fails quietly").
// Evaluation itself stays in the domain package; the execution gate
// that acts on a verdict lives in executionservice.go.
type GuardrailService struct {
	// mu is a plain Mutex, not RWMutex: entitystore's generic Reconcile/
	// Insert/Update/DeleteWithTombstone family (goal 0203 S2's own
	// reconcileBuiltInRules, guardrailservice_builtin.go) takes *sync.
	// Mutex, the same type every other Configure-entity service using it
	// already declares -- Rules() below gives up RLock's multi-reader
	// optimization for that reuse, negligible for this small,
	// infrequently-read rule set.
	mu    sync.Mutex
	store settings.Store
	rules []guardrail.Rule
	comp  *compositionsvc.CompositionService
	// pending is the durable generic pending-action store
	// (guardrailservice_pendingstore.go, docs/adr/0047 §5.4's follow-up)
	// -- its own internal lock, separate from mu (rule CRUD): the two
	// protect unrelated state, and a long-parked guarded action must
	// never block a rule save/list.
	pending *PendingActionStore
}

func NewGuardrailService(store settings.Store, comp *compositionsvc.CompositionService) *GuardrailService {
	g := &GuardrailService{store: store, comp: comp, pending: NewPendingActionStore(store)}
	g.restore()
	g.reconcileBuiltInRules()
	return g
}

// PendingActionStore exposes the shared durable pending-action store
// for a caller that wants to park through the SAME persisted store this
// service's own RequestGuardedAction uses (mcpsvc's SetGuardrailService
// wiring, replacing its own constructor-time default -- see
// millmcpservice.go's pendingActionStore field doc comment for why a
// default exists at all). Go-internal wiring only, never a frontend
// RPC.
//
//wails:ignore
func (g *GuardrailService) PendingActionStore() *PendingActionStore {
	return g.pending
}

func (g *GuardrailService) restore() {
	if raw, ok := g.store.Get(guardrailRulesKey).(string); ok && raw != "" {
		var rules []guardrail.Rule
		if err := json.Unmarshal([]byte(raw), &rules); err == nil {
			g.rules = rules
		}
	}
}

func (g *GuardrailService) persist() error {
	data, err := json.Marshal(g.rules)
	if err != nil {
		return fmt.Errorf("marshal guardrail rules: %w", err)
	}
	if err := g.store.Set(guardrailRulesKey, string(data)); err != nil {
		return fmt.Errorf("persist guardrail rules: %w", err)
	}
	return nil
}

// Rules returns every stored rule.
func (g *GuardrailService) Rules() []guardrail.Rule {
	g.mu.Lock()
	defer g.mu.Unlock()
	out := make([]guardrail.Rule, len(g.rules))
	copy(out, g.rules)
	return out
}

// CreateRule validates and stores a new rule, minting its ID. On a
// persist failure the appended rule is rolled back rather than left
// live in memory only -- a rule that silently failed to save must not
// appear to be gating anything (docs/goals/0025 item 2's memory-vs-
// store consistency rule, applied to guardrail rules too since a
// phantom-saved rule here is worse than most: it's the thing deciding
// whether a step needs approval).
func (g *GuardrailService) CreateRule(rule guardrail.Rule) (guardrail.Rule, error) {
	rule.ID = uuid.NewString()
	if err := rule.Validate(); err != nil {
		return guardrail.Rule{}, err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.rules = append(g.rules, rule)
	if err := g.persist(); err != nil {
		g.rules = g.rules[:len(g.rules)-1]
		return guardrail.Rule{}, fmt.Errorf("save guardrail rule: %w", err)
	}
	dataevent.Emit("guardrail-rule", rule.ID) // goal 0017: live-sync every open surface
	return rule, nil
}

// UpdateRule replaces an existing rule in place, same validation as
// create; rolls back to the previous rule value if the persist fails.
func (g *GuardrailService) UpdateRule(rule guardrail.Rule) error {
	if err := rule.Validate(); err != nil {
		return err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	for i, r := range g.rules {
		if r.ID == rule.ID {
			previous := g.rules[i]
			g.rules[i] = rule
			if err := g.persist(); err != nil {
				g.rules[i] = previous
				return fmt.Errorf("save guardrail rule: %w", err)
			}
			dataevent.Emit("guardrail-rule", rule.ID) // goal 0017: live-sync every open surface
			return nil
		}
	}
	return fmt.Errorf("unknown guardrail rule: %s", rule.ID)
}

// DeleteRule removes a rule by ID; deleting an absent rule is a no-op,
// matching every other Configure entity's delete semantics. Returns the
// persist error (rather than swallowing it, docs/goals/0025 item 1) and
// restores the deleted rule if the store write (or, for a built-in
// rule, the tombstone write, goal 0203 S2) fails.
func (g *GuardrailService) DeleteRule(id string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	idx := -1
	for i, r := range g.rules {
		if r.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return nil
	}
	removed := g.rules[idx]
	g.rules = append(g.rules[:idx], g.rules[idx+1:]...)
	restore := func() {
		g.rules = append(g.rules, guardrail.Rule{})
		copy(g.rules[idx+1:], g.rules[idx:])
		g.rules[idx] = removed
	}
	// A deleted built-in gets a tombstone so top-up reconcile never
	// resurrects it -- same discipline DeleteExecEnv/DeleteMCPServer
	// already apply. Removal and tombstone must succeed together
	// (docs/goals/0025 item 2).
	if removed.BuiltIn {
		if err := seeding.RecordTombstone(g.store, id); err != nil {
			restore()
			return fmt.Errorf("tombstone deleted guardrail rule %q: %w", id, err)
		}
	}
	if err := g.persist(); err != nil {
		restore()
		return fmt.Errorf("save guardrail rule deletion: %w", err)
	}
	dataevent.Emit("guardrail-rule", id) // goal 0017: live-sync every open surface
	return nil
}

// RuleTestResult is one dry-run's outcome for the Configure tester.
type RuleTestResult struct {
	Effect    string `json:"effect"`
	RuleID    string `json:"ruleID"`
	RuleLabel string `json:"ruleLabel"`
	// EffectClass is the tested node type's declared side-effect class,
	// so the tester can explain a default verdict ("external steps ask
	// by default").
	EffectClass string `json:"effectClass"`
	// Source mirrors the deciding rule's guardrail.Source (SourceDebug
	// for a breakpoint, "" for policy) -- docs/adr/0031: the canvas's
	// nothing-hidden badge uses this to render the distinct debug badge
	// instead of the policy shield when a breakpoint is what's actually
	// asking.
	Source string `json:"source,omitempty"`
}

// TestRules dry-runs the current rule set against one real workflow
// step -- §8's locked testability requirement: see what would happen
// before trusting a rule live. Uses the node's stored config and the
// workflow's zero-valued attributes, the same environment shape the
// live gate evaluates.
func (g *GuardrailService) TestRules(workflowID, nodeID string) (RuleTestResult, error) {
	var target *composition.Node
	var wf composition.Workflow
	for _, w := range g.comp.Workflows() {
		if w.ID == workflowID {
			wf = w
			for i := range w.Nodes {
				if w.Nodes[i].ID == nodeID {
					target = &w.Nodes[i]
				}
			}
		}
	}
	if target == nil {
		return RuleTestResult{}, fmt.Errorf("unknown workflow step: %s / %s", workflowID, nodeID)
	}
	// A node that always parks (the explicit human-review checkpoint,
	// ADR-0023; a manual-review-category decision-outcome node,
	// ADR-0027) -- report it as such rather than evaluating rules its
	// park deliberately ignores (same special-case as WorkflowVerdicts
	// below).
	if composition.NodeAlwaysParks(*target) {
		return RuleTestResult{Effect: "ask", RuleLabel: "explicit checkpoint", EffectClass: "none"}, nil
	}
	// EffectForNode, not the static NodeTypeEffect: a decision-outcome
	// node's actual effect class is dynamic (docs/adr/0027) -- every
	// other NodeType's answer is unchanged.
	class := composition.EffectForNode(*target)
	verdict := guardrail.Evaluate(g.Rules(), GuardrailStep(workflowID, *target, composition.ExecContext{
		Attributes: composition.AttributesEnv(wf.Attributes, nil),
	}), class)
	return RuleTestResult{
		Effect:      string(verdict.Effect),
		RuleID:      verdict.RuleID,
		RuleLabel:   verdict.RuleLabel,
		EffectClass: string(class),
		Source:      verdict.Source,
	}, nil
}

// RulesForStep returns every stored POLICY rule (Source != SourceDebug)
// whose non-empty scope fields all match the given workflow step --
// door 2's "Rules for this step" list (NodeGuardrailSection) and door
// 1's rule-from-park scope prefill both need this without duplicating
// guardrail's own scope-match logic in the frontend (goal 0078). An
// unknown workflow/node returns nil rather than an error -- callers
// treat "no rules apply" and "no such step" the same way (an empty
// list), matching TestRules' node-resolution but without its
// error-on-unknown-step behavior, since this is a passive list, not a
// dry-run request naming a specific step.
func (g *GuardrailService) RulesForStep(workflowID, nodeID string) []guardrail.Rule {
	var target *composition.Node
	for _, w := range g.comp.Workflows() {
		if w.ID != workflowID {
			continue
		}
		for i := range w.Nodes {
			if w.Nodes[i].ID == nodeID {
				target = &w.Nodes[i]
			}
		}
	}
	if target == nil {
		return nil
	}
	step := GuardrailStep(workflowID, *target, composition.ExecContext{})
	var out []guardrail.Rule
	for _, r := range g.Rules() {
		if r.Source == guardrail.SourceDebug {
			continue
		}
		if guardrail.ScopeMatches(r, step) {
			out = append(out, r)
		}
	}
	return out
}

// GuardrailStep converts one about-to-execute node into the domain
// evaluator's Step shape -- shared by the live gate (executionsvc), the
// dry-run tester (TestRules), and WorkflowVerdicts below, so a test
// verdict (or the canvas's nothing-hidden badge) can never diverge from
// the live one by construction.
//
// Attributes["secrets"] (goal 0203 S2) is always present, sorted,
// deduped labels or an empty list, never absent -- secretLabelsFn's own
// derivation is STATIC (node type + config only, never a run-time
// resolved value), which is exactly what lets WorkflowVerdicts compute
// this before anyone runs the workflow and still agree with what the
// live gate sees. Merged into a COPY of ec.Attributes, never written
// back into it: ec.Attributes is the caller's own live run state, and a
// dry-run tester (TestRules/WorkflowVerdicts, which pass ExecContext by
// value but share the same underlying map) must not leak its synthetic
// "secrets" key into it.
func GuardrailStep(workflowID string, node composition.Node, ec composition.ExecContext) guardrail.Step {
	attrs := make(map[string]any, len(ec.Attributes)+1)
	for k, v := range ec.Attributes {
		attrs[k] = v
	}
	labels := secretLabelsFn(node.NodeTypeID, node.Config)
	if labels == nil {
		labels = []string{}
	}
	attrs["secrets"] = labels
	return guardrail.Step{
		NodeTypeID: node.NodeTypeID,
		RequestID:  node.Config["requestId"],
		WorkflowID: workflowID,
		NodeID:     node.ID,
		Env:        guardrail.ConditionEnv(ec.Payload, attrs, node.Config),
	}
}

// ShellCommandVerdicts returns one guardrail verdict per command in
// commands, evaluated against the CURRENT rule set -- goal 0240 S3's
// per-line allow/deny pattern-list decisions. Scoped to the coding
// loop's own seeded process-shell-command node/workflow so a
// NodeTypeID-scoped list rule (guardrail.BuiltIn's ShellAllow*/
// ShellDeny* entries) matches, exactly like GuardrailStep's other
// callers. Shared by the Confirm-screen preview (codeloopsvc) and the
// real execution gate (guardrailGate) so they can never disagree,
// extending GuardrailStep's own "never disagree" contract to per-line
// granularity.
func (g *GuardrailService) ShellCommandVerdicts(commands []string) []guardrail.Verdict {
	node := composition.Node{ID: composition.CodingLoopShellStepID, NodeTypeID: "process-shell-command"}
	base := GuardrailStep(composition.CodingLoopWorkflowID, node, composition.ExecContext{})
	return guardrail.EvaluateCommandSteps(g.Rules(), base, commands, guardrail.ClassExternal)
}

// WorkflowVerdicts dry-runs the current rule set against every
// executable step of one workflow at once -- the canvas's
// nothing-hidden badge data (docs/adr/0022's Update: a step that will
// ask or deny is marked visibly on the canvas BEFORE anyone runs it,
// not discovered at run time). A node that always parks (the explicit
// Wait-for-approval/human-review node, ADR-0023; a manual-review
// decision-outcome, ADR-0027) always reports ask -- it parks by
// construction, no rule vouches it away.
func (g *GuardrailService) WorkflowVerdicts(workflowID string) (map[string]RuleTestResult, error) {
	var wf composition.Workflow
	found := false
	for _, w := range g.comp.Workflows() {
		if w.ID == workflowID {
			wf = w
			found = true
		}
	}
	if !found {
		return nil, fmt.Errorf("unknown workflow: %s", workflowID)
	}
	out := make(map[string]RuleTestResult)
	rules := g.Rules()
	attrs := composition.AttributesEnv(wf.Attributes, nil)
	for _, n := range wf.Nodes {
		if n.Kind == composition.KindTrigger || n.Kind == composition.KindDecision {
			continue
		}
		if composition.NodeAlwaysParks(n) {
			out[n.ID] = RuleTestResult{Effect: "ask", RuleLabel: "explicit checkpoint", EffectClass: "none"}
			continue
		}
		class := composition.EffectForNode(n)
		v := guardrail.Evaluate(rules, GuardrailStep(workflowID, n, composition.ExecContext{Attributes: attrs}), class)
		out[n.ID] = RuleTestResult{
			Effect: string(v.Effect), RuleID: v.RuleID, RuleLabel: v.RuleLabel, EffectClass: string(class), Source: v.Source,
		}
	}
	return out, nil
}
