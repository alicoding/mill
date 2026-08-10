import { useState } from 'react'
import { Button, FormControl, Heading, IconButton, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import type { RuleGroupType } from 'react-querybuilder'
import { QueryBuilder } from 'react-querybuilder'
import 'react-querybuilder/dist/query-builder.css'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { translateToExpr, fieldsFromAttributes } from './ruleTranslate'
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
  const rules = parseRules(rulesRaw)
  const fields = fieldsFromAttributes(attrs)
  // One in-progress visual query per rule index (local; the committed
  // value is the translated string stored in each rule's condition).
  const [queries, setQueries] = useState<Record<number, RuleGroupType>>({})
  const write = (next: RulesetRule[]) => onChange(JSON.stringify(next))

  return (
    <Stack direction="vertical" gap="condensed" data-testid="ruleset-editor">
      <Heading as="h3" variant="small">Rules</Heading>
      <Text size="small" className={styles.muted}>
        Every rule must pass for the data to continue; any failing rule fails the run, named. Build a
        condition against this workflow's Attributes, or type an expr-lang expression directly — the same
        surface Decision branches use.
      </Text>
      {rules.map((r, i) => (
        <Stack key={i} direction="vertical" gap="condensed" className={styles.card}>
          <Stack direction="horizontal" justify="space-between" align="center">
            <Text size="small" weight="semibold">Rule {i + 1}</Text>
            <IconButton icon={TrashIcon} aria-label={`Delete rule ${i + 1}`} size="small" variant="invisible"
              onClick={() => write(rules.filter((_, j) => j !== i))} />
          </Stack>
          <FormControl>
            <FormControl.Label>Name</FormControl.Label>
            <TextInput
              size="small" block value={r.name} placeholder="e.g. amount below limit"
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
                Apply built condition
              </Button>
            </>
          )}
          <FormControl>
            <FormControl.Label>{fields.length > 0 ? 'Or edit the expression directly' : 'Condition'}</FormControl.Label>
            <TextInput
              size="small" block value={r.condition} placeholder={'e.g. Attributes["amount"] < 100'}
              data-testid="ruleset-rule-condition"
              onChange={(e) => write(rules.map((x, j) => (j === i ? { ...x, condition: e.target.value } : x)))}
            />
          </FormControl>
        </Stack>
      ))}
      <div>
        <Button size="small" leadingVisual={PlusIcon} data-testid="ruleset-add-rule"
          onClick={() => write([...rules, { name: '', condition: '' }])}>
          Add rule
        </Button>
      </div>
    </Stack>
  )
}
