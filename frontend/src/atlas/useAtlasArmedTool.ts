import { useCallback, useState } from 'react'
import type { AtlasToolID } from './atlasTools'

// The ONE state field behind every canvas tool's own armed indicator
// (goal 0238, the 0215 tool-contract seam's own arming half). Before
// this hook existed, three call sites each held their own independent
// armed/open boolean -- useAtlasCreation.ts's own `arm` (card/note/
// area/pencil/eraser/laser/shape), useTablePickerSignal.ts's `open`/
// `pendingSize` (table), useAtlasImagePopoverSignal.ts's `open`
// (image) -- so arming one never disarmed another: pencil could stay
// armed while opening the table picker also showed armed, and a
// canvas click could fire BOTH tools' own placement logic. Every one
// of those three now reads/writes THIS field instead of its own:
// arm() always REPLACES whatever was armed, so exclusivity holds by
// construction for a tool descriptor added to the registry tomorrow,
// never by a per-caller sync patch that the next tool has to remember
// to add too.
export interface AtlasArmedToolState {
  armedToolId: AtlasToolID | null
  // Only meaningful together with armedToolId (goal 0199 part D) -- a
  // stale `locked` from a since-disarmed tool must never apply to
  // whatever is armed now, so this is read only alongside armedToolId,
  // never independently.
  locked: boolean
  // arm -- assigns fresh (never locked). The one door every tray
  // click, bare-key arm, table-size-picker open, and image-popover
  // open funnels through; whichever tool held armedToolId before is
  // implicitly disarmed by the assignment itself.
  arm: (tool: AtlasToolID) => void
  disarm: () => void
  // toggle -- goal 0199's click-to-lock convention: re-clicking the
  // ALREADY-armed tool locks it first (when lockable) and disarms on
  // a second re-click; a non-lockable tool disarms on the very first
  // re-click. Reads and writes atomically via the functional setState
  // form so rapid clicks can never race against a stale `cur`.
  toggle: (tool: AtlasToolID, lockable: boolean) => void
}

export function useAtlasArmedTool(): AtlasArmedToolState {
  const [state, setState] = useState<{ tool: AtlasToolID; locked: boolean } | null>(null)
  const arm = useCallback((tool: AtlasToolID) => setState({ tool, locked: false }), [])
  const disarm = useCallback(() => setState(null), [])
  const toggle = useCallback((tool: AtlasToolID, lockable: boolean) => {
    setState((cur) => {
      if (!cur || cur.tool !== tool) return { tool, locked: false }
      if (lockable) return cur.locked ? null : { tool, locked: true }
      return null
    })
  }, [])
  return { armedToolId: state?.tool ?? null, locked: state?.locked ?? false, arm, disarm, toggle }
}
