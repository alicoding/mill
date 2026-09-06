import { create } from 'zustand'
import type { CommandContext, SelectionContext, SelectionTarget } from './commandContext'

// The Atlas board's selection as shared state (goal 0346 slice B, the
// JetBrains DataContext / VS Code listFocus shape): the board writes
// it once per React Flow selection change, and every invoker that has
// no row to point at -- the keydown dispatcher, the palette, a
// keystroke-bound board command -- reads it back through
// ambientContext(). A menu built on a right-click hands the same shape
// for the thing it was opened on, so a card's "Open" runs the SAME
// command with the SAME context whichever door fired it.
//
// Ids only. What a command needs to know about a selected thing beyond
// its id (does this card mirror a file, which exporters does it have)
// is answered by shared/atlasSelectionFacts.ts, so the snapshot never
// drifts from the data it names.
//
// A store, not a React Flow read: the palette and the dispatcher run
// outside the board's tree, and this file is a dependency-cruiser leaf
// (shared/ never imports atlas/).
export interface AtlasSelection {
  spaceId: string
  cards: string[]
  notes: string[]
  objects: string[]
  // Single-link arteries only: an aggregated artery (count > 1) is not
  // one link, and no link command can act on it honestly.
  links: string[]
}

// What a selection command asks the board to do when the doing needs
// the board's own UI -- a popover, a confirm, the card page, the undo
// toast -- rather than a service call this file could place itself.
// The same downward-request-token contract store.ts's
// canvasCommandRequest established: the command writes one request,
// AtlasView consumes it.
export type AtlasSelectionRequest =
  | { action: 'open'; card: string }
  | { action: 'zoom'; card: string }
  | { action: 'openNote'; note: string }
  | { action: 'addLinkedCard'; card: string; pos?: { x: number; y: number } }
  | { action: 'addInside'; frame: string; tool: 'card' | 'note'; pos?: { x: number; y: number } }
  | { action: 'promoteNote'; note: string; pos?: { x: number; y: number } }
  | { action: 'promoteObject'; object: string; pos?: { x: number; y: number } }
  | { action: 'group'; cards: string[]; notes: string[]; objects: string[]; pos?: { x: number; y: number } }
  | { action: 'delete'; cards: string[]; notes: string[]; objects: string[] }
  | { action: 'dissolve'; card: string }
  | { action: 'editLinkLabel'; link: string; pos?: { x: number; y: number } }
  | { action: 'editDiagram'; object: string }
  | { action: 'pluginAction'; object: string; item: string }
  | { action: 'exportAs'; card: string; format?: string; pos?: { x: number; y: number } }
  | { action: 'perspective'; op: 'add' | 'remove'; perspective: string; cards: string[] }
  | { action: 'newSpace' }
  | { action: 'deleteSpace'; card: string }

interface AtlasSelectionState extends AtlasSelection {
  request: { seq: number; request: AtlasSelectionRequest } | null
  setSelection: (next: AtlasSelection) => void
  clearSelection: () => void
  requestAction: (request: AtlasSelectionRequest) => void
  consumeRequest: () => void
}

const EMPTY: AtlasSelection = { spaceId: '', cards: [], notes: [], objects: [], links: [] }

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

export const useAtlasSelectionStore = create<AtlasSelectionState>()((set, get) => ({
  ...EMPTY,
  request: null,
  // Identity-stable when nothing changed: React Flow reports a change
  // on every nodes-array identity change (useAtlasSelection.ts's own
  // header), and a fresh store value per report would wake every
  // subscriber for nothing.
  setSelection: (next) => {
    const s = get()
    if (s.spaceId === next.spaceId && sameIds(s.cards, next.cards) && sameIds(s.notes, next.notes) && sameIds(s.objects, next.objects) && sameIds(s.links, next.links)) return
    set({ spaceId: next.spaceId, cards: [...next.cards], notes: [...next.notes], objects: [...next.objects], links: [...next.links] })
  },
  clearSelection: () => {
    const s = get()
    if (s.cards.length + s.notes.length + s.objects.length + s.links.length === 0) return
    set({ cards: [], notes: [], objects: [], links: [] })
  },
  requestAction: (request) => set((s) => ({ request: { seq: (s.request?.seq ?? 0) + 1, request } })),
  consumeRequest: () => set({ request: null }),
}))

export function atlasSelectionEmpty(sel: Pick<AtlasSelection, 'cards' | 'notes' | 'objects' | 'links'>): boolean {
  return sel.cards.length + sel.notes.length + sel.objects.length + sel.links.length === 0
}

// The selection context a menu hands its items: the store's own
// snapshot unless the surface names exactly what it was opened on
// (a right-click on one edge, a frame's interior), plus the target
// a data-driven item chose.
export function atlasSelectionContext(override?: Partial<AtlasSelection>, target?: SelectionTarget): SelectionContext {
  const s = useAtlasSelectionStore.getState()
  const ctx: SelectionContext = {
    kind: 'selection',
    spaceId: override?.spaceId ?? s.spaceId,
    cards: override?.cards ?? s.cards,
    notes: override?.notes ?? s.notes,
    objects: override?.objects ?? s.objects,
    links: override?.links ?? s.links,
  }
  if (target) ctx.target = target
  return ctx
}

export function requestAtlasSelectionAction(request: AtlasSelectionRequest): void {
  useAtlasSelectionStore.getState().requestAction(request)
}

export function isSelectionContext(ctx: CommandContext | undefined): ctx is SelectionContext {
  return ctx?.kind === 'selection'
}
