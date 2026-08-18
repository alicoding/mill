import { useState } from 'react'
import { AtlasService, CompositionService } from '../shared/bindings'
import type { ClipboardApplyPreview, ClipbridgeReplyPreview } from '../shared/bindings'

// The Quick Panel's ONE clipboard door (goals 0039 + 0099): the same
// row recognizes both payload families -- a workflow export (apply
// preview) first, then a mill reply envelope (the clipboard bridge's
// review surface). Reads the clipboard on the row's own click/Enter
// (the user gesture the Clipboard API requires). Never throws through
// to the caller: every failure path (permission denied, empty
// clipboard, malformed payload) becomes a Recognized=false apply
// preview so the error view renders it inline.
export function useQuickPanelClipboardDoor(t: (key: string, opts?: Record<string, unknown>) => string) {
  const [clipboardApply, setClipboardApply] = useState<{ json: string; preview: ClipboardApplyPreview } | null>(null)
  const [replyReview, setReplyReview] = useState<ClipbridgeReplyPreview | null>(null)

  const applyFromClipboard = () => {
    navigator.clipboard.readText()
      .then((text) => {
        if (!text.trim()) {
          setClipboardApply({ json: text, preview: { recognized: false, error: t('quickPanel.clipboard.emptyError') } })
          return
        }
        CompositionService.PreviewClipboardApply(text)
          .then((preview) => {
            if (preview.recognized) {
              setClipboardApply({ json: text, preview })
              return
            }
            AtlasService.PreviewClipbridgeReply(text)
              .then((reply) => {
                if (reply.Recognized) {
                  setReplyReview(reply)
                } else {
                  setClipboardApply({ json: text, preview })
                }
              })
              .catch(() => setClipboardApply({ json: text, preview }))
          })
          .catch((err) => setClipboardApply({ json: text, preview: { recognized: false, error: String(err) } }))
      })
      .catch((err) => {
        setClipboardApply({ json: '', preview: { recognized: false, error: t('quickPanel.clipboard.readError', { error: String(err) }) } })
      })
  }

  return { clipboardApply, setClipboardApply, replyReview, setReplyReview, applyFromClipboard }
}
