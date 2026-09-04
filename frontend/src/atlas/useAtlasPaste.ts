import { useEffect, useRef } from 'react'
import { copy } from '../shared/copy'
import { AtlasService } from '../shared/bindings'
import type { PasteResult } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc/models'
import { refreshAtlas } from './atlasStore'
import { frameContainingPoint } from './atlasFramePoint'
import { localPathFromPastedText } from './atlasCreateHelpers'
import { readClipboardImageFile } from '../shared/clipboardRead'
import { imageTool } from './tools/imageTool'
import { modalSurfaceOpen } from '../shared/modalGate'
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
export function useAtlasPaste({ topLevelBoxes, screenToFlowPosition, viewedID, onPasteConverted, onNoteCreated, landFiles }: {
  topLevelBoxes: FrameBox[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  viewedID: string
  onPasteConverted: (res: PasteResult) => void
  // The fallback note's own id, once CreateNote resolves -- the
  // caller's own selection mechanism (useAtlasSelection's selectNote)
  // marks it selected without a pointer event ever touching it.
  onNoteCreated: (id: string) => void
  // The native drop door's landing half (useAtlasNativeFileDrop.ts):
  // a pasted local file path lands through the exact same pipeline a
  // dropped file does. Rejects when the path doesn't resolve, which
  // this hook answers by falling back to the ordinary text flow.
  landFiles: (filenames: string[], screenPoint: { x: number; y: number }) => Promise<unknown>
}) {
  const lastMouse = useRef<{ x: number; y: number } | null>(null)
  const stateRef = useRef({ topLevelBoxes, screenToFlowPosition, viewedID, onPasteConverted, onNoteCreated, landFiles })
  useEffect(() => {
    stateRef.current = { topLevelBoxes, screenToFlowPosition, viewedID, onPasteConverted, onNoteCreated, landFiles }
  }, [topLevelBoxes, screenToFlowPosition, viewedID, onPasteConverted, onNoteCreated, landFiles])

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointermove', onPointerMove)
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      // A more specific paste surface (the image popover's own paste
      // zone) marks the event handled via preventDefault before it
      // bubbles here -- acting anyway would land the same paste twice.
      if (e.defaultPrevented) return
      // A modal above the board (a card page, the palette) owns the
      // screen: pasting here would land a note invisibly BEHIND it.
      if (modalSurfaceOpen()) return
      if (isEditableTarget(document.activeElement)) return
      const data = e.clipboardData
      if (!data) return
      // A copied FILE (a Finder ⌘C) or a screenshot bitmap arrives as
      // files, whose real paths the web Clipboard API structurally
      // never exposes -- so the HOST pasteboard supplies them
      // (ReadPasteboardFilePaths, goal 0255) and the paste lands with
      // full drop parity through landFiles. No paths (a pure bitmap,
      // or a non-Mac host) falls back to the image File's own bytes
      // through the image tool's commit door. The File ref is taken
      // synchronously: clipboardData is transient after the handler
      // returns.
      if (data.files.length > 0) {
        const imageFile = readClipboardImageFile(data)
        e.preventDefault()
        const filesAnchor = lastMouse.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
        void AtlasService.ReadPasteboardFilePaths()
          .then((paths) => {
            if (paths && paths.length > 0) return stateRef.current.landFiles(paths, filesAnchor)
            if (!imageFile) return
            const { topLevelBoxes: boxes, screenToFlowPosition: toFlow, viewedID: viewed } = stateRef.current
            const pos = toFlow(filesAnchor)
            const parent = frameContainingPoint(boxes, pos) ?? viewed
            return imageTool
              .commit({ file: imageFile, title: copy('atlas:paste.imageTitle') })
              .then((artifact) => AtlasService.CreateBoardObject('image', { mirrorPath: artifact.mirrorPath, title: artifact.title }, { X: pos.x, Y: pos.y }, parent))
              .then(() => refreshAtlas())
          })
          .catch((err) => console.error('pasted file landing failed', err))
        return
      }
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
            // before the new note lands there is a no-op (the plugin
            // adapter's own refresh-then-select createObject ordering
            // is the same proven precedent).
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
      const runRecognizer = () => {
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

      // A pasted LOCAL FILE PATH behaves exactly like dropping that
      // file at the pointer (goal 0179's founding rule: creating a
      // thing creates THAT THING) -- routed through the drop door's own
      // landing pipeline, so diagram/sheet/image extensions, plugin
      // claims, folder import, and the card fallback all match a real
      // drop. A path that doesn't resolve on disk is just text that
      // looks like a path: it falls back to the recognizer flow and
      // still lands as a note, never a dead end.
      const pastedPath = localPathFromPastedText(text)
      if (pastedPath) {
        void stateRef.current.landFiles([pastedPath], anchorPos).catch(runRecognizer)
        return
      }
      runRecognizer()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}
