import { useEffect, useRef } from 'react'
import { AtlasService } from '../shared/bindings'
import type { PasteResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { refreshAtlas } from './atlasStore'
import { frameContainingPoint } from './atlasFramePoint'
import type { FrameBox } from './useAtlasDragFiling'

// isEditableTarget mirrors the LOCKED design's own gate ("when the
// Atlas board has focus and no editable element does"): a paste
// landing in a text field, the placement popover's own title input, or
// any contenteditable region must fall through to the browser's
// ordinary paste, never get hijacked into a new card.
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

// The map's own paste door (goal 0081 slice A3, LOCKED design §2b/§3b):
// clipboard TEXT opens the placement popover prefilled (title = first
// line, note = full text); HTML converts to Markdown first via the
// existing Go conversion path, then the same popover. Anchored at the
// last known mouse position (tracked here, cheap: a ref updated on
// pointermove, no re-renders) rather than a fixed viewport center, so
// the popover lands near where the user actually is.
export function useAtlasPaste({ topLevelBoxes, screenToFlowPosition, onPasteText, viewedID, onPasteConverted }: {
  topLevelBoxes: FrameBox[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  onPasteText: (anchorPos: { x: number; y: number }, text: string, parentIDOverride?: string) => void
  viewedID: string
  onPasteConverted: (res: PasteResult) => void
}) {
  const lastMouse = useRef<{ x: number; y: number } | null>(null)
  const stateRef = useRef({ topLevelBoxes, screenToFlowPosition, onPasteText, viewedID, onPasteConverted })
  useEffect(() => {
    stateRef.current = { topLevelBoxes, screenToFlowPosition, onPasteText, viewedID, onPasteConverted }
  }, [topLevelBoxes, screenToFlowPosition, onPasteText, viewedID, onPasteConverted])

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', onPointerMove)
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(document.activeElement)) return
      const data = e.clipboardData
      if (!data) return
      // A copied FILE (a Finder ⌘C) is meant to behave exactly like a
      // file drop (LOCKED design §2b) -- real absolute paths for a
      // pasted file are not resolvable through the standard Clipboard
      // API (the same sandboxing that motivated the native drag-and-drop
      // door for files), so this door is TEXT/HTML only for now; a
      // copied file currently falls through as a no-op rather than
      // faking a path.
      if (data.files.length > 0) return
      const html = data.getData('text/html')
      const text = data.getData('text/plain')
      if (!html && !text) return
      e.preventDefault()

      const anchorPos = lastMouse.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      const { topLevelBoxes: boxes, screenToFlowPosition: toFlow, onPasteText: openPopover, viewedID: viewed, onPasteConverted: converted } = stateRef.current
      const flowPos = toFlow(anchorPos)
      const parentIDOverride = frameContainingPoint(boxes, flowPos) ?? undefined

      const fallThrough = () => {
        if (html) {
          void AtlasService.ConvertHTMLToMarkdown(html)
            .then((md) => openPopover(anchorPos, md, parentIDOverride))
            .catch(() => openPopover(anchorPos, text, parentIDOverride))
        } else {
          openPopover(anchorPos, text, parentIDOverride)
        }
      }

      // Paste understanding (goal 0138): diagram-tool payloads become
      // Mill entities in place -- everything unrecognized falls
      // through to the popover door exactly as before.
      if (text) {
        void AtlasService.PasteToBoard(text, parentIDOverride ?? viewed, flowPos.x, flowPos.y)
          .then((res) => {
            if (res.Recognized) {
              void refreshAtlas()
              converted(res)
              return
            }
            fallThrough()
          })
          .catch((err) => {
            // A conversion failure falls through to the ordinary paste
            // door -- logged so a real defect is visible, not silent.
            console.error('paste conversion failed', err)
            fallThrough()
          })
        return
      }
      fallThrough()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}
