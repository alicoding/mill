import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, Heading, IconButton, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import type { RuleGroupType } from 'react-querybuilder'
import { QueryBuilder } from 'react-querybuilder'
import 'react-querybuilder/dist/query-builder.css'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { translateToExpr, fieldsFromAttributes } from './ruleTranslate'
import { CodeConfigField } from './CodeConfigField'
import styles from '../shared/ListCard.module.css'

// The ruleset node's rules editor (docs/adr/0023). Each rule's
// condition is authored with the SAME visual builder Decision edges use
// (react-querybuilder + ruleTranslate → expr-lang), resolving the node-
// maturity audit's top finding (goal 0001): two condition surfaces, one
// visual one raw, was the app's biggest inconsistency. Fields come from
// the owning workflow's declared Attributes; a raw expression input
// stays as the power-user fallback, exactly as on Decision edges.

interface RulesetRule {
  name: string
  condition: string
}

const EMPTY_QUERY: RuleGroupType = { combinator: 'and', rules: [] }

function parseRules(raw: string): RulesetRule[] {
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function RulesetEditor({ rulesRaw, attrs, onChange }: {
  rulesRaw: string
  attrs: AttributeDef[]
  onChange: (raw: string) => void
}) {
  const { t } = useTranslation('composition')
  const rules = parseRules(rulesRaw)
  const fields = fieldsFromAttributes(attrs)
  // One in-progress visual query per rule index (local; the committed
  // value is the translated string stored in each rule's condition).
  const [queries, setQueries] = useState<Record<number, RuleGroupType>>({})
  // The visual builder above stays the primary editing surface; this is
  // the power-user JSON fallback for the whole rules array, the same
  // raw-expression escape hatch already offered per-rule below, applied
  // once to the array as a whole.
  const [jsonOpen, setJsonOpen] = useState(false)
  const write = (next: RulesetRule[]) => onChange(JSON.stringify(next))

  return (
    <Stack direction="vertical" gap="condensed" data-testid="ruleset-editor">
      <Stack direction="horizontal" justify="space-between" align="center">
        <Heading as="h3" variant="small">{t('rulesetEditor.heading')}</Heading>
        <Button size="small" variant="invisible" data-testid="ruleset-toggle-json" onClick={() => setJsonOpen((v) => !v)}>
          {jsonOpen ? t('rulesetEditor.hideJsonEditor') : t('rulesetEditor.editAsJson')}
        </Button>
      </Stack>
      <Text size="small" className={styles.muted}>
        {t('rulesetEditor.description')}
      </Text>
      {jsonOpen && (
        <CodeConfigField
          value={rulesRaw}
          language="json"
          ariaLabel={t('rulesetEditor.rulesJsonAriaLabel')}
          testId="ruleset-json-editor"
          onCommit={onChange}
        />
      )}
      {rules.map((r, i) => (
        <Stack key={i} direction="vertical" gap="condensed" className={styles.card}>
          <Stack direction="horizontal" justify="space-between" align="center">
            <Text size="small" weight="semibold">{t('rulesetEditor.ruleN', { n: i + 1 })}</Text>
            <IconButton icon={TrashIcon} aria-label={t('rulesetEditor.deleteRuleAriaLabel', { n: i + 1 })} size="small" variant="invisible"
              onClick={() => write(rules.filter((_, j) => j !== i))} />
          </Stack>
          <FormControl>
            <FormControl.Label>{t('rulesetEditor.name')}</FormControl.Label>
            <TextInput
              size="small" block value={r.name} placeholder={t('rulesetEditor.namePlaceholder')}
              data-testid="ruleset-rule-name"
              onChange={(e) => write(rules.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            />
          </FormControl>
          {fields.length > 0 && (
            <>
              <QueryBuilder
                fields={fields}
                query={queries[i] ?? EMPTY_QUERY}
                onQueryChange={(q) => setQueries((prev) => ({ ...prev, [i]: q }))}
              />
              <Button size="small" data-testid="ruleset-apply-built"
                onClick={() => write(rules.map((x, j) => (j === i ? { ...x, condition: translateToExpr(queries[i] ?? EMPTY_QUERY) } : x)))}>
                {t('applyBuiltCondition')}
              </Button>
            </>
          )}
          <FormControl>
            <FormControl.Label>{fields.length > 0 ? t('editExpressionDirectly') : t('rulesetEditor.condition')}</FormControl.Label>
            <TextInput
              size="small" block value={r.condition} placeholder={t('rulesetEditor.conditionPlaceholder')}
              data-testid="ruleset-rule-condition"
              onChange={(e) => write(rules.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)))}
            />
          </FormControl>
        </Stack>
      ))}
      <div>
        <Button size="small" leadingVisual={PlusIcon} data-testid="ruleset-add-rule"
          onClick={() => write([...rules, { name: '', condition: '' }])}>
          {t('rulesetEditor.addRule')}
        </Button>
      </div>
    </Stack>
  )
}
