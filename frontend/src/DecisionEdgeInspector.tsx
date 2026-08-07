import { useState } from 'react'
import type { RuleGroupType } from 'react-querybuilder'
import { QueryBuilder } from 'react-querybuilder'
import 'react-querybuilder/dist/query-builder.css'
import { Button, Checkbox, FormControl, Stack, Text, TextInput } from '@primer/react'
import type { AttributeDef } from '../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { translateToExpr, fieldsFromAttributes } from './ruleTranslate'
import runbookStyles from './ListCard.module.css'

const OTHERWISE = 'otherwise'
const EMPTY_QUERY: RuleGroupType = { combinator: 'and', rules: [] }

interface DecisionEdgeInspectorProps {
  edgeId: string
  condition: string
  attrs: AttributeDef[] | null | undefined
  onApply: (condition: string) => void
}

// Shown in the Inspector when a Decision node's outgoing edge is
// selected (CompositionCanvas.tsx's onEdgeClick) -- lets a user either
// mark the edge as the required "otherwise" fallback (composition.go's
// otherwiseHandle, ValidateGraph requires exactly one per Decision node)
// or build a real expr-lang condition visually via react-querybuilder,
// translated on Apply (ruleTranslate.ts). There is no reverse parser --
// the builder always starts empty, never pre-populated from an existing
// saved condition (see ruleTranslate.ts's own doc comment) -- so the
// current condition is also always shown as read-only text, and a raw
// text input is offered as the power-user path for editing it directly.
export function DecisionEdgeInspector({ edgeId, condition, attrs, onApply }: DecisionEdgeInspectorProps) {
  const [query, setQuery] = useState<RuleGroupType>(EMPTY_QUERY)
  const [rawValue, setRawValue] = useState(condition)
  const isOtherwise = condition === OTHERWISE
  const fields = fieldsFromAttributes(attrs)

  return (
    <Stack direction="vertical" gap="condensed" key={edgeId}>
      <Text weight="semibold">Decision branch</Text>
      <Text size="small" className={runbookStyles.muted}>
        Current condition: {condition ? <code>{condition}</code> : '(not set)'}
      </Text>

      <Checkbox
        checked={isOtherwise}
        onChange={(e) => onApply(e.target.checked ? OTHERWISE : '')}
      />
      <Text size="small">This is the fallback ("otherwise") branch</Text>

      {!isOtherwise && (
        <>
          {fields.length === 0 && (
            <Text size="small" className={runbookStyles.muted}>
              This workflow has no Attributes yet -- add some on the Configure page to build a condition against
              them, or type an expression directly below.
            </Text>
          )}
          {fields.length > 0 && (
            <>
              <QueryBuilder fields={fields} query={query} onQueryChange={setQuery} />
              <Button size="small" onClick={() => onApply(translateToExpr(query))}>
                Apply built condition
              </Button>
            </>
          )}

          <FormControl>
            <FormControl.Label>Or edit the expression directly</FormControl.Label>
            <FormControl.Caption>
              An expr-lang boolean expression (e.g. <code>count &gt; 5 &amp;&amp; status == "active"</code>).
            </FormControl.Caption>
            <TextInput
              value={rawValue}
              onChange={(e) => setRawValue(e.target.value)}
              onBlur={() => onApply(rawValue)}
              block
            />
          </FormControl>
        </>
      )}
    </Stack>
  )
}
