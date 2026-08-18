import { create } from 'zustand'

// Cross-bounded-context UI signals (goal 0071, contextual shortcut
// discoverability): shared/commands.ts's command `run` callbacks can't
// import atlas/AtlasView.tsx, configure/Configure*.tsx, or
// app/App.tsx directly (dependency-cruiser's shared-is-a-leaf rule,
// .claude/rules/frontend.md) -- same store-field-beats-a-callback-chain
// shape shared/store.ts's own atlasUpRequest/canvasCommandRequest
// already established. A second store file, not more fields on
// shared/store.ts's useAppStore, purely to stay under CLAUDE.md's
// 500-line-per-file convention -- same reasoning
// shared/configureEntityStore.ts's own header already documents.
interface UISignalState {
  // atlas.jump (⌘K on the atlas surface): a monotonic counter --
  // AtlasView watches it via a ref-compared effect (the same "n ticked
  // forward" pattern atlasUpRequest already uses in shared/store.ts)
  // and opens AtlasJumpDialog, which is now purely controlled (no
  // window capture-phase listener of its own).
  atlasJumpRequest: number
  requestAtlasJump: () => void
  // atlas.matrix / atlas.coverage: same counter shape, opening
  // AtlasView's own local matrixOpen/coverageOpen dialog state.
  atlasMatrixRequest: number
  requestAtlasMatrixOpen: () => void
  atlasCoverageRequest: number
  requestAtlasCoverageOpen: () => void
  // The bare-?/⌘? shortcuts-help overlay: shared by App.tsx's own `?`
  // window listener, the help.shortcuts command, and the dialog's own
  // "Rebind in Settings" footer link (which closes it on navigation).
  helpOpen: boolean
  openHelp: () => void
  closeHelp: () => void
  // Per-Configure-tab create commands (configure.new.<tab>): `tab`
  // names which inventory page's create flow to open. Set-then-consume
  // (shared/store.ts's own canvasCommandRequest/consumeCanvasCommandRequest
  // shape), NOT a monotonic counter -- ConfigureView remounts its
  // entire tab tree on a tab switch (App.tsx's `key={view.tab}`), so
  // the consuming tab's own effect can run on a FRESH mount where the
  // request was already set before it existed; a counter-vs-last-seen-
  // ref comparison (atlasUpRequest's own shape) would silently miss
  // exactly that case, since the ref's initial value would already
  // equal the fired counter. Consuming (null-ing) it back out
  // immediately after acting is what makes a later, unrelated
  // navigation back to the same tab never replay a stale request.
  configureCreateRequest: string | null
  requestConfigureCreate: (tab: string) => void
  consumeConfigureCreate: () => void
  // review.rules (goal 0078): a monotonic counter, same shape as
  // atlasJumpRequest -- legal because the command is surface-scoped to
  // 'review' (shared/commands.ts), so ReviewView is always already
  // mounted by the time this fires and its own ref-compared effect
  // catches every tick, unlike configureCreateRequest's remount case
  // above.
  reviewRulesRequest: number
  requestReviewRules: () => void
  // atlas.create.card / atlas.create.note / atlas.create.area (goal
  // 0081 slices A1/A2): the bare C/N/A keys can't dispatch through the
  // normal command registry (comboFromEvent requires Cmd/Ctrl by
  // design, shared/keybinding.ts) -- a dedicated bare-key listener
  // (app/useKeymapDispatch.ts, the same shape its own bare-`?`
  // listener already uses) calls each command's run(), which sets this
  // signal. Token-carrying (not a bare counter) since AtlasBoard's own
  // watcher needs to know WHICH tool to arm, not just that a change
  // happened.
  atlasArmToolRequest: { tool: 'card' | 'note' | 'area'; token: number } | null
  requestAtlasArmTool: (tool: 'card' | 'note' | 'area') => void
  // atlas.undoDelete (⌘Z while the quick-delete undo toast lives, goal
  // 0093): the real keydown handling is a dedicated
  // app/useKeymapDispatch.ts listener (⌘Z is the native text-undo
  // combo too, so the generic dispatchCommandForEvent's unconditional
  // preventDefault-on-match can't gate it) -- that listener checks
  // atlasUndoDeletePending itself before bumping this counter, which
  // AtlasView's own toast hook watches the same ref-compared way
  // atlasJumpRequest is watched above. atlasUndoDeletePending is kept
  // in sync by that same hook so the listener never has to reach into
  // atlas/ view state directly.
  atlasUndoDeletePending: boolean
  setAtlasUndoDeletePending: (pending: boolean) => void
  atlasUndoDeleteRequest: number
  requestAtlasUndoDelete: () => void
  // The Atlas toolbar/board actions promoted into the command registry
  // (shared/atlasBoardCommands.ts): same monotonic-counter shape as
  // atlasMatrixRequest above -- each consuming component watches its
  // own field via a ref-compared effect and runs the action a click
  // already runs, so a command dispatched from the palette/keyboard
  // does exactly what the toolbar button does.
  atlasArrangeRequest: number
  requestAtlasArrange: () => void
  atlasImportRequest: number
  requestAtlasImport: () => void
  atlasExportRequest: number
  requestAtlasExport: () => void
  atlasAddFromFolderRequest: number
  requestAtlasAddFromFolder: () => void
  atlasShareCopyContextRequest: number
  requestAtlasShareCopyContext: () => void
  atlasShareCopyLinksRequest: number
  requestAtlasShareCopyLinks: () => void
  // The switcher absorbs Lens (ADR-0041): same signal shape, renamed to
  // match the toolbar control it now opens.
  atlasPerspectiveSwitcherOpenRequest: number
  requestAtlasPerspectiveSwitcherOpen: () => void
  atlasSelectAllRequest: number
  requestAtlasSelectAll: () => void
  // atlas.minimap.toggle (goal 0106 slice B): same monotonic-counter
  // shape as atlasLensOpenRequest -- the board's own
  // useAtlasMinimapToggle hook watches it via a ref-compared effect and
  // flips the SAME localStorage-backed toggle its control-strip button
  // flips directly.
  atlasMinimapToggleRequest: number
  requestAtlasMinimapToggle: () => void
}

export const useUISignalStore = create<UISignalState>()((set) => ({
  atlasJumpRequest: 0,
  requestAtlasJump: () => set((s) => ({ atlasJumpRequest: s.atlasJumpRequest + 1 })),
  atlasMatrixRequest: 0,
  requestAtlasMatrixOpen: () => set((s) => ({ atlasMatrixRequest: s.atlasMatrixRequest + 1 })),
  atlasCoverageRequest: 0,
  requestAtlasCoverageOpen: () => set((s) => ({ atlasCoverageRequest: s.atlasCoverageRequest + 1 })),
  helpOpen: false,
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),
  configureCreateRequest: null,
  requestConfigureCreate: (tab) => set({ configureCreateRequest: tab }),
  consumeConfigureCreate: () => set({ configureCreateRequest: null }),
  reviewRulesRequest: 0,
  requestReviewRules: () => set((s) => ({ reviewRulesRequest: s.reviewRulesRequest + 1 })),
  atlasArmToolRequest: null,
  requestAtlasArmTool: (tool) => set((s) => ({ atlasArmToolRequest: { tool, token: (s.atlasArmToolRequest?.token ?? 0) + 1 } })),
  atlasUndoDeletePending: false,
  setAtlasUndoDeletePending: (pending) => set({ atlasUndoDeletePending: pending }),
  atlasUndoDeleteRequest: 0,
  requestAtlasUndoDelete: () => set((s) => ({ atlasUndoDeleteRequest: s.atlasUndoDeleteRequest + 1 })),
  atlasArrangeRequest: 0,
  requestAtlasArrange: () => set((s) => ({ atlasArrangeRequest: s.atlasArrangeRequest + 1 })),
  atlasImportRequest: 0,
  requestAtlasImport: () => set((s) => ({ atlasImportRequest: s.atlasImportRequest + 1 })),
  atlasExportRequest: 0,
  requestAtlasExport: () => set((s) => ({ atlasExportRequest: s.atlasExportRequest + 1 })),
  atlasAddFromFolderRequest: 0,
  requestAtlasAddFromFolder: () => set((s) => ({ atlasAddFromFolderRequest: s.atlasAddFromFolderRequest + 1 })),
  atlasShareCopyContextRequest: 0,
  requestAtlasShareCopyContext: () => set((s) => ({ atlasShareCopyContextRequest: s.atlasShareCopyContextRequest + 1 })),
  atlasShareCopyLinksRequest: 0,
  requestAtlasShareCopyLinks: () => set((s) => ({ atlasShareCopyLinksRequest: s.atlasShareCopyLinksRequest + 1 })),
  atlasPerspectiveSwitcherOpenRequest: 0,
  requestAtlasPerspectiveSwitcherOpen: () => set((s) => ({ atlasPerspectiveSwitcherOpenRequest: s.atlasPerspectiveSwitcherOpenRequest + 1 })),
  atlasSelectAllRequest: 0,
  requestAtlasSelectAll: () => set((s) => ({ atlasSelectAllRequest: s.atlasSelectAllRequest + 1 })),
  atlasMinimapToggleRequest: 0,
  requestAtlasMinimapToggle: () => set((s) => ({ atlasMinimapToggleRequest: s.atlasMinimapToggleRequest + 1 })),
}))
