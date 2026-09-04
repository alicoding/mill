import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RuleGroupType } from 'react-querybuilder'
import { QueryBuilder } from 'react-querybuilder'
import 'react-querybuilder/dist/query-builder.css'
import { Button, FormControl, Text, TextInput } from '@primer/react'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { translateToExpr, fieldsFromAttributes } from './ruleTranslate'
import runbookStyles from '../shared/ListCard.module.css'

const EMPTY_QUERY: RuleGroupType = { combinator: 'and', rules: [] }

interface DecisionConditionEditorProps {
  attrs: AttributeDef[] | null | undefined
  condition: string
  onApply: (condition: string) => void
  // The save-time compile rejection for THIS condition (ValidateDraft's
  // Issue.Message, matched by edge id), shown inline instead of a raw
  // expr-lang compiler error -- docs/goals/0173.
  errorMessage?: string
}

// The visual condition-authoring surface (react-querybuilder ->
// expr-lang via ruleTranslate.ts) shared by DecisionEdgeInspector (the
// canvas edge-click flow) and DecisionRuleRow (the Branch node's Rules
// panel, docs/goals/0173) -- one editor, two entry points, so a
// condition is authored identically regardless of which surface opened
// it. There is no reverse parser -- the builder always starts empty,
// never pre-populated from an already-saved expression (see
// ruleTranslate.ts's own doc comment) -- so a raw text input stays the
// power-user path for editing an existing condition directly.
export function DecisionConditionEditor({ attrs, condition, onApply, errorMessage }: DecisionConditionEditorProps) {
  const { t } = useTranslation('composition')
  const [query, setQuery] = useState<RuleGroupType>(EMPTY_QUERY)
  const [rawValue, setRawValue] = useState(condition)
  const fields = fieldsFromAttributes(attrs)

  return (
    <>
      {fields.length === 0 && (
        <Text size="small" className={runbookStyles.muted}>
          {t('decisionEdgeInspector.noAttributesYet')}
        </Text>
      )}
      {fields.length > 0 && (
        <>
          <QueryBuilder fields={fields} query={query} onQueryChange={setQuery} />
          <Button size="small" onClick={() => onApply(translateToExpr(query))}>
            {t('applyBuiltCondition')}
          </Button>
        </>
      )}

      <FormControl>
        <FormControl.Label>{t('editExpressionDirectly')}</FormControl.Label>
        <FormControl.Caption>
          {/* expr-lang code syntax, not natural-language copy --
              deliberately untranslated (docs/goals/0032's guard
              rule allowlist). */}
          {t('decisionEdgeInspector.expressionCaptionPrefix')} <code>count &gt; 5 &amp;&amp; status == "active"</code>{t('decisionEdgeInspector.expressionCaptionSuffix')}
        </FormControl.Caption>
        <TextInput
          value={rawValue}
          onChange={(e) => setRawValue(e.target.value)}
          onBlur={() => onApply(rawValue)}
          block
        />
        {errorMessage && <FormControl.Validation variant="error">{errorMessage}</FormControl.Validation>}
      </FormControl>
    </>
  )
}
