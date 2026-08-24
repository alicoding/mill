import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { titleFromFilename } from './atlasCreateHelpers'
import { extensionOf } from './unitRegistry'

// A dropped .drawio/.mmd/.mermaid file's own extension set (goal 0179
// S2) -- kept identical to atlasUnitDrawio.ts's DRAWIO_EXTENSION and
// atlasUnitMermaid.ts's MERMAID_EXTENSIONS in the reverse direction,
// same "kept identical" discipline atlasUnitMirror.ts's own
// IMAGE_EXTENSIONS comment documents. Deliberately excludes
// ".drawio.svg": that variant already renders through the plain image
// door (a real SVG with its diagram embedded), so it stays a card via
// CreateCardFromFileDrop exactly as it does today -- unaffected by
// this slice.
const DIAGRAM_EXTENSIONS = new Set(['.drawio', '.mmd', '.mermaid'])

export function isDiagramPath(path: string): boolean {
  return DIAGRAM_EXTENSIONS.has(extensionOf(path))
}

// The diagram file drop's own placement door: a native OS drop of a
// .drawio/.mmd/.mermaid file lands as a "diagram" BoardObject -- a peer
// to Card, mirror-only exactly the way CreateCardFromFileDrop's own
// instant landing is (decision 4: the map never copies file content
// into its own ownership). Table and diagram both relocate machinery
// that already worked (goal 0179 S2) -- this hook's only job is which
// entity the mirrored path lands on.
export function useAtlasDiagramObjectCreate() {
  const land = async (path: string, parentID: string, pos: { X: number; Y: number }) => {
    await AtlasService.CreateBoardObject('diagram', { mirrorPath: path, title: titleFromFilename(path) }, pos, parentID)
    await refreshAtlas()
  }

  return { land }
}
