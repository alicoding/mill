import { useEffect, useRef, useState } from 'react'
import { useUISignalStore } from '../shared/uiSignalStore'

const STORAGE_KEY = 'atlas.minimapVisible'

function readStored(): boolean {
  const raw = localStorage.getItem(STORAGE_KEY)
  return raw === null ? true : raw === 'true'
}

// The board's own minimap on/off toggle (goal 0106 slice B contract
// item 5): a session-local preference, defaulting ON -- localStorage,
// the same frontend-only persistence atlasCreateHelpers.ts's own
// last-used-kind default already uses, rather than a new field on the
// backend-persisted AtlasSession record (AtlasService.AtlasSession/
// SetAtlasSession), which only carries viewedID/openCardID/
// activePerspectiveID today. Reachable two ways -- the control-strip
// button calls toggle() directly; atlas.minimap.toggle's own
// uiSignalStore counter (palette/keyboard) drives the SAME toggle
// through this hook's own ref-compared effect, the same dual-trigger
// shape AtlasLensControl's own lensOpenRequest watcher already
// establishes.
export function useAtlasMinimapToggle(): { visible: boolean; toggle: () => void } {
  const [visible, setVisible] = useState(readStored)
  const toggleRequest = useUISignalStore((s) => s.atlasMinimapToggleRequest)
  const lastToggleRequest = useRef(toggleRequest)

  const toggle = () => {
    setVisible((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }

  useEffect(() => {
    if (toggleRequest === lastToggleRequest.current) return
    lastToggleRequest.current = toggleRequest
    toggle()
  }, [toggleRequest])

  return { visible, toggle }
}
