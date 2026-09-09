import { describe, expect, it } from 'vitest'
import { isFramedActivation } from './activation'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// Which activation an extension gets (docs/goals/0375 S1b, refined by
// docs/goals/0380). The deciding fact is FACES, not tools: a tool is
// declarative and runs the same either way, but a face an extension
// draws itself needs Mill's own document to draw into, and only a kind
// naming an entry page draws inside its own frame.

function manifest(canvasObjects: unknown[] = []): Manifest {
  return { contributes: { canvasObjects } } as unknown as Manifest
}

describe('isFramedActivation', () => {
  it('keeps a built-in with no canvas contribution same-DOM', () => {
    expect(isFramedActivation(true, manifest([]))).toBe(false)
  })

  it('keeps an extension that draws its own face in Mill’s document, tool or not', () => {
    expect(isFramedActivation(false, manifest([{ kind: 'draws' }]))).toBe(false)
    expect(isFramedActivation(true, manifest([{ kind: 'pencil', tool: true }]))).toBe(false)
  })

  it('sandboxes an extension whose canvas kinds all draw from entry pages, bundled or not', () => {
    expect(isFramedActivation(true, manifest([{ kind: 'a', entry: 'a.html' }, { kind: 'b', entry: 'b.html' }]))).toBe(true)
    expect(isFramedActivation(false, manifest([{ kind: 'a', entry: 'a.html' }]))).toBe(true)
  })

  it('keeps a mixed extension same-DOM: one self-drawn face is enough, since the whole extension shares one activation', () => {
    expect(isFramedActivation(false, manifest([{ kind: 'a', entry: 'a.html' }, { kind: 'legacy' }]))).toBe(false)
  })

  it('sandboxes a non-built-in extension with no canvas object at all', () => {
    expect(isFramedActivation(false, manifest([]))).toBe(true)
    expect(isFramedActivation(false, {} as Manifest)).toBe(true)
  })
})
