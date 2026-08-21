import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Connection, Edge as RFEdge } from '@xyflow/react'
import { useTranslation } from 'react-i18next'
import type { NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { CanvasNode } from './canvasStore'
import { isValidCanvasConnection, connectionRefusalReason } from './canvasConnectionRules'

// How long the draw-time kind-mismatch explanation stays on screen
// before clearing itself (ADR-0042 §3's "the refusal must explain
// itself" -- transient, not a persistent banner).
const HINT_DURATION_MS = 5000

// Draw-time connection refusal + its user-visible explanation
// (ADR-0042 slice 2). Split out of CompositionCanvas.tsx (already at
// the 500-line convention, CLAUDE.md) rather than inlined: React Flow
// calls isValidConnection continuously while a connection drag is in
// progress, so the LAST reason it computed (captured in a ref, not
// state, to avoid a render per hovered candidate) is what
// onConnectEnd surfaces once the drag actually finishes.
export function useConnectionRefusalHint(
  nodes: CanvasNode[],
  edges: RFEdge[],
  nodeTypes: NodeType[],
  onStoreConnect: (connection: Connection) => void,
  pauseUndo: () => void,
) {
  const { t } = useTranslation('composition')
  const [refusalHint, setRefusalHint] = useState<string | null>(null)
  const lastReasonRef = useRef<string | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const nodeTypesById = useMemo(() => {
    const map = new Map<string, NodeType>()
    for (const nt of nodeTypes) map.set(nt.ID, nt)
    return map
  }, [nodeTypes])

  const clearRefusalHint = useCallback(() => {
    setRefusalHint(null)
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
  }, [])

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
  }, [])

  const isValidConnection = useCallback(
    (connection: Connection | RFEdge) => {
      if (!isValidCanvasConnection(nodes, edges, connection)) {
        lastReasonRef.current = null
        return false
      }
      const reason = connectionRefusalReason(nodes, edges, connection, nodeTypesById)
      lastReasonRef.current = reason
      return reason === null
    },
    [nodes, edges, nodeTypesById],
  )

  // A fresh drag starts with no candidate reason yet -- otherwise a
  // drop into empty canvas space (isValidConnection never called
  // again after the pointer leaves the last hovered node) would
  // resurface a stale reason from an earlier hover in the same drag.
  const onConnectStart = useCallback(() => {
    lastReasonRef.current = null
  }, [])

  // flash is the panel's generic door (the multi-purpose-surface
  // rule): any canvas concern may show a transient message through
  // the same auto-clearing hint -- the clipboard toasts (goal 0153)
  // are its second consumer.
  const flash = useCallback((message: string) => {
    setRefusalHint(message)
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    clearTimerRef.current = setTimeout(() => {
      setRefusalHint(null)
      clearTimerRef.current = null
    }, HINT_DURATION_MS)
  }, [])

  const onConnectEnd = useCallback(() => {
    const reason = lastReasonRef.current
    lastReasonRef.current = null
    if (!reason) return
    flash(t('compositionCanvas.connectionRefusalHint', { reason }))
  }, [t, flash])

  const onConnect = useCallback(
    (connection: Connection) => {
      onStoreConnect(connection)
      clearRefusalHint()
    },
    [onStoreConnect, clearRefusalHint],
  )

  const onNodeDragStart = useCallback(() => {
    pauseUndo()
    clearRefusalHint()
  }, [pauseUndo, clearRefusalHint])

  return { isValidConnection, refusalHint, flash, onConnectStart, onConnectEnd, onConnect, onNodeDragStart }
}
