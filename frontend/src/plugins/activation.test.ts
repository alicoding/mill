import { describe, expect, it } from 'vitest'
import { isFramedActivation } from './activation'
import type { Manifest } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'

// Which activation an extension gets (docs/goals/0375 S1b, refined by
// docs/goals/0380). The deciding fact is which door a kind's own
// registration crosses: registerCanvasObject (a kind with no `tool`, or
// whose face is the legacy renderFace function) is same-DOM-only, since
// a function cannot cross postMessage. registerCanvasTool (a `tool`
// kind) IS available framed, but its face still resolves only through
// the manifest's own `entry`, never a renderFace function the frame
// cannot send -- so a `tool` kind with no `entry` (mill-drawing's own
// shape) still needs Mill's own document. A kind is framed-safe only
// when it is BOTH `tool` and `entry`.

function manifest(canvasObjects: unknown[] = []): Manifest {
  return { contributes: { canvasObjects } } as unknown as Manifest
}

describe('isFramedActivation', () => {
  it('keeps a built-in with no canvas contribution same-DOM', () => {
    expect(isFramedActivation(true, manifest([]))).toBe(false)
  })

  it('keeps an extension that draws its own face in Mill’s document, tool or not', () => {
    expect(isFramedActivation(false, manifest([{ kind: 'draws' }]))).toBe(false)
  })

  it('keeps a tool with no entry page same-DOM -- registerCanvasTool crosses framed, but its own renderFace function cannot (mill-drawing’s own shape)', () => {
    expect(isFramedActivation(true, manifest([{ kind: 'pencil', tool: true }]))).toBe(false)
  })

  it('keeps an entry-page kind that is not declared a tool same-DOM -- registerCanvasObject itself never crosses framed', () => {
    expect(isFramedActivation(false, manifest([{ kind: 'a', entry: 'a.html' }]))).toBe(false)
  })

  it('sandboxes an extension whose canvas kinds are all BOTH declared tools and name their own entry page, bundled or not', () => {
    expect(isFramedActivation(true, manifest([{ kind: 'a', tool: true, entry: 'a.html' }, { kind: 'b', tool: true, entry: 'b.html' }]))).toBe(true)
    expect(isFramedActivation(false, manifest([{ kind: 'a', tool: true, entry: 'a.html' }]))).toBe(true)
  })

  it('keeps a mixed extension same-DOM: one self-drawn face is enough, since the whole extension shares one activation', () => {
    expect(isFramedActivation(false, manifest([{ kind: 'a', tool: true, entry: 'a.html' }, { kind: 'legacy' }]))).toBe(false)
  })

  it('sandboxes a non-built-in extension with no canvas object at all', () => {
    expect(isFramedActivation(false, manifest([]))).toBe(true)
    expect(isFramedActivation(false, {} as Manifest)).toBe(true)
  })
})
