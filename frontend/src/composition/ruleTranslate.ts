import type { RuleGroupTypeAny, RuleType, Field } from 'react-querybuilder'
import { AttributeDef, ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// Bridges react-querybuilder's own query-tree shape to a real expr-lang
// expression string -- the format composition.go's expression adapter
// (internal/adapters/expression) actually compiles/evaluates a Decision
// edge's SourceHandle against (docs/SPEC.md §3.5). Checked directly
// against a real expr-lang program (not assumed) that ==, !=, <, >, <=,
// >=, &&, ||, !, in [...], contains, startsWith, endsWith are all valid
// expr-lang syntax before writing this mapping.
//
// One-way only: this translates a freshly-built query into an expr-lang
// string for saving, but there is no reverse parser to load an already-
// saved expression string back into the visual tree -- writing a real
// expr-lang parser in TypeScript is its own project, out of scope here.
// CompositionCanvas.tsx's DecisionEdgeInspector accordingly always starts
// the builder from an empty query and shows the current saved expression
// as read-only text alongside it, rather than pretending to round-trip.

const OPERATOR_TEMPLATES: Record<string, (field: string, value: string) => string> = {
  '=': (f, v) => `${f} == ${v}`,
  '!=': (f, v) => `${f} != ${v}`,
  '<': (f, v) => `${f} < ${v}`,
  '>': (f, v) => `${f} > ${v}`,
  '<=': (f, v) => `${f} <= ${v}`,
  '>=': (f, v) => `${f} >= ${v}`,
  contains: (f, v) => `${f} contains ${v}`,
  doesNotContain: (f, v) => `!(${f} contains ${v})`,
  beginsWith: (f, v) => `${f} startsWith ${v}`,
  doesNotBeginWith: (f, v) => `!(${f} startsWith ${v})`,
  endsWith: (f, v) => `${f} endsWith ${v}`,
  doesNotEndWith: (f, v) => `!(${f} endsWith ${v})`,
}

// formatValue quotes a string value as an expr-lang string literal
// (JSON's escaping rules are a safe superset of what expr-lang needs);
// numbers/booleans pass through bare so `count > 5` compiles as a
// numeric comparison, not a string one.
function formatValue(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(String(value ?? ''))
}

function splitListValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  return String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

function translateRule(rule: RuleType): string {
  switch (rule.operator) {
    case 'null':
      return `${rule.field} == nil`
    case 'notNull':
      return `${rule.field} != nil`
    case 'in':
    case 'notIn': {
      const list = `[${splitListValue(rule.value).map(formatValue).join(', ')}]`
      const expr = `${rule.field} in ${list}`
      return rule.operator === 'notIn' ? `!(${expr})` : expr
    }
    case 'between':
    case 'notBetween': {
      const [lo, hi] = splitListValue(rule.value)
      const expr = `(${rule.field} >= ${formatValue(lo)} && ${rule.field} <= ${formatValue(hi)})`
      return rule.operator === 'notBetween' ? `!${expr}` : expr
    }
    default: {
      const build = OPERATOR_TEMPLATES[rule.operator]
      return build ? build(rule.field, formatValue(rule.value)) : 'true'
    }
  }
}

// translateToExpr walks a react-querybuilder query tree (RuleGroupType,
// possibly nested) into one expr-lang boolean expression string --
// combinator 'or' becomes '||', 'and' becomes '&&', a group's own `not`
// wraps the whole thing in a leading '!(...)'.
export function translateToExpr(query: RuleGroupTypeAny): string {
  const combinatorJoin = 'combinator' in query && query.combinator === 'or' ? ' || ' : ' && '
  const rules = 'rules' in query ? query.rules : []
  const parts = rules
    .map((r) => ('field' in r ? translateRule(r as RuleType) : `(${translateToExpr(r as RuleGroupTypeAny)})`))
    .filter(Boolean)

  if (parts.length === 0) return 'true'
  const joined = parts.length === 1 ? parts[0] : parts.join(combinatorJoin)
  return 'not' in query && query.not ? `!(${joined})` : joined
}

// fieldsFromAttributes maps a workflow's declared Attributes schema
// (Configure-authored, docs/SPEC.md §3.5) into react-querybuilder's own
// Field[] shape -- what the rule builder offers to pick from. FieldOptions
// is deliberately excluded: composition.AttributeDef carries no Options
// list (unlike composition.ConfigField), so an Options-typed Attribute
// has no defined choices to build a select input from -- a real, scoped
// gap, not an oversight (see ConfigureAttributes.tsx's own type picker,
// which doesn't offer "Options" for the same reason).
export function fieldsFromAttributes(attrs: AttributeDef[] | null | undefined): Field[] {
  return (attrs ?? []).map((a) => ({
    name: a.Key,
    label: a.Label || a.Key,
    inputType: a.Type === ConfigFieldType.FieldNumber ? 'number' : a.Type === ConfigFieldType.FieldBoolean ? 'checkbox' : 'text',
    datatype: a.Type === ConfigFieldType.FieldNumber ? 'number' : a.Type === ConfigFieldType.FieldBoolean ? 'boolean' : 'string',
  }))
}
