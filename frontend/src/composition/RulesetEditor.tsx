import { Button, FormControl, Heading, IconButton, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import styles from '../shared/ListCard.module.css'

// The ruleset node's rules editor (docs/adr/0023): named rules over
// the step's data, stored as JSON in the node's rulesJSON config --
// same undeclared-config-key pattern IntegrationBindingsEditor already
// uses. Conditions are the one expression surface Mill already has
// (expr-lang over Payload/Attributes/Config, the Decision-edge
// language); no new syntax invented, per the adopt-headless decision.

interface RulesetRule {
  name: string
  condition: string
}

function parseRules(raw: string): RulesetRule[] {
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function RulesetEditor({ rulesRaw, onChange }: {
  rulesRaw: string
  onChange: (raw: string) => void
}) {
  const rules = parseRules(rulesRaw)
  const write = (next: RulesetRule[]) => onChange(JSON.stringify(next))

  return (
    <Stack direction="vertical" gap="condensed" data-testid="ruleset-editor">
      <Heading as="h3" variant="small">Rules</Heading>
      <Text size="small" className={styles.muted}>
        Every rule must pass for the data to continue; any failing rule fails the run, named.
        Conditions use the same expression language as Decision edges, over Payload / Attributes /
        Config.
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
          <FormControl>
            <FormControl.Label>Condition</FormControl.Label>
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
