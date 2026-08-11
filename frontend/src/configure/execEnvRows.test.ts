import { describe, expect, it } from 'vitest'
import { envToRows, rowsToEnv } from './execEnvRows'

describe('envToRows', () => {
  it('splits at the first = only, preserving = inside values', () => {
    expect(envToRows(['TOKEN=abc=def'])).toEqual([{ key: 'TOKEN', value: 'abc=def' }])
  })

  it('keeps an entry with no = visible as a key with empty value', () => {
    expect(envToRows(['LONELY'])).toEqual([{ key: 'LONELY', value: '' }])
  })

  it('returns one blank row for an empty/absent env so the form has a starting row', () => {
    expect(envToRows([])).toEqual([{ key: '', value: '' }])
    expect(envToRows(null)).toEqual([{ key: '', value: '' }])
  })

  it('round-trips a realistic env', () => {
    const env = ['PATH=/usr/bin:/bin:/usr/sbin:/sbin', 'LANG=en_US.UTF-8']
    expect(rowsToEnv(envToRows(env))).toEqual(env)
  })
})

describe('rowsToEnv', () => {
  it('skips rows with an empty key and trims key whitespace', () => {
    expect(rowsToEnv([
      { key: '', value: 'ignored' },
      { key: '  PATH ', value: '/usr/bin' },
    ])).toEqual(['PATH=/usr/bin'])
  })

  it('keeps an empty value as KEY=', () => {
    expect(rowsToEnv([{ key: 'EMPTY', value: '' }])).toEqual(['EMPTY='])
  })
})
