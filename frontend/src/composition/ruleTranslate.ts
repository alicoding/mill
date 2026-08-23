import type { RuleGroupTypeAny, RuleType, Field } from 'react-querybuilder'
import { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
// ConfigFieldType (composition/models.ts's old name) resolved to a pure
// Go type alias of typedfield.Type (docs/adr/0029 Phase 1) -- wails3's
// binding generator doesn't preserve alias names, it emits the
// canonical type once under its owning package, so this now imports
// typedfield's own Type enum directly, aliased back to the familiar
// local name.
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'

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

// Mirrors composition.go's own otherwiseHandle sentinel -- a Decision
// edge's SourceHandle equal to this literal string IS the mandatory
// fallback (ValidateGraph's otherwiseCount check, nextNode's routing).
// Shared here (rather than redeclared per file) so DecisionEdgeInspector,
// canvasStore's auto-fallback assignment, and the Rules panel (goal 0173)
// can't drift on the literal.
export const OTHERWISE_HANDLE = 'otherwise'

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
// is deliberately excluded: ConfigureAttributes.tsx's own type picker
// doesn't offer FieldOptions for an Attribute (docs/adr/0029 Phase 1 --
// AttributeDef's Options field exists structurally now, but no
// authoring UI populates it yet), so an Options-typed Attribute never
// actually occurs and there's nothing to build a select input from.
export function fieldsFromAttributes(attrs: AttributeDef[] | null | undefined): Field[] {
  return (attrs ?? []).map((a) => ({
    name: a.Key,
    label: a.Label || a.Key,
    inputType: a.Type === ConfigFieldType.TypeNumber ? 'number' : a.Type === ConfigFieldType.TypeBoolean ? 'checkbox' : 'text',
    datatype: a.Type === ConfigFieldType.TypeNumber ? 'number' : a.Type === ConfigFieldType.TypeBoolean ? 'boolean' : 'string',
  }))
}
