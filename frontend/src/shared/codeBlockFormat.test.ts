import { describe, expect, it } from 'vitest'
import { formatCode, formatSupported } from './codeBlockFormat'

describe('formatSupported (goal 0268)', () => {
  it('claims the converged set, case-insensitively, and nothing else', () => {
    expect(formatSupported('JSON')).toBe(true)
    expect(formatSupported('TypeScript')).toBe(true)
    expect(formatSupported('YAML')).toBe(true)
    expect(formatSupported('Rust')).toBe(false)
    expect(formatSupported('')).toBe(false)
  })
})

describe('formatCode', () => {
  it('formats mangled JSON', async () => {
    const out = await formatCode('JSON', '{"a":1,   "b":[2,3]}')
    expect(out).toBe('{ "a": 1, "b": [2, 3] }\n')
  })

  it('formats TypeScript', async () => {
    const out = await formatCode('TypeScript', 'const  x:number=1')
    expect(out).toBe('const x: number = 1;\n')
  })

  it('resolves null for an unsupported language', async () => {
    await expect(formatCode('Rust', 'fn main(){}')).resolves.toBeNull()
  })

  it('resolves null for broken input instead of throwing or mangling', async () => {
    await expect(formatCode('JSON', '{"a": ')).resolves.toBeNull()
  })
})
