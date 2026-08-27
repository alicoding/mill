import { useState } from 'react'
import { CompositionService } from '../shared/bindings'

// The Quick Panel's coding-loop door (docs/goals/0240 S1): mirrors
// useQuickPanelClipboardDoor.ts's own shape exactly -- reads the
// clipboard via CompositionService.ReadHostClipboardText (never
// navigator.clipboard: the panel is its own auxiliary WKWebView, which
// denies the browser Clipboard API outright). This is the goal's own
// "must also work from the summon/away-from-app path" requirement made
// concrete: the panel is what a hotkey summon actually opens while
// another app is frontmost.
export function useQuickPanelCodingLoopDoor() {
  const [codingLoopText, setCodingLoopText] = useState<string | null>(null)
  const [codingLoopReadError, setCodingLoopReadError] = useState<string | null>(null)

  const runFromClipboard = () => {
    setCodingLoopReadError(null)
    CompositionService.ReadHostClipboardText()
      .then((text) => {
        if (!text.trim()) {
          setCodingLoopReadError('empty')
          return
        }
        setCodingLoopText(text)
      })
      .catch((err) => setCodingLoopReadError(String(err)))
  }

  const closeCodingLoop = () => {
    setCodingLoopText(null)
    setCodingLoopReadError(null)
  }

  return { codingLoopText, codingLoopReadError, runFromClipboard, closeCodingLoop }
}
