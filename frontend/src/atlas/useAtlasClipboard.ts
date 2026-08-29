import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { Card, Kind, Note, Link, ViewMode } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { refreshAtlas } from './atlasStore'
import { childrenOf } from './atlasGrouping'
import { frameContainingPoint } from './atlasFramePoint'
import type { FrameBox } from './useAtlasDragFiling'
import { parseAtlasClonePayload, serializeAtlasSelection, type AtlasClonePayload } from './atlasClipboard'
import { modalSurfaceOpen } from '../shared/modalGate'

// createClones performs the payload's writes: cards parents-before-
// children (co-copied structure re-parents onto fresh clone ids, pass
// by pass), then notes, then the set-scoped links. Returns the clone
// id per payload card index.
async function createCloneCards(payload: AtlasClonePayload, anchor: { x: number; y: number }, targetParent: string): Promise<(string | null)[]> {
  const createdIDs: (string | null)[] = payload.cards.map(() => null)
  let remaining = payload.cards.map((_, i) => i)
  while (remaining.length > 0) {
    const ready = remaining.filter((i) => payload.cards[i].parentIdx === null || createdIDs[payload.cards[i].parentIdx!] !== null)
    if (ready.length === 0) break
    for (const i of ready) {
      const c = payload.cards[i]
      const parent = c.parentIdx === null ? targetParent : createdIDs[c.parentIdx]!
      const pos = c.parentIdx === null ? { X: anchor.x + c.dx, Y: anchor.y + c.dy } : { X: c.dx, Y: c.dy }
      const created = await AtlasService.CreateCard(c.kindID, c.title, c.note, c.fields, parent, pos, c.viewMode as ViewMode, c.source, '', '')
      createdIDs[i] = created.ID
    }
    remaining = remaining.filter((i) => createdIDs[i] === null)
  }
  return createdIDs
}

async function createClones(payload: AtlasClonePayload, anchor: { x: number; y: number }, targetParent: string): Promise<(string | null)[]> {
  const createdIDs = await createCloneCards(payload, anchor, targetParent)
  for (const n of payload.notes) {
    await AtlasService.CreateNote(n.text, { X: anchor.x + n.dx, Y: anchor.y + n.dy }, targetParent)
  }
  for (const l of payload.links) {
    const from = createdIDs[l.source]
    const to = createdIDs[l.target]
    if (from && to) await AtlasService.CreateLink(from, to, l.linkKindID, l.label)
  }
  return createdIDs
}

function isEditableTarget(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
}

// The board's copy/paste door (docs/goals/0153): ⌘C serializes the
// selection through the copy event's own clipboardData; ⌘V
// materializes a recognized payload at the cursor, filed into the
// frame under it. Shallow by default -- a single-card paste whose
// source has items inside offers "also copy them" through the quiet
// toast's action (the post-paste affordance the goal's contract
// picked over a dialog or a hidden shortcut).
export function useAtlasClipboard({ allCards, allNotes, links, kinds, selectedCardIDs, selectedNoteIDs, topLevelBoxes, screenToFlowPosition, viewedID, readOnly, showToast }: {
  allCards: Card[]
  allNotes: Note[]
  links: Link[]
  kinds: Kind[]
  selectedCardIDs: string[]
  selectedNoteIDs: string[]
  topLevelBoxes: FrameBox[]
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }
  viewedID: string
  readOnly: boolean
  showToast: (text: string, action?: { label: string; run: () => void }) => void
}) {
  const { t } = useTranslation('atlas')
  const lastMouse = useRef<{ x: number; y: number } | null>(null)
  const stateRef = useRef({ allCards, allNotes, links, kinds, selectedCardIDs, selectedNoteIDs, topLevelBoxes, screenToFlowPosition, viewedID, readOnly, showToast, t })
  useEffect(() => {
    stateRef.current = { allCards, allNotes, links, kinds, selectedCardIDs, selectedNoteIDs, topLevelBoxes, screenToFlowPosition, viewedID, readOnly, showToast, t }
  })

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      lastMouse.current = { x: e.clientX, y: e.clientY }
    }

    const onCopy = (e: ClipboardEvent) => {
      const s = stateRef.current
      // A modal above the board owns the screen: copying here would
      // silently overwrite the clipboard with a HIDDEN board selection.
      if (modalSurfaceOpen()) return
      if (isEditableTarget(document.activeElement)) return
      if (window.getSelection()?.toString()) return
      const payload = serializeAtlasSelection(s.allCards, s.allNotes, s.links, s.selectedCardIDs, s.selectedNoteIDs)
      if (!payload) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', JSON.stringify(payload))
      s.showToast(s.t('clipboard.copied', { count: payload.cards.length + payload.notes.length }))
    }

    // cloneSubtree recreates everything under sourceID beneath the
    // clone -- the "also copy the items inside" offer's own work.
    const cloneSubtree = async (targetParentID: string, sourceID: string): Promise<void> => {
      const s = stateRef.current
      for (const child of childrenOf(s.allCards, sourceID)) {
        const created = await AtlasService.CreateCard(child.KindID, child.Title, child.Note, child.Fields ?? {}, targetParentID, child.Position, child.ViewMode, child.Source, '', '')
        await cloneSubtree(created.ID, child.ID)
      }
      for (const n of s.allNotes.filter((x) => x.ParentID === sourceID)) {
        await AtlasService.CreateNote(n.Text, n.Position, targetParentID)
      }
    }

    const pasteClones = async (payload: AtlasClonePayload) => {
      const s = stateRef.current
      const known = new Set(s.kinds.map((k) => k.ID))
      if (payload.cards.some((c) => !known.has(c.kindID))) {
        s.showToast(s.t('clipboard.unknownKind'))
        return
      }
      const anchorScreen = lastMouse.current ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
      const anchor = s.screenToFlowPosition(anchorScreen)
      const targetParent = frameContainingPoint(s.topLevelBoxes, anchor) ?? s.viewedID
      const createdIDs = await createClones(payload, anchor, targetParent)
      await refreshAtlas()

      const count = payload.cards.length + payload.notes.length
      const single = payload.cards.length === 1 && payload.notes.length === 0 ? payload.cards[0] : null
      const cloneID = createdIDs[0]
      if (single && cloneID && single.childCount > 0 && s.allCards.some((c) => c.ID === single.sourceID)) {
        s.showToast(s.t('clipboard.pasted', { count }), {
          label: s.t('clipboard.includeChildren', { count: single.childCount }),
          run: () => {
            void cloneSubtree(cloneID, single.sourceID)
              .then(() => refreshAtlas())
              .then(() => stateRef.current.showToast(stateRef.current.t('clipboard.childrenCopied', { count: single.childCount })))
          },
        })
      } else {
        s.showToast(s.t('clipboard.pasted', { count }))
      }
    }

    const onPaste = (e: ClipboardEvent) => {
      const s = stateRef.current
      if (s.readOnly) return
      // Same modal stand-down as onCopy: pasted clones would land
      // invisibly behind the open dialog.
      if (modalSurfaceOpen()) return
      if (isEditableTarget(document.activeElement)) return
      const payload = parseAtlasClonePayload(e.clipboardData?.getData('text/plain') ?? '')
      if (!payload) return
      e.preventDefault()
      e.stopImmediatePropagation()
      void pasteClones(payload)
    }

    window.addEventListener('pointermove', onPointerMove)
    document.addEventListener('copy', onCopy)
    // Capture phase deliberately: useAtlasPaste's own text/HTML door
    // listens on the same document; a clone payload must be claimed
    // before it can fall through as ordinary pasted text.
    document.addEventListener('paste', onPaste, true)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste, true)
    }
  }, [])
}
