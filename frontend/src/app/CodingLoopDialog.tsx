import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog } from '@primer/react'
import { CompositionService } from '../shared/bindings'
import { useUISignalStore } from '../shared/uiSignalStore'
import { CodingLoopSurface } from '../shared/CodingLoopSurface'

// CodingLoopDialog (docs/goals/0240 S1): app-level chrome mounted once,
// same shape as ClipboardHistoryDialog -- renders off uiSignalStore's
// codingLoopOpen flag. Reads the clipboard via
// CompositionService.ReadHostClipboardText (never navigator.clipboard,
// .claude/rules/frontend.md) once per open, then hands the captured
// text to the shared CodingLoopSurface, which owns the whole Confirm/
// Running/Result flow.
export function CodingLoopDialog() {
  const { t } = useTranslation('app')
  const open = useUISignalStore((s) => s.codingLoopOpen)
  const close = useUISignalStore((s) => s.closeCodingLoop)

  const [clipboardText, setClipboardText] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setClipboardText(null)
      setReadError(null)
      return
    }
    CompositionService.ReadHostClipboardText()
      .then(setClipboardText)
      .catch((err) => setReadError(String(err)))
  }, [open])

  if (!open) return null

  return (
    <Dialog
      title={t('codingLoop.dialogTitle')}
      onClose={close}
      width="large"
      height="large"
      data-component="coding-loop"
    >
      {readError ? (
        <p data-testid="coding-loop-read-error">{readError}</p>
      ) : clipboardText != null ? (
        <CodingLoopSurface clipboardText={clipboardText} onClose={close} />
      ) : (
        <p data-testid="coding-loop-reading">{t('codingLoop.reading')}</p>
      )}
    </Dialog>
  )
}
