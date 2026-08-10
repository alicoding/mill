import { describe, expect, it } from 'vitest'
import { translateToExpr, fieldsFromAttributes } from './ruleTranslate'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { RuleGroupType } from 'react-querybuilder'

describe('translateToExpr', () => {
  it('translates a single equality rule', () => {
    const query: RuleGroupType = {
      combinator: 'and',
      rules: [{ field: 'status', operator: '=', value: 'active' }],
    }
    expect(translateToExpr(query)).toBe('status == "active"')
  })

  it('joins multiple rules with && for the and combinator', () => {
    const query: RuleGroupType = {
      combinator: 'and',
      rules: [
        { field: 'count', operator: '>', value: 5 },
        { field: 'status', operator: '=', value: 'active' },
      ],
    }
    expect(translateToExpr(query)).toBe('count > 5 && status == "active"')
  })

  it('joins multiple rules with || for the or combinator', () => {
    const query: RuleGroupType = {
      combinator: 'or',
      rules: [
        { field: 'status', operator: '=', value: 'active' },
        { field: 'status', operator: '=', value: 'pending' },
      ],
    }
    expect(translateToExpr(query)).toBe('status == "active" || status == "pending"')
  })

  it('wraps a negated group in !(...)', () => {
    const query: RuleGroupType = {
      combinator: 'and',
      not: true,
      rules: [{ field: 'status', operator: '=', value: 'closed' }],
    }
    expect(translateToExpr(query)).toBe('!(status == "closed")')
  })

  it('translates nested groups with parentheses', () => {
    const query: RuleGroupType = {
      combinator: 'and',
      rules: [
        { field: 'urgent', operator: '=', value: true },
        {
          combinator: 'or',
          rules: [
            { field: 'status', operator: '=', value: 'active' },
            { field: 'status', operator: '=', value: 'pending' },
          ],
        },
      ],
    }
    expect(translateToExpr(query)).toBe('urgent == true && (status == "active" || status == "pending")')
  })

  it('translates in/notIn as a list membership check', () => {
    const query: RuleGroupType = {
      combinator: 'and',
      rules: [{ field: 'status', operator: 'in', value: 'active,pending' }],
    }
    expect(translateToExpr(query)).toBe('status in ["active", "pending"]')

    const notInQuery: RuleGroupType = {
      combinator: 'and',
      rules: [{ field: 'status', operator: 'notIn', value: 'active,pending' }],
    }
    expect(translateToExpr(notInQuery)).toBe('!(status in ["active", "pending"])')
  })

  it('translates contains/beginsWith/endsWith to expr-lang string ops', () => {
    const contains: RuleGroupType = { combinator: 'and', rules: [{ field: 'tag', operator: 'contains', value: 'urg' }] }
    expect(translateToExpr(contains)).toBe('tag contains "urg"')

    const beginsWith: RuleGroupType = { combinator: 'and', rules: [{ field: 'tag', operator: 'beginsWith', value: 'ur' }] }
    expect(translateToExpr(beginsWith)).toBe('tag startsWith "ur"')
  })

  it('translates null/notNull checks', () => {
    const isNull: RuleGroupType = { combinator: 'and', rules: [{ field: 'owner', operator: 'null', value: '' }] }
    expect(translateToExpr(isNull)).toBe('owner == nil')

    const notNull: RuleGroupType = { combinator: 'and', rules: [{ field: 'owner', operator: 'notNull', value: '' }] }
    expect(translateToExpr(notNull)).toBe('owner != nil')
  })

  it('returns "true" for an empty rule group', () => {
    const query: RuleGroupType = { combinator: 'and', rules: [] }
    expect(translateToExpr(query)).toBe('true')
  })

  it('formats numeric and boolean values without quotes', () => {
    const query: RuleGroupType = {
      combinator: 'and',
      rules: [{ field: 'count', operator: '=', value: 42 }],
    }
    expect(translateToExpr(query)).toBe('count == 42')
  })
})

// attr fills in the full AttributeDef/typedfield.Field shape (docs/adr/0029
// Phase 1) around the three fields this suite actually varies -- Key/
// Label/Type -- so each test case below doesn't have to repeat every
// zero-valued field.
function attr(key: string, label: string, type: ConfigFieldType): AttributeDef {
  return {
    Key: key, Label: label, Type: type,
    Required: false, Default: '', Description: '',
    Options: null, Suggestions: null,
    Secret: false, RefKind: '', Multiline: false, SystemManaged: false,
  }
}

describe('fieldsFromAttributes', () => {
  it('maps AttributeDef Type to react-querybuilder inputType/datatype', () => {
    const fields = fieldsFromAttributes([
      attr('count', 'Count', ConfigFieldType.TypeNumber),
      attr('urgent', 'Urgent', ConfigFieldType.TypeBoolean),
      attr('status', 'Status', ConfigFieldType.TypeText),
    ])
    expect(fields).toEqual([
      { name: 'count', label: 'Count', inputType: 'number', datatype: 'number' },
      { name: 'urgent', label: 'Urgent', inputType: 'checkbox', datatype: 'boolean' },
      { name: 'status', label: 'Status', inputType: 'text', datatype: 'string' },
    ])
  })

  it('returns an empty array for null/undefined attrs', () => {
    expect(fieldsFromAttributes(null)).toEqual([])
    expect(fieldsFromAttributes(undefined)).toEqual([])
  })
})
