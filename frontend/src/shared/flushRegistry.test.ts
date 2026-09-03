import { describe, expect, it } from 'vitest'
import { discardAll, flushAll, flushFocused, pendingFlushCount, registerFlusher, subscribeForTest } from './flushRegistry'

describe('flushRegistry (goal 0295 S2)', () => {
  it('runs every live flusher once and forgets unregistered ones', async () => {
    const calls: string[] = []
    const offA = registerFlusher('a', () => { calls.push('a') })
    const offB = registerFlusher('b', async () => { calls.push('b') })
    offB()
    expect(pendingFlushCount()).toBe(1)
    await flushAll(1000)
    expect(calls).toEqual(['a'])
    offA()
    expect(pendingFlushCount()).toBe(0)
  })

  it('is bounded: a hanging flusher does not block the quit', async () => {
    const off = registerFlusher('hang', () => new Promise<void>(() => {}))
    const started = Date.now()
    await flushAll(50)
    expect(Date.now() - started).toBeLessThan(1000)
    off()
  })

  it('swallows a failing flusher and still runs the others', async () => {
    const calls: string[] = []
    const off1 = registerFlusher('bad', () => { throw new Error('nope') })
    const off2 = registerFlusher('good', () => { calls.push('good') })
    await flushAll(1000)
    expect(calls).toEqual(['good'])
    off1(); off2()
  })
})

describe('flushRegistry explicit-mode additions (goal 0295 S2b)', () => {
  // No DOM in the unit environment: a root is anything with contains().
  const rootHolding = (el: object) => ({ contains: (n: unknown) => n === el }) as unknown as Element
  const rootHoldingNothing = () => ({ contains: () => false }) as unknown as Element

  it('flushFocused runs only the entry whose root holds the focused element', async () => {
    const calls: string[] = []
    const focusedEl = {} as Node
    const offA = registerFlusher('focused', { flush: () => { calls.push('focused') }, root: () => rootHolding(focusedEl) })
    const offB = registerFlusher('other', { flush: () => { calls.push('other') }, root: rootHoldingNothing })
    await flushFocused(1000, focusedEl)
    expect(calls).toEqual(['focused'])
    offA(); offB()
  })

  it('flushFocused saves everything when nothing registered holds focus', async () => {
    const calls: string[] = []
    const offA = registerFlusher('a', () => { calls.push('a') })
    const offB = registerFlusher('b', { flush: () => { calls.push('b') }, root: rootHoldingNothing })
    await flushFocused(1000, {} as Node)
    expect(calls.sort()).toEqual(['a', 'b'])
    offA(); offB()
  })

  it('discardAll reverts every entry that knows how and skips the rest', () => {
    const calls: string[] = []
    const offA = registerFlusher('revertable', { flush: () => {}, discard: () => { calls.push('revertable') } })
    const offB = registerFlusher('draft', { flush: () => {} })
    const offC = registerFlusher('throws', { flush: () => {}, discard: () => { throw new Error('nope') } })
    discardAll()
    expect(calls).toEqual(['revertable'])
    offA(); offB(); offC()
  })

  it('notifies subscribers on register and unregister', () => {
    let count = -1
    const listener = () => { count = pendingFlushCount() }
    const unsubscribe = subscribeForTest(listener)
    const off = registerFlusher('x', () => {})
    expect(count).toBe(1)
    off()
    expect(count).toBe(0)
    unsubscribe()
  })
})
