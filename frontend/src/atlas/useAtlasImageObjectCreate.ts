import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { titleFromFilename } from './atlasCreateHelpers'
import { extensionOf } from './unitRegistry'
import { IMAGE_EXTENSIONS } from './atlasUnitMirror'

// isImagePath mirrors useAtlasDiagramObjectCreate.ts's own isDiagramPath
// -- the routing predicate a native OS drop checks before falling
// through to the generic reference-card door (goal 0206, 0179's
// founding rule: dropping something creates THAT THING, never a card).
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extensionOf(path))
}

// The image file drop's own placement door (goal 0206), scoped to the
// BOARD-context native drop only (useAtlasNativeFileDrop.ts) -- the
// card-foremost drop (useAtlasCardPageFileDrop.ts, D5) is a deliberate
// "attach a linked file to this open card" gesture and stays untouched,
// same scope boundary goal 0179 S2's diagram routing already drew.
//
// Unlike a picked local path (imageTool.commit's own `path` branch,
// which points MirrorPath straight at a file the user explicitly chose
// via the native picker and expects to keep existing), a native drop's
// materialized path can be an OS temp/promise file under /var/folders
// (a drag from a screenshot thumbnail or another app materializes a
// file promise there) that the OS reclaims once the drag completes --
// so this door copies the bytes into Mill's own captures dir
// (MirrorImageFromPath) before ever landing the object, rather than
// pointing MirrorPath at a path that may not survive.
export function useAtlasImageObjectCreate() {
  const land = async (path: string, parentID: string, pos: { X: number; Y: number }) => {
    const title = titleFromFilename(path)
    const mirrorPath = await AtlasService.MirrorImageFromPath(path, title)
    await AtlasService.CreateBoardObject('image', { mirrorPath, title }, pos, parentID)
    await refreshAtlas()
  }

  return { land }
}
