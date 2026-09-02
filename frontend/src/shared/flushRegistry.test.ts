import { describe, expect, it } from 'vitest'
import { flushAll, pendingFlushCount, registerFlusher } from './flushRegistry'

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
