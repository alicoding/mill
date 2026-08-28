import { ImageIcon } from '@primer/octicons-react'
import { AtlasService } from '../../shared/bindings'
import { fileToBase64 } from '../../shared/base64Blob'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import { normalizeLocalPathInput, titleFromFilename } from '../atlasCreateHelpers'
import { makeMirrorImageContent } from '../extensions/AtlasMirrorImageContent'

const imageIdentity = identityOf('image')

export interface AtlasImageArtifact { kind: 'image'; title: string; mirrorPath: string }

// Kept identical to atlas/mirror.go's imageMimeTypes allow-list, in the
// reverse direction -- a pasted File's own `.type` names the ONE mime
// value browsers give it, so this only needs the extensions Mill's
// image renderer actually recognizes, same "kept identical" discipline
// atlasUnitMirror.ts's own IMAGE_EXTENSIONS comment already documents.
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
  'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp',
  'image/heic': '.heic',
}

// Image (goal 0169 slice 2): the paste-or-drop interaction's own proof.
// Two input shapes resolve to the same artifact -- a picked local path
// is mirror-only (no bytes ever move); a pasted clipboard File has no
// path at all, so its bytes are written to a fresh Mill-owned file
// first (SaveImageBytes) and ITS path becomes the mirror. Either way,
// placement (useAtlasImageCreate.ts) lands the resulting mirrorPath as
// a board-local 'image' BoardObject (CreateBoardObject) -- never a
// card, per goal 0179's founding rule.
export const imageTool = {
  id: imageIdentity.id,
  icon: ImageIcon,
  label: imageIdentity.commandLabel,
  description: 'Adds an image from your files or the clipboard.',
  shortcutKey: imageIdentity.shortcutKey,
  tray: 'quick',
  // File-backed visual material (goal 0224's disposition table) --
  // reachable in the tray but ordered after the knowledge cluster,
  // never competing with it for primary space.
  group: 'file',
  interaction: imageIdentity.interaction,
  // Arms through the paste/drop popover, never the toggleArm/lock state
  // machine -- always false, not N/A.
  lockable: false,
  // Shared 'atlas-object' board renderer (AtlasBoardObjectNode) covers
  // resize + the drag frame band for every Kind it routes.
  resizable: true,
  boardNodeType: 'atlas-object',
  // An image's whole body already drags -- the shared band would only
  // be debris here (goal 0206's own DESIGN DECIDED table).
  dragBand: false,
  // Payload.mirrorPath names a real image file on disk (goal 0232 S1) --
  // same fileBacked contract diagram declares, so this Kind also gets
  // the shared watch subscription (currently a no-op: armMirrorWatch's
  // own extension gate doesn't watch image files yet) and the
  // "Open in default app" command uniformly.
  fileBacked: true,
  // Placed instance is Kind 'image' (matches this tool's own id here,
  // unlike pencil's own Kind 'ink') -- content renders through the
  // same mirrored-file door ink shares (AtlasMirrorImageContent.tsx).
  boardObjectKind: 'image',
  content: {
    Component: makeMirrorImageContent(ImageIcon),
    ariaLabelKey: 'boardObject.imageAriaLabel',
    role: 'img',
    // ADR-0046 (goal 0244 S0): Payload.mirrorPath is the real image
    // file; "Open in default app" (useAtlasObjectMenu.ts) is this
    // Kind's only edit door today.
    source: { kind: 'file', pathKey: 'mirrorPath' },
    editRoute: { kind: 'external-app' },
  },
  // No style surface of its own (goal 0209) -- always empty, not
  // omitted.
  styleFields: [],
  // Arms through the paste/drop popover, never the drag gesture engine
  // -- always false/null, not N/A.
  sticky: false,
  gesture: null,
  commit: async (input: { path: string } | { file: File; title: string }): Promise<AtlasImageArtifact> => {
    if ('file' in input) {
      const ext = IMAGE_MIME_EXTENSIONS[input.file.type]
      if (!ext) throw new Error(`unsupported pasted image type: ${input.file.type}`)
      const base64 = await fileToBase64(input.file)
      const mirrorPath = await AtlasService.SaveImageBytes(base64, ext, input.title)
      return { kind: 'image', title: input.title, mirrorPath }
    }
    const mirrorPath = normalizeLocalPathInput(input.path)
    return { kind: 'image', title: titleFromFilename(mirrorPath), mirrorPath }
  },
} as const satisfies AtlasToolShape

registerNoun(imageTool)
