import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, IconButton, Stack, Text } from '@primer/react'
import { KebabHorizontalIcon, ShieldIcon } from '@primer/octicons-react'
import { GuardrailService } from '../shared/bindings'
import type { GuardrailRule, RuleTestResult } from '../shared/bindings'
import { StatusStamp } from '../shared/StatusStamp'
import type { StatusStampVariant } from '../shared/StatusStamp'
import { GuardrailRuleDialog } from '../shared/GuardrailRuleDialog'
import { useConfirmDelete } from '../shared/useConfirmDelete'
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
// Tier 2 of the inspector (goal 0327): this renders on the Settings
// tab, never between a step's parameters. Its data is fetched by the
// panel above (useStepGuardrail) so the Settings tab's own rule count
// and this list can never disagree; the breakpoint state that used to
// trail this section is its own group (NodeBreakpointSection).

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

export function NodeGuardrailSection({ verdict, rules, onRulesChanged }: {
  verdict: RuleTestResult | null
  rules: GuardrailRule[]
  onRulesChanged: () => void
}) {
  const { t } = useTranslation('composition')
  const EFFECT_TEXT = effectTextFor(t)
  const [editing, setEditing] = useState<GuardrailRule | null>(null)

  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<GuardrailRule>({
    entityType: 'rule',
    labelOf: (r) => r.Label,
    onConfirm: (r) => { GuardrailService.DeleteRule(r.ID).then(onRulesChanged).catch(() => {}) },
  })

  return (
    <Stack direction="vertical" gap="normal" data-testid="node-guardrail-section">
      <Stack direction="vertical" gap="condensed">
        <Text size="small" weight="semibold">{t('nodeInspector.approvalHeading')}</Text>
        {verdict && (
          <>
            <Stack direction="horizontal" gap="condensed" align="center">
              <ShieldIcon size={16} />
              <StatusStamp variant={effectVariant(verdict.effect)} data-testid="node-guardrail-verdict">
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
      </Stack>

      <Stack direction="vertical" gap="condensed">
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
      </Stack>
      {confirmDialog}
      {editing && (
        <GuardrailRuleDialog rule={editing} onClose={() => setEditing(null)} onSaved={onRulesChanged} />
      )}
    </Stack>
  )
}
