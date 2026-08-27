import { useCallback, useEffect, useRef, useState } from 'react'
import { useUISignalStore } from '../shared/uiSignalStore'
import type { AtlasToolID } from './atlasTools'

// The tray's table size picker (goal 0139), split out of AtlasBoard.tsx
// at the 500-line convention: opened by the tool button (setOpen) or
// bare T (the atlas.create.table command's signal). Picking a size
// ARMS the tool (goal 0148): the next canvas click places the C×R
// table at that point; Escape disarms.
//
// `pickerOpen`/`pendingSize` stay local (this tool's own extra
// placement payload/UI state, no other tool has anything like it), but
// whether the tray's own table button shows armed is derived from the
// SHARED armedToolId field (useAtlasArmedTool.ts, goal 0238) rather
// than a private boolean -- arming a DIFFERENT tool (pencil, or
// Image's own popover) can no longer leave this tool's own popover/
// pending-size state stranded showing armed with nothing behind it:
// the effect below clears both the instant armedToolId stops naming
// 'table', regardless of what caused that (Escape, another tool's own
// arm() call, or this hook's own disarm()).
export function useTablePickerSignal({ armedToolId, arm, disarm }: {
  armedToolId: AtlasToolID | null
  arm: (tool: AtlasToolID) => void
  disarm: () => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pendingSize, setPendingSize] = useState<{ cols: number; rows: number } | null>(null)
  const armed = armedToolId === 'table'
  const open = armed && pickerOpen

  const request = useUISignalStore((st) => st.atlasTablePickerRequest)
  const lastRequest = useRef(request)
  useEffect(() => {
    if (request === lastRequest.current) return
    lastRequest.current = request
    setPickerOpen(true)
    arm('table')
  }, [request, arm])

  // setOpen(true) arms; setOpen(false) is a genuine cancel (the tray
  // button's own re-click, or AnchoredOverlay's click-outside) --
  // picking a size calls closePickerVisibility below instead, never
  // this, so it never fights the "stay armed through the pendingSize
  // phase" contract above.
  const setOpen = useCallback((next: boolean) => {
    if (next) { setPickerOpen(true); arm('table') } else { setPickerOpen(false); disarm() }
  }, [arm, disarm])

  // closePickerVisibility -- picking a size closes the POPOVER without
  // disarming (the tool stays armed for the click-to-place phase).
  // Called explicitly by the picker's own onPick, in the SAME
  // synchronous handler as setPendingSize, rather than folding `open`
  // into a pure derivation of pendingSize alone: AnchoredOverlay
  // restores focus to its trigger (the in-wrapper tray button) once it
  // closes, and the board's own Escape ladder
  // (useAtlasSelectionTray.ts) climbs a level whenever Escape lands
  // with focus already back inside the board wrapper and nothing
  // selected -- keeping both state changes in one commit keeps that
  // focus-restore timing identical to the picker button's own
  // re-click/outside-close paths above, which never trip the ladder.
  const closePickerVisibility = useCallback(() => setPickerOpen(false), [])

  // Teardown: once the shared field stops naming 'table' -- because
  // Escape disarmed everything, or a DIFFERENT tool's own arm() call
  // replaced it -- a previously-picked size or an open popover can
  // never linger for a placement this tool no longer owns.
  useEffect(() => {
    if (!armed) { setPickerOpen(false); setPendingSize(null) }
  }, [armed])

  return { open, setOpen, pendingSize, setPendingSize, closePickerVisibility, disarm }
}
