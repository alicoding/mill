import { describe, expect, it } from 'vitest'
import { looksLikeCode } from './looksLikeCode'

describe('looksLikeCode', () => {
  it('is false for a plain single-line sentence', () => {
    expect(looksLikeCode('buy milk on the way home')).toBe(false)
  })

  it('is false for plain multi-line prose with no indentation', () => {
    expect(looksLikeCode('Dear team,\n\nThanks for the update.\nSee you Monday.')).toBe(false)
  })

  it('is true for an indented multi-line block', () => {
    expect(looksLikeCode('function greet() {\n  console.log("hi")\n}')).toBe(true)
  })

  it('is true for a single-line snippet carrying a code token', () => {
    expect(looksLikeCode('const x = 1;')).toBe(true)
  })

  it('is true for a Go function signature', () => {
    expect(looksLikeCode('func Add(a, b int) int { return a + b }')).toBe(true)
  })

  it('is false for an empty string', () => {
    expect(looksLikeCode('')).toBe(false)
  })
})
