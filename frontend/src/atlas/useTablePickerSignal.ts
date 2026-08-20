import { useEffect, useRef, useState } from 'react'
import { useUISignalStore } from '../shared/uiSignalStore'

// The tray's table size picker open-state (goal 0139), split out of
// AtlasBoard.tsx at the 500-line convention: opened by the tool
// button (setOpen) or bare T (the atlas.create.table command's
// signal, consumed here).
export function useTablePickerSignal() {
  const [open, setOpen] = useState(false)
  const request = useUISignalStore((st) => st.atlasTablePickerRequest)
  const lastRequest = useRef(request)
  useEffect(() => {
    if (request === lastRequest.current) return
    lastRequest.current = request
    setOpen(true)
  }, [request])
  return { open, setOpen }
}
