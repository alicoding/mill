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
