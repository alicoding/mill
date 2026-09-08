import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// frontend/public/plugin-frame/activation.js and bootstrap.js are
// served static, never built from this repo's TypeScript (their own
// header comments say why: an opaque-origin sandboxed frame with no
// bundler), so their own copy of formatDate's relative-time algorithm
// is duplicated by hand rather than imported. This pins the one thing
// hand-duplication can silently drift on -- the per-unit millisecond
// table and the Intl.RelativeTimeFormat call -- against
// shared/inventorySort.ts's own formatUpdated, the algorithm both
// copies are supposed to match (goal 0386 S1's "reuse the app's own
// formatter" contract, satisfied by parity here where a real import
// is not possible).

const PLUGIN_FRAME_DIR = path.resolve(__dirname, '../../public/plugin-frame')

const CANONICAL_RELATIVE_UNITS: [string, number][] = [
  ['year', 1000 * 60 * 60 * 24 * 365],
  ['month', 1000 * 60 * 60 * 24 * 30],
  ['week', 1000 * 60 * 60 * 24 * 7],
  ['day', 1000 * 60 * 60 * 24],
  ['hour', 1000 * 60 * 60],
  ['minute', 1000 * 60],
]

function relativeUnitsLiteralFrom(source: string): string {
  const m = /var RELATIVE_UNITS = (\[.*\])/.exec(source)
  if (!m) throw new Error('RELATIVE_UNITS literal not found')
  return m[1]
}

function relativeFormatterLineFrom(source: string): string {
  const m = /var relativeFormatter = (new Intl\.RelativeTimeFormat\([^)]*\))/.exec(source)
  if (!m) throw new Error('relativeFormatter construction not found')
  return m[1]
}

describe('activation.js and bootstrap.js formatDate parity', () => {
  const activation = readFileSync(path.join(PLUGIN_FRAME_DIR, 'activation.js'), 'utf8')
  const bootstrap = readFileSync(path.join(PLUGIN_FRAME_DIR, 'bootstrap.js'), 'utf8')

  it('both files declare the identical RELATIVE_UNITS literal', () => {
    expect(relativeUnitsLiteralFrom(activation)).toBe(relativeUnitsLiteralFrom(bootstrap))
  })

  it('the RELATIVE_UNITS literal matches shared/inventorySort.ts formatUpdated\'s own per-unit milliseconds', () => {
    const expectedLiteral = '[' + CANONICAL_RELATIVE_UNITS.map(([unit, ms]) => `['${unit}', ${ms}]`).join(', ') + ']'
    expect(relativeUnitsLiteralFrom(activation)).toBe(expectedLiteral)
  })

  it('both files construct Intl.RelativeTimeFormat identically', () => {
    const activationLine = relativeFormatterLineFrom(activation)
    const bootstrapLine = relativeFormatterLineFrom(bootstrap)
    expect(activationLine).toBe(bootstrapLine)
    expect(activationLine).toBe("new Intl.RelativeTimeFormat('en', { numeric: 'auto' })")
  })
})
