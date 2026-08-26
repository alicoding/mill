import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { titleFromFilename } from './atlasCreateHelpers'
import { extensionOf } from './unitRegistry'

// A dropped .xlsx/.csv file's own extension set (goal 0232 S2) --
// kept identical to internal/domain/atlas/mirror.go's own
// diagramMirrorExtensions allow-list in the reverse direction, same
// "kept identical" discipline useAtlasDiagramObjectCreate.ts's own
// DIAGRAM_EXTENSIONS comment already documents.
const SHEET_EXTENSIONS = new Set(['.xlsx', '.csv'])

export function isSheetPath(path: string): boolean {
  return SHEET_EXTENSIONS.has(extensionOf(path))
}

// The sheet file drop's own placement door (goal 0232 S2): a native OS
// drop of a .xlsx/.csv file lands as a "sheet" BoardObject -- mirror-
// only, never a card, the same landing shape useAtlasDiagramObjectCreate.ts's
// own diagram door already established.
export function useAtlasSheetObjectCreate() {
  const land = async (path: string, parentID: string, pos: { X: number; Y: number }) => {
    await AtlasService.CreateBoardObject('sheet', { mirrorPath: path, title: titleFromFilename(path) }, pos, parentID)
    await refreshAtlas()
  }

  return { land }
}
