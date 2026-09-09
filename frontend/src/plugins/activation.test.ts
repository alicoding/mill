import { describe, expect, it } from 'vitest'
import { isFramedActivation } from './activation'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// Which activation an extension gets (docs/goals/0375 S1b, widened by
// docs/goals/0380): a same-DOM canvas kind is the only thing that still
// keeps an extension in Mill's own document, and a kind declared as a
// framed tool is not one -- which is what lets the bundled drawing
// tools prove the framed canvas API by running inside it.

function manifest(canvasObjects: unknown[] = []): Manifest {
  return { contributes: { canvasObjects } } as unknown as Manifest
}

describe('isFramedActivation', () => {
  it('keeps a built-in with no canvas contribution same-DOM', () => {
    expect(isFramedActivation(true, manifest([]))).toBe(false)
  })

  it('keeps any extension with a same-DOM canvas kind in Mill’s document', () => {
    expect(isFramedActivation(false, manifest([{ kind: 'draws' }]))).toBe(false)
    expect(isFramedActivation(true, manifest([{ kind: 'draws' }]))).toBe(false)
  })

  it('sandboxes an extension whose canvas kinds are all framed tools, bundled or not', () => {
    expect(isFramedActivation(true, manifest([{ kind: 'pencil', tool: true }, { kind: 'shape', tool: true }]))).toBe(true)
    expect(isFramedActivation(false, manifest([{ kind: 'pencil', tool: true }]))).toBe(true)
  })

  it('keeps a mixed extension same-DOM: one same-DOM kind is enough, since the whole extension shares one activation', () => {
    expect(isFramedActivation(false, manifest([{ kind: 'pencil', tool: true }, { kind: 'legacy' }]))).toBe(false)
  })

  it('sandboxes a non-built-in extension with no canvas object at all', () => {
    expect(isFramedActivation(false, manifest([]))).toBe(true)
    expect(isFramedActivation(false, {} as Manifest)).toBe(true)
  })
})
