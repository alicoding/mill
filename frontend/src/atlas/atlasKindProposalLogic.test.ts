import { describe, expect, it } from 'vitest'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { buildProposalFields, initialProposalState, proposalNameTaken, type KindProposalState } from './atlasKindProposalLogic'

describe('initialProposalState', () => {
  it('derives the Type name from the scan root\'s own last path segment', () => {
    expect(initialProposalState('/Users/ali/Documents/kind-proposal-folder', []).name).toBe('kind-proposal-folder')
  })

  it('handles a backslash-separated (Windows-style) root the same way', () => {
    expect(initialProposalState('C:\\Users\\ali\\Documents\\kind-proposal-folder', []).name).toBe('kind-proposal-folder')
  })

  it('maps every inferred field to an included row, carrying its own inferred shape forward', () => {
    const inferred: Field[] = [
      { Key: 'owner', Label: 'Owner', Type: FieldType.TypeOptions, Options: ['alice', 'bob'], ShowOnCard: true } as Field,
      { Key: 'ticket', Label: 'Ticket', Type: FieldType.TypeText } as Field,
    ]
    const state = initialProposalState('/tmp/root', inferred)
    expect(state.fields).toEqual([
      { key: 'owner', label: 'Owner', type: FieldType.TypeOptions, include: true, showOnCard: true, multiline: false, options: ['alice', 'bob'] },
      { key: 'ticket', label: 'Ticket', type: FieldType.TypeText, include: true, showOnCard: false, multiline: false, options: [] },
    ])
    expect(state.statusEnabled).toBe(false)
    expect(state.statusValues).toBe('')
  })
})

describe('proposalNameTaken', () => {
  const kinds = [{ Label: 'Document' }, { Label: 'Topic' }] as Kind[]

  it('matches an existing Kind label case-insensitively', () => {
    expect(proposalNameTaken('document', kinds)).toBe(true)
    expect(proposalNameTaken('  DOCUMENT  ', kinds)).toBe(true)
  })

  it('reports false for a name that matches nothing', () => {
    expect(proposalNameTaken('Ticket', kinds)).toBe(false)
  })

  it('reports false for a blank/whitespace-only name -- nothing to collide with yet', () => {
    expect(proposalNameTaken('', kinds)).toBe(false)
    expect(proposalNameTaken('   ', kinds)).toBe(false)
  })
})

describe('buildProposalFields', () => {
  const base: KindProposalState = {
    name: 'Ticket',
    fields: [
      { key: 'ticket', label: 'Ticket', type: FieldType.TypeText, include: true, showOnCard: false, multiline: false, options: [] },
      { key: 'owner', label: 'Owner', type: FieldType.TypeOptions, include: true, showOnCard: true, multiline: false, options: ['alice', 'bob'] },
      { key: 'released', label: 'Released', type: FieldType.TypeBoolean, include: false, showOnCard: false, multiline: false, options: [] },
    ],
    statusEnabled: false,
    statusValues: '',
  }

  it('drops rows with include=false and keeps every other row\'s own shape', () => {
    const fields = buildProposalFields(base)
    expect(fields).toHaveLength(2)
    expect(fields.map((f) => f.Key)).toEqual(['ticket', 'owner'])
    expect(fields[1].Options).toEqual(['alice', 'bob'])
    expect(fields[1].ShowOnCard).toBe(true)
  })

  it('never carries Options for a non-options row, even if the row object has a stale options array', () => {
    const withStaleOptions: KindProposalState = {
      ...base,
      fields: [{ key: 'ticket', label: 'Ticket', type: FieldType.TypeText, include: true, showOnCard: false, multiline: false, options: ['a', 'b'] }],
    }
    expect(buildProposalFields(withStaleOptions)[0].Options).toBeUndefined()
  })

  it('appends exactly one status field, parsed from the comma-separated values input, when the toggle is on', () => {
    const withStatus: KindProposalState = { ...base, statusEnabled: true, statusValues: 'todo, in progress ,done,' }
    const fields = buildProposalFields(withStatus)
    const status = fields.find((f) => f.Key === 'status')
    expect(status).toMatchObject({ Type: FieldType.TypeOptions, ShowOnCard: true, Options: ['todo', 'in progress', 'done'] })
  })

  it('adds no status field when the toggle stays off', () => {
    expect(buildProposalFields(base).some((f) => f.Key === 'status')).toBe(false)
  })
})
