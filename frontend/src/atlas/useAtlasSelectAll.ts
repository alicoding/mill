import { useEffect, useRef } from 'react'
import type { Node } from '@xyflow/react'
import type { BoardObject, Card, Note } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { useUISignalStore } from '../shared/uiSignalStore'

// atlas.selectAll (Cmd+A, shared/atlasBoardCommands.ts): selects every
// top-level card/note/board-object node currently rendered on this
// board -- a region frame's own preview children are excluded,
// matching AtlasBoard's own renderedIDs contract of what's real at
// THIS level. Ref-latest pattern (not a dependency-keyed effect) so a
// fast repeat press can't be dropped between an unsubscribe and
// resubscribe, same reasoning useAtlasSelectionTray.ts's own header
// comment documents for its window listener.
//
// Select-by-kind (goal 0193, draw.io's "select all edges / all
// vertices") rides the SAME apply-selection mechanism as a second,
// independently-tracked request -- selecting the SAME top-level
// cards/objects, filtered to one KindID/Kind rather than everything.
export function useAtlasSelectAll<TNode extends Node>({ cards, notes, objects, setNodes }: {
  cards: Card[]
  notes: Note[]
  objects: BoardObject[]
  setNodes: (updater: (nodes: TNode[]) => TNode[]) => void
}) {
  const request = useUISignalStore((s) => s.atlasSelectAllRequest)
  const kindRequest = useUISignalStore((s) => s.atlasSelectKindRequest)
  const latest = useRef({ cards, notes, objects, setNodes })
  useEffect(() => {
    latest.current = { cards, notes, objects, setNodes }
  })
  const applySelection = (ids: Set<string>) => {
    latest.current.setNodes((nds) => nds.map((node) => ({ ...node, selected: ids.has(node.id) })))
  }
  const last = useRef(request)
  useEffect(() => {
    if (request === last.current) return
    last.current = request
    const { cards: c, notes: n, objects: o } = latest.current
    applySelection(new Set<string>([...c.map((card) => card.ID), ...n.map((note) => note.ID), ...o.map((object) => object.ID)]))
  }, [request])
  const lastKind = useRef(kindRequest?.token)
  useEffect(() => {
    if (kindRequest === null || kindRequest.token === lastKind.current) return
    lastKind.current = kindRequest.token
    const { cards: c, objects: o } = latest.current
    const ids = kindRequest.scope === 'card'
      ? c.filter((card) => card.KindID === kindRequest.kind).map((card) => card.ID)
      : o.filter((object) => object.Kind === kindRequest.kind).map((object) => object.ID)
    applySelection(new Set(ids))
  }, [kindRequest])
}
