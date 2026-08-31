// The native OS file-drop door's own wire constants (goal 0081 slice
// A3) -- literal mirrors of atlassvc.FileDropEventName/
// FileDropContextBoard/FileDropContextCardPage (internal/services/
// atlassvc/atlasservice_filedrop.go), which main.go's window-event
// handler and this event's two frontend consumers (useAtlasNativeFileDrop.ts,
// useAtlasCardPageFileDrop.ts) all key off. Kept as their own tiny file
// (not re-exported from atlasStore.ts or bindings) so both the DOM
// data-file-drop-context attribute (AtlasBoard.tsx, AtlasCardOverlay.tsx)
// and the Events.On filter read the exact same string, never a
// hand-typed copy that could drift.
export const FILE_DROP_EVENT_NAME = 'atlas-native-file-drop'
export const FILE_DROP_CONTEXT_BOARD = 'board'
export const FILE_DROP_CONTEXT_CARD_PAGE = 'card-page'

// resolveDropContext answers WHERE a native drop landed: the payload's
// own context when the toolkit's attribute hit-test supplied one, else
// a DOM hit-test at the drop coordinates -- the file-promise receiver
// (goal 0256) delivers materialized paths plus coordinates but no
// attribute walk, so its payloads arrive with an empty context. Null
// when the point hits no declared drop target (the drop is ignored,
// same as the toolkit answering no attributes).
export function resolveDropContext(payload: { context?: string; x?: number; y?: number }): string | null {
  if (payload.context) return payload.context
  if (payload.x === undefined || payload.y === undefined) return null
  const el = document.elementFromPoint(payload.x, payload.y)
  return el?.closest('[data-file-drop-context]')?.getAttribute('data-file-drop-context') ?? null
}
