import { describe, expect, it } from 'vitest'
import { countsFor, isValidKey, needsValueCount, rowsToVars, varsToRows } from './environmentRows'
import type { Environment } from '../../bindings/github.com/alicoding/mill/internal/domain/environment/models'

function env(vars: Environment['Vars']): Environment {
  return { ID: 'e', Label: 'E', Vars: vars, BuiltIn: false, CreatedAt: '', UpdatedAt: '', Seed: { SeedRevision: 0, SeededAt: '', Modified: false } } as unknown as Environment
}

describe('varsToRows', () => {
  it('opens on one editable row when there is nothing stored', () => {
    expect(varsToRows(null)).toEqual([{ key: '', value: '', secret: false }])
  })

  it('carries the secret flag through', () => {
    expect(varsToRows([{ Key: 'A', Value: 'vault:1', Secret: true }])).toEqual([{ key: 'A', value: 'vault:1', secret: true }])
  })
})

describe('rowsToVars', () => {
  it('drops a blank row and trims only the name', () => {
    expect(rowsToVars([
      { key: ' A ', value: ' spaced ', secret: false },
      { key: '  ', value: 'orphan', secret: false },
    ])).toEqual([{ Key: 'A', Value: ' spaced ', Secret: false }])
  })
})

describe('isValidKey', () => {
  it('accepts identifiers and rejects everything else', () => {
    expect(isValidKey('API_BASE')).toBe(true)
    expect(isValidKey('_x1')).toBe(true)
    expect(isValidKey('1A')).toBe(false)
    expect(isValidKey('api-base')).toBe(false)
    expect(isValidKey('')).toBe(false)
  })
})

describe('countsFor / needsValueCount', () => {
  it('counts variables, secrets, and the ones with no value yet', () => {
    const e = env([
      { Key: 'A', Value: 'x', Secret: false },
      { Key: 'B', Value: 'vault:1', Secret: true },
      { Key: 'C', Value: '', Secret: true },
    ])
    expect(countsFor(e)).toEqual({ total: 3, secret: 2 })
    expect(needsValueCount(e)).toBe(1)
  })
})
