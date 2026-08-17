import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, IconButton, Stack, Text } from '@primer/react'
import { BugIcon, KebabHorizontalIcon, ShieldIcon } from '@primer/octicons-react'
import { GuardrailService } from '../shared/bindings'
import type { GuardrailRule, RuleTestResult } from '../shared/bindings'
import { StatusStamp } from '../shared/StatusStamp'
import type { StatusStampVariant } from '../shared/StatusStamp'
import { GuardrailRuleDialog } from '../shared/GuardrailRuleDialog'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { useNodeBreakpoint } from './breakpoints'
import styles from '../shared/ListCard.module.css'

// Read-only guardrail visibility for the selected step (docs/adr/0022's
// Update): shows the step's LIVE verdict -- the same evaluation the
// execution gate runs, so what you see here is what a run will do (§1's
// what-you-see-is-what-I-see thesis applied to the guardrail itself).
//
// Rule AUTHORING stays off the step editor -- putting rule creation
// here made policy look like step config, which it isn't. Policy is
// authored through the three-door model instead (goal 0078):
// rule-from-park (a parked run's own "Always allow/deny…"), this
// section's own "Rules for this step" list below (edit/remove an
// already-matching rule, never create one from scratch), and the
// Review "Rules" audit view (create/edit/delete for completeness).
//
// The breakpoint status line below is a NAMED EXCEPTION to that rule
// (docs/adr/0031 item 1): a breakpoint borrows the guardrail Rule/park
// plumbing without being policy -- exactly one instance-scoped
// Source:debug rule for this node, never a policy rule. Goal 0022
// moved the actual toggle OFF this Inspector panel and onto the node
// card itself (owner: "not sure why the debug is at the node level?" --
// the same "policy is not step config" lesson, applied to a debug
// control instead of an authoring one) -- this section now only
// SHOWS the current state, read from the same shared BreakpointContext
// (breakpoints.ts) the card's own dot reads, never its own fetch/CRUD.

function effectTextFor(t: (key: string) => string): Record<string, string> {
  return {
    allow: t('nodeGuardrailSection.effect.allow'),
    ask: t('nodeGuardrailSection.effect.ask'),
    deny: t('nodeGuardrailSection.effect.deny'),
  }
}

function effectVariant(effect: string): StatusStampVariant {
  return effect === 'deny' ? 'danger' : effect === 'ask' ? 'caution' : 'success'
}

export function NodeGuardrailSection({ workflowId, nodeId }: { workflowId: string; nodeId: string }) {
  const { t } = useTranslation('composition')
  const EFFECT_TEXT = effectTextFor(t)
  const [verdict, setVerdict] = useState<RuleTestResult | null>(null)
  const breakpoint = useNodeBreakpoint(nodeId)
  // Door 2 (goal 0078): the rules that actually apply to this step,
  // edit/remove only -- see this file's header for why create stays
  // off this panel.
  const [rules, setRules] = useState<GuardrailRule[]>([])
  const [editing, setEditing] = useState<GuardrailRule | null>(null)

  const refreshRules = () => {
    GuardrailService.RulesForStep(workflowId, nodeId).then((r) => setRules(r ?? [])).catch(() => setRules([]))
  }

  useEffect(() => {
    GuardrailService.TestRules(workflowId, nodeId).then(setVerdict).catch(() => setVerdict(null))
    refreshRules()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshRules is derived from workflowId/nodeId, not independent reactive state
  }, [workflowId, nodeId])

  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<GuardrailRule>({
    entityType: 'rule',
    labelOf: (r) => r.Label,
    onConfirm: (r) => { GuardrailService.DeleteRule(r.ID).then(refreshRules).catch(() => {}) },
  })

  return (
    <Stack direction="vertical" gap="condensed" data-testid="node-guardrail-section">
      {verdict && (
        <>
          <Stack direction="horizontal" gap="condensed" align="center">
            <ShieldIcon size={16} />
            <StatusStamp
              variant={verdict.effect === 'deny' ? 'danger' : verdict.effect === 'ask' ? 'caution' : 'success'}
              data-testid="node-guardrail-verdict"
            >
              {verdict.effect}
            </StatusStamp>
          </Stack>
          <Text size="small" className={styles.muted}>
            {t('nodeGuardrailSection.stepEffect', {
              effectText: EFFECT_TEXT[verdict.effect] ?? verdict.effect,
              suffix: verdict.ruleLabel
                ? t('nodeGuardrailSection.ruleSuffix', { rule: verdict.ruleLabel })
                : verdict.effectClass === 'external' ? t('nodeGuardrailSection.externalSuffix') : t('nodeGuardrailSection.plainSuffix'),
            })}
          </Text>
        </>
      )}
      <Stack direction="horizontal" gap="condensed" align="center">
        <BugIcon size={16} fill={breakpoint.isSet ? 'var(--fgColor-accent)' : 'var(--fgColor-muted)'} />
        <Text size="small" data-testid="breakpoint-status">
          {t('nodeGuardrailSection.breakpointHint', {
            state: breakpoint.isSet ? t('nodeGuardrailSection.breakpointSet') : t('nodeGuardrailSection.noBreakpoint'),
            action: breakpoint.isSet ? t('nodeGuardrailSection.removeIt') : t('nodeGuardrailSection.addOne'),
          })}
        </Text>
        {breakpoint.isSet && (
          <StatusStamp variant="identity" data-testid="breakpoint-badge">{t('nodeGuardrailSection.breakpointBadge')}</StatusStamp>
        )}
      </Stack>
      <Text size="small" className={styles.muted}>
        {t('nodeGuardrailSection.breakpointDescription')}
      </Text>

      <Text size="small" weight="semibold" data-testid="node-guardrail-rules-heading">
        {t('nodeGuardrailSection.rulesForStepHeading')}
      </Text>
      {rules.length === 0 ? (
        <Text size="small" className={styles.muted} data-testid="node-guardrail-no-rules">
          {t('nodeGuardrailSection.noRulesApply')}
        </Text>
      ) : (
        <Stack direction="vertical" gap="condensed" data-testid="node-guardrail-rules-list">
          {rules.map((rule) => (
            <Stack key={rule.ID} direction="horizontal" gap="condensed" align="center" justify="space-between" data-testid="node-guardrail-rule-row">
              <Stack direction="horizontal" gap="condensed" align="center">
                <Text size="small">{rule.Label}</Text>
                <StatusStamp variant={effectVariant(rule.Effect)}>{rule.Effect}</StatusStamp>
              </Stack>
              <ActionMenu>
                <ActionMenu.Anchor>
                  <IconButton
                    icon={KebabHorizontalIcon}
                    aria-label={t('nodeGuardrailSection.kebabAriaLabel', { label: rule.Label })}
                    size="small"
                    variant="invisible"
                    data-testid="node-guardrail-rule-menu"
                  />
                </ActionMenu.Anchor>
                <ActionMenu.Overlay>
                  <ActionList>
                    <ActionList.Item onSelect={() => setEditing(rule)} data-testid="node-guardrail-rule-edit">
                      {t('nodeGuardrailSection.editMenuItem')}
                    </ActionList.Item>
                    <ActionList.Item variant="danger" onSelect={() => requestDelete(rule)} data-testid="node-guardrail-rule-remove">
                      {t('nodeGuardrailSection.removeMenuItem')}
                    </ActionList.Item>
                  </ActionList>
                </ActionMenu.Overlay>
              </ActionMenu>
            </Stack>
          ))}
        </Stack>
      )}
      {confirmDialog}
      {editing && (
        <GuardrailRuleDialog rule={editing} onClose={() => setEditing(null)} onSaved={refreshRules} />
      )}
    </Stack>
  )
}
