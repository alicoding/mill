import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { titleFromFilename } from './atlasCreateHelpers'
import { extensionOf } from './unitRegistry'

// A dropped .pdf file's own extension test (goal 0267) -- kept
// identical to internal/domain/atlas/mirror.go's ClassifyMirrorKind
// ".pdf" case in the reverse direction, same "kept identical"
// discipline the diagram/sheet extension sets document.
export function isPdfPath(path: string): boolean {
  return extensionOf(path) === '.pdf'
}

// The PDF file drop's own placement door (goal 0267): a native OS drop
// (or a pasted file path) of a .pdf lands as a "pdf" BoardObject --
// mirror-only, never a card, the same landing shape the diagram and
// sheet doors established.
export function useAtlasPdfObjectCreate() {
  const land = async (path: string, parentID: string, pos: { X: number; Y: number }) => {
    await AtlasService.CreateBoardObject('pdf', { mirrorPath: path, title: titleFromFilename(path) }, pos, parentID)
    await refreshAtlas()
  }

  return { land }
}
