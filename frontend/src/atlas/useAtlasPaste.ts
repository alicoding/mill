import { useEffect, useRef } from 'react'
import { AtlasService } from '../shared/bindings'
import type { PasteResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { refreshAtlas } from './atlasStore'
import { frameContainingPoint } from './atlasFramePoint'
import type { FrameBox } from './useAtlasDragFiling'

// isEditableTarget mirrors the LOCKED design's own gate ("when the
// Atlas board has focus and no editable element does"): a paste
// landing in a text field, a creation popover's own title input, or
// any contenteditable region must fall through to the browser's
// ordinary paste, never get hijacked into a new note.
function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

// The map's own paste door (goal 0081 slice A3; fallback redesigned by
// goal 0218): a recognized clipboard shape (drawio, an M365 table,
// TSV) converts directly into board entities server-side. Unrecognized
// text/HTML lands as a sticky NOTE at the pointer instead -- HTML
// converts to Markdown first via the existing Go conversion path -- and
// the new note is left selected, no modal (the converged canvas
// convention: pasting never routes the user through a Kind/title
// prompt). Anchored at the last known mouse position (tracked here,
// cheap: a ref updated on pointermove, no re-renders) rather than a
// fixed viewport center, so the note lands near where the user
// actually is.
export function useAtlasPaste({ topLevelBoxes, screenToFlowPosition, viewedID, onPasteConverted, onNoteCreated }: {
  topLevelBoxes: FrameBox[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  viewedID: string
  onPasteConverted: (res: PasteResult) => void
  // The fallback note's own id, once CreateNote resolves -- the
  // caller's own selection mechanism (useAtlasSelection's selectNote)
  // marks it selected without a pointer event ever touching it.
  onNoteCreated: (id: string) => void
}) {
  const lastMouse = useRef<{ x: number; y: number } | null>(null)
  const stateRef = useRef({ topLevelBoxes, screenToFlowPosition, viewedID, onPasteConverted, onNoteCreated })
  useEffect(() => {
    stateRef.current = { topLevelBoxes, screenToFlowPosition, viewedID, onPasteConverted, onNoteCreated }
  }, [topLevelBoxes, screenToFlowPosition, viewedID, onPasteConverted, onNoteCreated])

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
      const { topLevelBoxes: boxes, screenToFlowPosition: toFlow, viewedID: viewed, onPasteConverted: converted, onNoteCreated: noteCreated } = stateRef.current
      const flowPos = toFlow(anchorPos)
      const parentIDOverride = frameContainingPoint(boxes, flowPos) ?? undefined
      const targetParentID = parentIDOverride ?? viewed

      // Recognition failed (or found nothing to recognize): the pasted
      // content lands as a sticky note at the pointer, never a card and
      // never a modal (goal 0218) -- HTML converts to Markdown first,
      // the same conversion the recognizer's own HTML path would have
      // used had it recognized a table.
      const landAsNote = (content: string) => {
        void AtlasService.CreateNote(content, { X: flowPos.x, Y: flowPos.y }, targetParentID)
          .then(async (note) => {
            // refreshAtlas MUST resolve before selecting -- the
            // selection-apply effect (AtlasBoard.tsx) only marks a node
            // selected if it's already present in allNodes; selecting
            // before the new note lands there is a no-op (shapeTool.ts's
            // own onShapeCreated await is the proven precedent).
            await refreshAtlas()
            noteCreated(note.ID)
          })
          .catch((err) => console.error('paste note creation failed', err))
      }
      const fallThrough = () => {
        if (html) {
          void AtlasService.ConvertHTMLToMarkdown(html).then(landAsNote).catch(() => landAsNote(text))
        } else {
          landAsNote(text)
        }
      }

      // Paste understanding (goal 0138, extended by 0218): a recognized
      // clipboard shape (drawio, an M365 HTML table, TSV) becomes Mill
      // entities in place server-side -- everything unrecognized falls
      // through to the note door above. text/html can't both be empty
      // here (guarded above), so PasteToBoard always gets something to
      // try.
      void AtlasService.PasteToBoard(text, html, targetParentID, flowPos.x, flowPos.y)
        .then((res) => {
          if (res.Recognized) {
            void refreshAtlas()
            converted(res)
            return
          }
          fallThrough()
        })
        .catch((err) => {
          // A conversion failure falls through to the note door --
          // logged so a real defect is visible, not silent.
          console.error('paste conversion failed', err)
          fallThrough()
        })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}
