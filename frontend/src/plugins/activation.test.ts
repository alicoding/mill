import { describe, expect, it } from 'vitest'
import { isFramedActivation } from './activation'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// The one branch this slice adds to loader.ts (docs/goals/0375 S1b):
// a built-in keeps same-DOM behind its own named transition; a
// non-built-in that declares a canvas object keeps same-DOM behind the
// "canvas-host" grant; every other non-built-in plugin activates
// framed.

function manifest(canvasObjects: unknown[] = []): Manifest {
  return { contributes: { canvasObjects } } as unknown as Manifest
}

describe('isFramedActivation', () => {
  it('keeps a built-in same-DOM regardless of what it contributes', () => {
    expect(isFramedActivation(true, manifest([]))).toBe(false)
    expect(isFramedActivation(true, manifest([{ kind: 'draws' }]))).toBe(false)
  })

  it('keeps a non-built-in plugin that contributes a canvas object same-DOM (the canvas-host grant)', () => {
    expect(isFramedActivation(false, manifest([{ kind: 'draws' }]))).toBe(false)
  })

  it('activates a non-built-in plugin with no canvas object inside the sandbox', () => {
    expect(isFramedActivation(false, manifest([]))).toBe(true)
    expect(isFramedActivation(false, {} as Manifest)).toBe(true)
  })
})
