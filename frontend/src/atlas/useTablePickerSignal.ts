import { useEffect, useRef, useState } from 'react'
import { useUISignalStore } from '../shared/uiSignalStore'

// The tray's table size picker open-state (goal 0139), split out of
// AtlasBoard.tsx at the 500-line convention: opened by the tool
// button (setOpen) or bare T (the atlas.create.table command's
// signal, consumed here).
export function useTablePickerSignal() {
  const [open, setOpen] = useState(false)
  // Picking a size ARMS the tool (goal 0148): the next canvas click
  // places the C×R table at that point; Escape disarms.
  const [pendingSize, setPendingSize] = useState<{ cols: number; rows: number } | null>(null)
  const request = useUISignalStore((st) => st.atlasTablePickerRequest)
  const lastRequest = useRef(request)
  useEffect(() => {
    if (request === lastRequest.current) return
    lastRequest.current = request
    setOpen(true)
  }, [request])
  // Escape disarms an armed size -- owned here so the board's own
  // Escape ladder needs no extra rung.
  useEffect(() => {
    if (!pendingSize) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingSize(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingSize])

  return { open, setOpen, pendingSize, setPendingSize }
}
