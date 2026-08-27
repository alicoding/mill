import { useEffect, useRef } from 'react'
import { useUISignalStore } from '../shared/uiSignalStore'
import type { AtlasToolID } from './atlasTools'

// The image tool's own tray open-state (goal 0169 slice 2), mirroring
// useTablePickerSignal.ts's request-driven open (bare I / the
// atlas.create.image command's signal). No armed-placement phase like
// Table's pendingSize: paste-or-drop resolves and lands the card
// directly from the popover, so open/close is the whole state --
// derived entirely off the SHARED armedToolId field
// (useAtlasArmedTool.ts, goal 0238) rather than a private boolean, so
// arming a different tool (pencil, or Table's own picker) closes this
// popover for free instead of leaving it showing armed alongside
// whatever else just armed.
export function useAtlasImagePopoverSignal({ armedToolId, arm, disarm }: {
  armedToolId: AtlasToolID | null
  arm: (tool: AtlasToolID) => void
  disarm: () => void
}) {
  const open = armedToolId === 'image'
  const setOpen = (next: boolean) => {
    if (next) arm('image')
    else disarm()
  }
  const request = useUISignalStore((s) => s.atlasImagePopoverRequest)
  const lastRequest = useRef(request)
  useEffect(() => {
    if (request === lastRequest.current) return
    lastRequest.current = request
    arm('image')
  }, [request, arm])

  return { open, setOpen }
}
