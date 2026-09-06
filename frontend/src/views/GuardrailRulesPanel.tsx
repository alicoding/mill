import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, ActionMenu, Button, IconButton, Stack, Text } from '@primer/react'
import { Blankslate } from '@primer/react/experimental'
import { KebabHorizontalIcon, ShieldIcon } from '@primer/octicons-react'
import { GuardrailService } from '../shared/bindings'
import type { GuardrailRule } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { StatusStamp } from '../shared/StatusStamp'
import type { StatusStampVariant } from '../shared/StatusStamp'
import { GuardrailRuleDialog } from '../shared/GuardrailRuleDialog'
import { useConfirmDelete } from '../shared/useConfirmDelete'
import { ContextMenu } from '../shared/ContextMenu'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { resolveScopeChoice, ruleScopeKind, ruleScopeSentence, RULE_SCOPE_EVERYWHERE_SENTENCE } from '../shared/guardrailRuleScope'
import listStyles from '../shared/ListCard.module.css'
import { background } from '../shared/background'
import { entityRowContext } from '../shared/entityRowCommands'
import { copy } from '../shared/copy'
import { useUISignalStore } from '../shared/uiSignalStore'

function effectVariant(effect: string): StatusStampVariant {
  return effect === 'deny' ? 'danger' : effect === 'ask' ? 'caution' : 'success'
}

interface Group { key: string; title: string; rules: GuardrailRule[] }

function RuleRow({ rule, sentence, onEdit, onRemove, onOpenMenu }: {
  rule: GuardrailRule
  sentence: string
  onEdit: () => void
  onRemove: () => void
  onOpenMenu: (state: ContextMenuState) => void
}) {
  const { t } = useTranslation('views')
  // The row's registry commands over its entity context (goal 0346
  // slice B); the delete's question is phrased here, where the label is.
  const ctx = entityRowContext('rule', rule.ID)
  const items: ContextMenuItem[] = [
    { id: 'edit', label: t('guardrailRulesPanel.editMenuItem'), commandId: 'guardrail.rule.edit', ctx },
    {
      id: 'remove', label: t('guardrailRulesPanel.removeMenuItem'), commandId: 'guardrail.rule.delete', ctx, danger: true,
      confirm: { title: copy('confirmDelete.title', { entityType: 'rule' }), body: copy('confirmDelete.body', { label: rule.Label }) },
    },
  ]
  return (
    <ActionList.Item
      onSelect={onEdit}
      data-testid="guardrail-rule-row"
      data-rule-id={rule.ID}
      onContextMenu={(e) => { e.preventDefault(); onOpenMenu({ x: e.clientX, y: e.clientY, items }) }}
    >
      <Stack direction="horizontal" gap="condensed" align="center">
        <Text weight="semibold">{rule.Label}</Text>
        <StatusStamp variant={effectVariant(rule.Effect)} data-testid="guardrail-rule-effect">{rule.Effect}</StatusStamp>
      </Stack>
      <ActionList.Description variant="block">
        <span className={listStyles.muted} data-testid="guardrail-rule-sentence">{sentence}</span>
      </ActionList.Description>
      <ActionList.TrailingVisual>
        <div style={{ pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <ActionMenu>
            <ActionMenu.Anchor>
              <IconButton
                icon={KebabHorizontalIcon}
                aria-label={t('guardrailRulesPanel.kebabAriaLabel', { label: rule.Label })}
                size="small"
                variant="invisible"
                data-testid="guardrail-rule-menu"
              />
            </ActionMenu.Anchor>
            <ActionMenu.Overlay>
              <ActionList>
                <ActionList.Item onSelect={onEdit} data-testid="guardrail-rule-edit">{t('guardrailRulesPanel.editMenuItem')}</ActionList.Item>
                <ActionList.Item variant="danger" onSelect={onRemove} data-testid="guardrail-rule-remove">
                  {t('guardrailRulesPanel.removeMenuItem')}
                </ActionList.Item>
              </ActionList>
            </ActionMenu.Overlay>
          </ActionMenu>
        </div>
      </ActionList.TrailingVisual>
    </ActionList.Item>
  )
}

// Door 3 (goal 0078): the Review "Rules" tab -- every policy rule
// (SourceDebug breakpoints excluded, docs/adr/0031), grouped by what
// they scope, with create/edit/delete for completeness (doors 1/2
// cover create-from-park and edit-in-context; this is the one door
// that also creates from scratch). Grouping order: Everywhere, then
// one group per workflow that has a rule (workflow- and step-scoped
// rules both land here -- a step rule is still fundamentally
// workflow-scoped), then step type, then connector request.
export function GuardrailRulesPanel() {
  const { t } = useTranslation('views')
  const workflows = useAppStore((s) => s.workflows)
  const nodeTypes = useAppStore((s) => s.nodeTypes)
  const requests = useAppStore((s) => s.requests)
  const [rules, setRules] = useState<GuardrailRule[] | null>(null)
  const [editing, setEditing] = useState<GuardrailRule | 'new' | null>(null)
  const [rowMenu, setRowMenu] = useState<ContextMenuState | null>(null)

  const refresh = () => {
    GuardrailService.Rules()
      .then((r) => setRules((r ?? []).filter((rule) => rule.Source !== 'debug')))
      .catch(() => setRules([]))
  }
  // Reloads on mount and after a registry command's delete (the
  // guardrail.rule.delete command bumps the revision).
  const rulesRevision = useUISignalStore((s) => s.guardrailRulesRevision)
  useEffect(refresh, [rulesRevision])

  // guardrail.rule.edit opens the same form the row's own click does.
  const editRequest = useUISignalStore((s) => s.guardrailRuleEditRequest)
  useEffect(() => {
    if (!editRequest) return
    const rule = rules?.find((r) => r.ID === editRequest.id)
    if (rule) setEditing(rule)
    // rules is read at request time only -- the request is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest])

  const { requestDelete, dialog: confirmDialog } = useConfirmDelete<GuardrailRule>({
    entityType: 'rule',
    labelOf: (r) => r.Label,
    onConfirm: (r) => { void background(GuardrailService.DeleteRule(r.ID).then(refresh), 'guardrailRules.deleteRule') },
  })

  if (rules === null) return null

  const workflowLabel = (id: string) => workflows?.find((w) => w.ID === id)?.Label ?? id
  const sentenceFor = (rule: GuardrailRule) => {
    const scope = resolveScopeChoice(rule, workflows, nodeTypes, requests)
    return scope ? ruleScopeSentence(scope) : RULE_SCOPE_EVERYWHERE_SENTENCE
  }

  const everywhere = rules.filter((r) => ruleScopeKind(r) === 'everywhere')
  const byWorkflowId = rules
    .filter((r) => ruleScopeKind(r) === 'step' || ruleScopeKind(r) === 'workflow')
    .reduce<Record<string, GuardrailRule[]>>((acc, r) => {
      (acc[r.WorkflowID] ??= []).push(r)
      return acc
    }, {})
  const workflowGroups: Group[] = Object.entries(byWorkflowId)
    .map(([wfId, rs]) => ({ key: `workflow-${wfId}`, title: workflowLabel(wfId), rules: rs }))
    .sort((a, b) => a.title.localeCompare(b.title))
  const byNodeType = rules.filter((r) => ruleScopeKind(r) === 'nodeType')
  const byRequest = rules.filter((r) => ruleScopeKind(r) === 'request')

  const groups: Group[] = [
    ...(everywhere.length > 0 ? [{ key: 'everywhere', title: t('guardrailRulesPanel.groupEverywhere'), rules: everywhere }] : []),
    ...workflowGroups,
    ...(byNodeType.length > 0 ? [{ key: 'nodetype', title: t('guardrailRulesPanel.groupStepType'), rules: byNodeType }] : []),
    ...(byRequest.length > 0 ? [{ key: 'request', title: t('guardrailRulesPanel.groupRequest'), rules: byRequest }] : []),
  ]

  return (
    <Stack direction="vertical" gap="normal" data-testid="guardrail-rules-panel">
      <Stack direction="horizontal" gap="condensed" align="center" justify="space-between">
        <Text size="small" className={listStyles.muted} data-testid="guardrail-rules-count">
          {t('guardrailRulesPanel.countLabel', { count: rules.length, plural: rules.length === 1 ? '' : 's' })}
        </Text>
        <Button size="small" variant="primary" onClick={() => setEditing('new')} data-testid="guardrail-rules-new">
          {t('guardrailRulesPanel.newRuleButton')}
        </Button>
      </Stack>

      {rules.length === 0 ? (
        <Blankslate data-testid="guardrail-rules-empty">
          <Blankslate.Visual><ShieldIcon size={32} /></Blankslate.Visual>
          <Blankslate.Heading>{t('guardrailRulesPanel.emptyHeading')}</Blankslate.Heading>
          <Blankslate.Description>{t('guardrailRulesPanel.emptyDescription')}</Blankslate.Description>
        </Blankslate>
      ) : (
        <ActionList showDividers data-testid="guardrail-rules-list">
          {groups.map((g) => (
            <ActionList.Group key={g.key} data-testid="guardrail-rules-group" data-group-key={g.key}>
              <ActionList.GroupHeading as="h3">{g.title}</ActionList.GroupHeading>
              {g.rules.map((rule) => (
                <RuleRow
                  key={rule.ID}
                  rule={rule}
                  sentence={sentenceFor(rule)}
                  onEdit={() => setEditing(rule)}
                  onRemove={() => requestDelete(rule)}
                  onOpenMenu={setRowMenu}
                />
              ))}
            </ActionList.Group>
          ))}
        </ActionList>
      )}

      <ContextMenu state={rowMenu} onClose={() => setRowMenu(null)} />
      {confirmDialog}

      {editing && (
        <GuardrailRuleDialog
          rule={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </Stack>
  )
}
