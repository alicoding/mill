import { useEffect, useRef, useState } from 'react'
import { useUISignalStore } from '../shared/uiSignalStore'

// The image tool's own tray open-state (goal 0169 slice 2), mirroring
// useTablePickerSignal.ts's request-driven open (bare I / the
// atlas.create.image command's signal). No armed-placement phase like
// Table's pendingSize: paste-or-drop resolves and lands the card
// directly from the popover, so open/close is the whole state.
export function useAtlasImagePopoverSignal() {
  const [open, setOpen] = useState(false)
  const request = useUISignalStore((s) => s.atlasImagePopoverRequest)
  const lastRequest = useRef(request)
  useEffect(() => {
    if (request === lastRequest.current) return
    lastRequest.current = request
    setOpen(true)
  }, [request])

  return { open, setOpen }
}
