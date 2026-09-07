import { useEffect, useRef } from 'react'
import type { TFunction } from 'i18next'
import type { BoardObject, Card } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { AtlasService } from '../shared/bindings'
import { atlasSelectionContext, useAtlasSelectionStore, type AtlasSelectionRequest } from '../shared/atlasSelectionStore'
import type { ContextMenuItem, ContextMenuState } from '../shared/ContextMenu'
import { refreshAtlas, useAtlasStore } from './atlasStore'
import { exportersForCard } from './atlasUnits'
import { runCardExport } from './atlasCardExportMenu'
import { boardObjectContentFor, thirdPartyNounFor } from './atlasNounRegistry'
import { dispatchObjectEdit } from './objectSeams'
import type { AtlasCreationTool } from './atlasTools'

type Pos = { x: number; y: number }

// Where a popover lands when the request came from a keystroke or the
// palette rather than a click: the selection's own node, else the
// board's top-left.
function anchorFor(id: string | undefined, pos: Pos | undefined): Pos {
  if (pos) return pos
  const node = id ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`) : null
  const rect = node?.getBoundingClientRect()
  if (rect) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  const board = document.querySelector<HTMLElement>('[data-testid="atlas-board"]')?.getBoundingClientRect()
  return board ? { x: board.left + 80, y: board.top + 80 } : { x: 80, y: 80 }
}

// The board-side half of every selection command (goal 0346 slice B):
// shared/atlasSelectionCommands.ts writes ONE request into the
// selection store when the doing needs this view's own UI -- the card
// page, a creation popover, the container-delete confirm, the undo
// toast, the quiet toast -- and this hook consumes it with the
// closures AtlasView already owns. The same downward-request contract
// store.ts's canvasCommandRequest established; every value is read
// through a ref so the effect registers once.
export function useAtlasSelectionRequests(handlers: {
  t: TFunction<'atlas'>
  allCards: Card[]
  allObjects: BoardObject[]
  openCard: (id: string) => void
  drill: (id: string) => void
  openNote: (id: string) => void
  requestLinkedCard: (fromCardID: string, pos: Pos) => void
  requestPlacement: (tool: AtlasCreationTool, pos: Pos, parentID?: string) => void
  requestPromote: (noteID: string, pos: Pos) => void
  requestPromoteObject: (objectID: string, pos: Pos) => void
  requestGroup: (cardIDs: string[], noteIDs: string[], objectIDs: string[], pos: Pos) => void
  deleteSelection: (cardIDs: string[], noteIDs: string[], objectIDs: string[]) => void
  dissolve: (frameID: string) => void
  editLinkLabel: (linkID: string, pos: Pos) => void
  setMenu: (state: ContextMenuState | null) => void
  onError: (message: string) => void
  onToast: (message: string) => void
  onNewSpace: () => void
  deleteCurrentSpace: (id: string) => void
}) {
  const latest = useRef(handlers)
  useEffect(() => { latest.current = handlers })

  const pending = useAtlasSelectionStore((s) => s.request)
  useEffect(() => {
    if (!pending) return
    useAtlasSelectionStore.getState().consumeRequest()
    handle(pending.request, latest.current)
  }, [pending])
}

function handle(req: AtlasSelectionRequest, h: Parameters<typeof useAtlasSelectionRequests>[0]): void {
  switch (req.action) {
    case 'open': h.openCard(req.card); return
    case 'zoom': h.drill(req.card); return
    case 'openNote': h.openNote(req.note); return
    case 'addLinkedCard': h.requestLinkedCard(req.card, anchorFor(req.card, req.pos)); return
    case 'addInside': h.requestPlacement(req.tool, anchorFor(req.frame || undefined, req.pos), req.frame || undefined); return
    case 'promoteNote': h.requestPromote(req.note, anchorFor(req.note, req.pos)); return
    case 'promoteObject': h.requestPromoteObject(req.object, anchorFor(req.object, req.pos)); return
    case 'group': h.requestGroup(req.cards, req.notes, req.objects, anchorFor(req.cards[0] ?? req.notes[0] ?? req.objects[0], req.pos)); return
    case 'delete': h.deleteSelection(req.cards, req.notes, req.objects); return
    case 'dissolve': h.dissolve(req.card); return
    case 'editLinkLabel': h.editLinkLabel(req.link, anchorFor(undefined, req.pos)); return
    case 'editDiagram': {
      const object = h.allObjects.find((o) => o.ID === req.object)
      const editRoute = object ? boardObjectContentFor(object.Kind)?.editRoute : undefined
      if (object && editRoute) dispatchObjectEdit(object, editRoute).catch((err) => h.onError(String(err)))
      return
    }
    case 'pluginAction': {
      const object = h.allObjects.find((o) => o.ID === req.object)
      const item = object ? thirdPartyNounFor(object.Kind)?.menuItems?.find((i) => i.id === req.item) : undefined
      if (object && item) item.run(object)
      return
    }
    case 'exportAs': exportCard(req, h); return
    case 'perspective': {
      const write = req.op === 'add' ? AtlasService.AddToPerspective : AtlasService.RemoveFromPerspective
      const name = latestPerspectiveName(req.perspective)
      Promise.all(req.cards.map((id) => write(req.perspective, id)))
        .then(() => { h.onToast(h.t(req.op === 'add' ? 'perspective.addedToast' : 'perspective.removedToast', { name })); void refreshAtlas() })
        .catch((err) => h.onToast(String(err)))
      return
    }
    case 'newSpace': h.onNewSpace(); return
    case 'deleteSpace': h.deleteCurrentSpace(req.card); return
  }
}

// Read at request time from the Atlas store, not captured at menu
// build: a perspective renamed between the two would toast its old
// name.
function latestPerspectiveName(id: string): string {
  return (useAtlasStore.getState().perspectives ?? []).find((p) => p.ID === id)?.Name ?? ''
}

// Export-as over the selection: a named format downloads; otherwise the
// sole format downloads and several open as a format menu at the
// request's own point (a right-click) or a fixed corner (the palette).
function exportCard(req: Extract<AtlasSelectionRequest, { action: 'exportAs' }>, h: Parameters<typeof useAtlasSelectionRequests>[0]): void {
  const card = h.allCards.find((c) => c.ID === req.card)
  if (!card) return
  const exporters = exportersForCard(card, h.t('export.originalFile'))
  const chosen = req.format ? exporters.find((e) => e.format === req.format) : exporters.length === 1 ? exporters[0] : undefined
  if (chosen) { void runCardExport(card, chosen, h.onError); return }
  if (exporters.length === 0) return
  const pos = req.pos ?? { x: window.innerWidth - 280, y: 96 }
  h.setMenu({
    x: pos.x,
    y: pos.y,
    items: exporters.map((e): ContextMenuItem => ({ id: `export-${e.format}`, commandId: 'atlas.card.exportAs', ctx: atlasSelectionContext({ cards: [card.ID], notes: [], objects: [], links: [] }, { format: e.format, pos }) })),
  })
}
