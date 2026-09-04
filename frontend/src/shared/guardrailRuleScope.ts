import type { GuardrailRule } from './bindings'
import { copy } from './copy'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'

// Deterministic scope-sentence + rule-name generation, shared by every
// guardrail-rule authoring/display surface (rule-from-park's radio
// group, the audit view's row sentences, the rule-from-park dialog's
// auto-generated name) -- one place decides how a rule's scope reads
// in English, so the same rule reads identically wherever it's shown.
// Pure and hardcoded (not routed through i18next, matching
// shared/paletteGroups.ts's own PALETTE_GROUP_LABEL precedent for a
// small, fixed, cross-bounded-context label set): every input is
// already-resolved label text, never an ID, so nothing here can drift
// out of sync with what a user actually picked.

export type RuleScopeKind = 'step' | 'workflow' | 'nodeType' | 'request' | 'everywhere'

// Classifies a rule's scope kind purely from which scope fields are
// set -- a step rule carries WorkflowID+NodeID (no NodeTypeID), so it
// classifies as 'step' before the plain WorkflowID-only check.
export function ruleScopeKind(rule: Pick<GuardrailRule, 'NodeTypeID' | 'RequestID' | 'WorkflowID' | 'NodeID'>): RuleScopeKind {
  if (rule.WorkflowID && rule.NodeID) return 'step'
  if (rule.WorkflowID) return 'workflow'
  if (rule.NodeTypeID) return 'nodeType'
  if (rule.RequestID) return 'request'
  return 'everywhere'
}

// A scope choice carries only resolved label text -- never a bare ID --
// so ruleScopeSentence/ruleNameForScope can never render an
// unresolved id to the user.
export type RuleScopeChoice =
  | { kind: 'step'; workflowLabel: string; nodeTypeLabel: string }
  | { kind: 'workflow'; workflowLabel: string }
  | { kind: 'nodeType'; nodeTypeLabel: string }
  | { kind: 'request'; requestLabel: string }

// The full-sentence description of a scope choice -- verbatim what a
// user reads on the rule-from-park radio group and on an existing
// rule's row in the Review "Rules" audit view.
export function ruleScopeSentence(scope: RuleScopeChoice): string {
  switch (scope.kind) {
    case 'step':
      return copy('views:guardrailRuleScope.step', { nodeType: scope.nodeTypeLabel, workflow: scope.workflowLabel })
    case 'workflow':
      return copy('views:guardrailRuleScope.workflow', { workflow: scope.workflowLabel })
    case 'nodeType':
      return copy('views:guardrailRuleScope.nodeType', { nodeType: scope.nodeTypeLabel })
    case 'request':
      return copy('views:guardrailRuleScope.request', { request: scope.requestLabel })
  }
}

// The short form a generated rule name embeds ("Allow {short form}").
function ruleScopeShortForm(scope: RuleScopeChoice): string {
  switch (scope.kind) {
    case 'step':
      return `${scope.nodeTypeLabel} in ${scope.workflowLabel}`
    case 'workflow':
      return scope.workflowLabel
    case 'nodeType':
      return `${scope.nodeTypeLabel} everywhere`
    case 'request':
      return scope.requestLabel
  }
}

// Rule-from-park only ever creates an allow or a deny rule (door 1's
// two dialog variants) -- never ask, so this stays a narrower type
// than the full guardrail Effect.
export type RuleFromParkEffect = 'allow' | 'deny'

// The rule-from-park dialog's auto-generated name, regenerated as the
// scope radio changes until the user edits the field by hand.
export function ruleNameForScope(effect: RuleFromParkEffect, scope: RuleScopeChoice): string {
  const verb = effect === 'allow' ? 'Allow' : 'Deny'
  return `${verb} ${ruleScopeShortForm(scope)}`
}

// A scope-less rule reaches nothing today -- guardrail.Rule.Validate()
// requires at least one scope field -- so this sentence covers the
// audit view's row rendering defensively rather than a state a user
// can actually reach through either dialog.
export const RULE_SCOPE_EVERYWHERE_SENTENCE = 'Applies everywhere.'

function labelFor(list: { ID: string; Label: string }[] | null | undefined, id: string): string {
  return list?.find((x) => x.ID === id)?.Label ?? id
}

// Resolves a STORED rule's scope fields back into a RuleScopeChoice for
// display (the audit view's row sentence, the edit dialog's static
// scope line) -- null for a scope-less rule (RULE_SCOPE_EVERYWHERE_SENTENCE
// covers that case instead). A step rule's NodeTypeID isn't stored on
// the rule itself (only WorkflowID+NodeID are, mirroring rule-from-
// park's own "Only this step" scope) -- resolved by looking up the
// workflow's own node, falling back to the raw id if that node was
// since deleted.
export function resolveScopeChoice(
  rule: Pick<GuardrailRule, 'NodeTypeID' | 'RequestID' | 'WorkflowID' | 'NodeID'>,
  workflows: Workflow[] | null,
  nodeTypes: NodeType[] | null,
  requests: HTTPRequest[] | null,
): RuleScopeChoice | null {
  switch (ruleScopeKind(rule)) {
    case 'step': {
      const wf = workflows?.find((w) => w.ID === rule.WorkflowID)
      const node = wf?.Nodes?.find((n) => n.ID === rule.NodeID)
      return {
        kind: 'step',
        workflowLabel: wf?.Label ?? rule.WorkflowID,
        nodeTypeLabel: node ? labelFor(nodeTypes, node.NodeTypeID) : rule.NodeID,
      }
    }
    case 'workflow':
      return { kind: 'workflow', workflowLabel: labelFor(workflows, rule.WorkflowID) }
    case 'nodeType':
      return { kind: 'nodeType', nodeTypeLabel: labelFor(nodeTypes, rule.NodeTypeID) }
    case 'request':
      return { kind: 'request', requestLabel: labelFor(requests, rule.RequestID) }
    case 'everywhere':
      return null
  }
}
