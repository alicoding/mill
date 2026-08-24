import { ImageIcon } from '@primer/octicons-react'
import { AtlasService } from '../../shared/bindings'
import { fileToBase64 } from '../../shared/base64Blob'
import { identityOf, registerNoun, type AtlasToolShape } from '../atlasNounRegistry'
import { normalizeLocalPathInput, titleFromFilename } from '../atlasCreateHelpers'

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
}

// Image (goal 0169 slice 2): the paste-or-drop interaction's own proof.
// Two input shapes resolve to the same artifact -- a typed/pasted local
// path is mirror-only (no bytes ever move, matching
// CreateCardFromFileDrop's own native-drop semantics); a pasted
// clipboard File has no path at all, so its bytes are written to a
// fresh Mill-owned file first (SaveImageBytes) and ITS path becomes the
// mirror. Either way, placement (useAtlasImageCreate.ts) lands the
// resulting mirrorPath through the exact same CreateCardFromFileDrop a
// native OS file drop already uses -- kind resolution and duplicate
// detection are never re-implemented here.
export const imageTool = {
  id: imageIdentity.id,
  icon: ImageIcon,
  label: imageIdentity.commandLabel,
  shortcutKey: imageIdentity.shortcutKey,
  tray: 'quick',
  interaction: imageIdentity.interaction,
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
