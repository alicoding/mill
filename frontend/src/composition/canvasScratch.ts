import type { Edge as RFEdge } from '@xyflow/react'
import type { Node as CompNode, Edge as CompEdge, Note as CompNote } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode, CanvasNoteNode } from './canvasStore'
import { toDraftEdges, toDraftNodes, toDraftNotes } from './draftPayload'

// Hot-exit scratch for the canvas authoring surface (docs/goals/0012-
// authoring-hot-exit.md): a debounced localStorage mirror of the
// in-progress draft, keyed per work-tab identity (WorkTab.key,
// shared/store.ts) so a workflow-edit and a workflow-new tab each get
// their own independent scratch slot. Deliberately localStorage, not a
// Go-side persisted mechanism -- this is unsaved, in-progress authoring
// state, the same tier window-position/tab-strip/filter state already
// lives at (SPEC.md §3.7), not a Configure-authored entity. Configure
// forms are out of this goal's scope entirely (its own scope split) --
// this module only ever touches canvas tab keys, nothing reaches for it
// from configure/.
//
// Cleared on: a successful Save (CompositionCanvas.tsx's save(), the
// moment the draft this scratch shadows no longer exists as "unsaved")
// and a deliberate tab close/back (app/WorkTabShell.tsx, wrapping every
// path that removes a canvas work tab) -- never on reload/quit, which
// is the entire point: those are exactly the events hot exit exists to
// survive.

export interface ScratchDraft {
  label: string
  description: string
  nodes: CompNode[]
  edges: CompEdge[]
  notes: CompNote[]
}

const SCRATCH_PREFIX = 'mill-canvas-scratch:'
const DEBOUNCE_MS = 500

function storageKey(tabKey: string): string {
  return `${SCRATCH_PREFIX}${tabKey}`
}

export function readScratch(tabKey: string): ScratchDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(tabKey))
    if (!raw) return null
    return JSON.parse(raw) as ScratchDraft
  } catch {
    return null
  }
}

const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>()

export function cancelScheduledScratchWrite(tabKey: string): void {
  const existing = pendingWrites.get(tabKey)
  if (existing !== undefined) {
    clearTimeout(existing)
    pendingWrites.delete(tabKey)
  }
}

// Debounced (~500ms per the goal doc) -- every keystroke/drag would
// otherwise thrash localStorage on a large canvas.
export function scheduleScratchWrite(tabKey: string, draft: ScratchDraft): void {
  cancelScheduledScratchWrite(tabKey)
  pendingWrites.set(
    tabKey,
    setTimeout(() => {
      pendingWrites.delete(tabKey)
      try {
        localStorage.setItem(storageKey(tabKey), JSON.stringify(draft))
      } catch {
        // localStorage can throw (quota, private-mode Safari) -- hot
        // exit is best-effort convenience, never a hard requirement of
        // the editing session itself.
      }
    }, DEBOUNCE_MS),
  )
}

// Cancels any in-flight debounced write before removing the entry, so a
// timer scheduled just before a deliberate close/save can never land
// AFTER the clear and silently resurrect the scratch it was told to
// discard.
export function clearScratch(tabKey: string): void {
  cancelScheduledScratchWrite(tabKey)
  try {
    localStorage.removeItem(storageKey(tabKey))
  } catch {
    // best-effort, see scheduleScratchWrite
  }
}

export function buildScratchDraft(label: string, description: string, nodes: CanvasNode[], edges: RFEdge[], notes: CanvasNoteNode[] = []): ScratchDraft {
  return { label, description, nodes: toDraftNodes(nodes), edges: toDraftEdges(edges), notes: toDraftNotes(notes) }
}

// ID-agnostic structural comparison. A fresh mount's starter node (and
// any node dropped since) gets a brand-new crypto.randomUUID() every
// time the canvas is built from scratch, so comparing by literal
// node/edge id would flag an entirely unedited new-workflow canvas as
// "dirty" purely because two independent mounts produced different
// ids for the same one starter node -- exactly the false positive this
// exists to avoid. Node identity here is positional (declaration
// order) instead, which is stable across mounts because the
// starter-node/loaded-workflow construction order is itself
// deterministic.
function normalize(draft: ScratchDraft) {
  const nodes = draft.nodes ?? []
  const edges = draft.edges ?? []
  // Notes (docs/goals/0055) carry no ID-agnostic concern the comment
  // above describes -- a brand-new workflow starts with zero notes (no
  // default "starter note" the way it has a starter step), so an
  // existing note's id is always the same stable backend id across
  // mounts. Sorted by id only to keep the comparison order-independent.
  const notes = [...(draft.notes ?? [])].sort((a, b) => a.ID.localeCompare(b.ID))
  const indexByID = new Map(nodes.map((n, i) => [n.ID, i]))
  return {
    label: draft.label,
    description: draft.description,
    nodes: nodes.map((n) => ({ i: indexByID.get(n.ID), Kind: n.Kind, NodeTypeID: n.NodeTypeID, Config: n.Config, Position: n.Position })),
    edges: edges.map((e) => ({
      source: indexByID.get(e.Source),
      target: indexByID.get(e.Target),
      SourceHandle: e.SourceHandle,
    })),
    notes: notes.map((n) => ({ ID: n.ID, Text: n.Text, Position: n.Position, Size: n.Size, Color: n.Color })),
  }
}

export function draftsEqual(a: ScratchDraft, b: ScratchDraft): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}
