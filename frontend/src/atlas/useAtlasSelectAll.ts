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
export function useAtlasSelectAll<TNode extends Node>({ cards, notes, objects, setNodes }: {
  cards: Card[]
  notes: Note[]
  objects: BoardObject[]
  setNodes: (updater: (nodes: TNode[]) => TNode[]) => void
}) {
  const request = useUISignalStore((s) => s.atlasSelectAllRequest)
  const latest = useRef({ cards, notes, objects, setNodes })
  useEffect(() => {
    latest.current = { cards, notes, objects, setNodes }
  })
  const last = useRef(request)
  useEffect(() => {
    if (request === last.current) return
    last.current = request
    const { cards: c, notes: n, objects: o, setNodes: set } = latest.current
    const ids = new Set<string>([...c.map((card) => card.ID), ...n.map((note) => note.ID), ...o.map((object) => object.ID)])
    set((nds) => nds.map((node) => ({ ...node, selected: ids.has(node.id) })))
  }, [request])
}
