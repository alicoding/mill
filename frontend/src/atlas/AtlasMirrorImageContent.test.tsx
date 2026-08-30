import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { imageTool } from './tools/imageTool'

// renderToStaticMarkup never runs effects, so it captures exactly the
// state a real mount paints before AtlasMirrorImageContentInner's own
// ObjectMirrorContent fetch resolves (goal 0243) -- the same frame a
// page reload shows on screen for one tick, with no need to mock the
// Wails-bound AtlasService at all. Ink's no-glyph twin of this pin
// moved with the pencil into the bundled Drawing plugin (goal 0252):
// its face is plugin-rendered now, proven through the tool e2e specs.
function boardObject(kind: string): BoardObject {
  return {
    ID: 'obj-1',
    Kind: kind,
    Payload: { mirrorPath: '/sketches/obj-1.svg' },
    Position: { X: 0, Y: 0 },
    ParentID: '',
    CreatedAt: '',
    UpdatedAt: '',
    DeletedAt: '',
  } as unknown as BoardObject
}

describe('mirror-backed content before its mirror has loaded (goal 0243)', () => {
  it('an unloaded image mirror still shows its placeholder glyph (non-regression)', () => {
    const Component = imageTool.content!.Component
    const html = renderToStaticMarkup(<Component object={boardObject('image')} mirrorVersion={0} />)
    expect(html).toContain('atlas-board-object-placeholder')
    expect(html).toContain('<svg')
  })
})
