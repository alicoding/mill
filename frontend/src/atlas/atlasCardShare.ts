import type { Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'

// The card-level share actions (goal 0063, ADR-0038): copy-as-context
// (with an explicit with/without-attachments toggle), copy-cloud-link,
// reveal-file. One place both AtlasCardShareMenu (the card chip's
// quick actions) and AtlasCardOverlay (the full-screen surface's own
// Share section) call into, so the two never drift on what each
// action actually does. Rendering itself stays server-side
// (AtlasService.CardContextBlock) -- this is just the clipboard/reveal
// plumbing around it, same navigator.clipboard.writeText idiom
// ValidationPanel/RequestTestPanel already use for a copy action.
export function atlasCardShareActions(card: Card, onError: (message: string) => void) {
  const copyAsContext = async (withAttachments: boolean): Promise<void> => {
    try {
      const block = await AtlasService.CardContextBlock(card.ID, withAttachments)
      await navigator.clipboard.writeText(block)
    } catch (err) {
      onError(String(err))
    }
  }

  const copyCloudLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(card.Source)
    } catch (err) {
      onError(String(err))
    }
  }

  const revealFile = async (): Promise<void> => {
    try {
      await AtlasService.RevealCardMirror(card.ID)
    } catch (err) {
      onError(String(err))
    }
  }

  return { copyAsContext, copyCloudLink, revealFile }
}
