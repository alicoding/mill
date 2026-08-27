import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BoardObject } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { pencilTool } from './tools/pencilTool'
import { imageTool } from './tools/imageTool'

// renderToStaticMarkup never runs effects, so it captures exactly the
// state a real mount paints before AtlasMirrorImageContentInner's own
// ObjectMirrorContent fetch resolves (goal 0243) -- the same frame a
// freshly-committed stroke or a page reload shows on screen for one
// tick, with no need to mock the Wails-bound AtlasService at all.
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
  it('a freshly-committed ink stroke renders no fallback glyph', () => {
    const Component = pencilTool.content!.Component
    const html = renderToStaticMarkup(<Component object={boardObject('ink')} mirrorVersion={0} />)
    expect(html).toContain('atlas-board-object-placeholder')
    expect(html).not.toContain('<svg')
  })

  it('an unloaded image mirror still shows its placeholder glyph (non-regression)', () => {
    const Component = imageTool.content!.Component
    const html = renderToStaticMarkup(<Component object={boardObject('image')} mirrorVersion={0} />)
    expect(html).toContain('atlas-board-object-placeholder')
    expect(html).toContain('<svg')
  })
})
