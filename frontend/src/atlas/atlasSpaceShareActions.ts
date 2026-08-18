import { AtlasService } from '../shared/bindings'
import { writeClipboardText } from '../shared/clipboardWrite'

// The space-level share actions (goal 0063, ADR-0038), the space
// counterpart to atlasCardShare.ts's own card-level twin -- both
// AtlasSpaceShareMenu.tsx and shared/atlasBoardCommands.ts's
// atlas.share.copyContext/copyLinks commands call into this, so the
// two callers never drift on what each action actually does.
export function atlasSpaceShareActions(spaceID: string, onError: (message: string) => void) {
  const bundleContext = async (withAttachments: boolean): Promise<void> => {
    try {
      const text = await AtlasService.SpaceBundleContext(spaceID, withAttachments)
      await writeClipboardText(text)
    } catch (err) {
      onError(String(err))
    }
  }

  const copyLinks = async (): Promise<void> => {
    try {
      const text = await AtlasService.SpaceLinksList(spaceID)
      await writeClipboardText(text)
    } catch (err) {
      onError(String(err))
    }
  }

  const revealFolder = async (): Promise<void> => {
    try {
      await AtlasService.RevealSpaceFolder(spaceID)
    } catch (err) {
      onError(String(err))
    }
  }

  return { bundleContext, copyLinks, revealFolder }
}
