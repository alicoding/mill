import { create } from 'zustand'
import type { AtlasArmRequestTool } from './atlasToolIdentity'

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
  // atlas.matrix / atlas.coverage / atlas.roadmap: same counter shape,
  // opening AtlasView's own local matrixOpen/coverageOpen/roadmapOpen
  // dialog state (useAtlasProjectionViews).
  atlasMatrixRequest: number
  requestAtlasMatrixOpen: () => void
  atlasCoverageRequest: number
  requestAtlasCoverageOpen: () => void
  atlasRoadmapRequest: number
  requestAtlasRoadmapOpen: () => void
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
  // configureCreatePrefill carries the one value a create flow can be
  // opened WITH -- the request form's "Add one" fills the host of the
  // request it was clicked from. A separate field rather than a
  // payload on configureCreateRequest so a page that has no prefill
  // reads the signal exactly as before. Cleared by the same consume.
  configureCreatePrefill: string | null
  requestConfigureCreateWith: (tab: string, prefill: string) => void
  // configureEditRequest (goal 0312): "open THIS entity's editor" --
  // the reference field's Open in Configure jump; the tab's page
  // consumes it the same set-then-consume way as the create signal.
  configureEditRequest: { tab: string; id: string } | null
  requestConfigureEdit: (tab: string, id: string) => void
  consumeConfigureEdit: () => void
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
  atlasArmToolRequest: { tool: AtlasArmRequestTool; token: number } | null
  requestAtlasArmTool: (tool: AtlasArmRequestTool) => void
  // The tray's table tool (goal 0139) -- opens the size picker.
  atlasTablePickerRequest: number
  requestAtlasTablePicker: () => void
  // Rename a table board object (goal 0273): what the context menu's
  // Rename item raises. Token-carrying rather than a bare counter --
  // every table on the board watches this one field, so the request
  // must name WHICH object's own title row enters edit.
  atlasTableRenameRequest: { id: string; seq: number } | null
  requestAtlasTableRename: (objectID: string) => void
  // The tray's image tool (goal 0169 slice 2, the paste-or-drop
  // interaction) -- opens its own path/paste popover. A counter, not a
  // per-tool payload, since only one popover-style tool exists so far;
  // a second one reuses this same signal rather than minting its own.
  atlasImagePopoverRequest: number
  requestAtlasImagePopover: () => void
  // atlas.undo/atlas.redo (⌘Z/⇧⌘Z, goal 0219 S2, ADR-0044): generalize
  // goal 0093's own dedicated listener from "restore the last delete"
  // to "pop the actor-scoped undo journal" -- app/useKeymapDispatch.ts
  // still owns the real keydown handling (⌘Z collides with native
  // text-undo, so a normal dispatchCommandForEvent match can't gate
  // it), guarded by atlasUndoAvailable/atlasRedoAvailable instead of
  // the old toast-only atlasUndoDeletePending. atlas/useAtlasUndoJournal
  // keeps those two flags in sync (polls AtlasService.UndoState() on
  // every 'atlas' dataevent) and watches the two request counters below
  // the same ref-compared way atlasJumpRequest is watched.
  atlasUndoAvailable: boolean
  atlasRedoAvailable: boolean
  setAtlasUndoRedoAvailable: (state: { hasUndo: boolean; hasRedo: boolean }) => void
  atlasUndoRequest: number
  requestAtlasUndo: () => void
  atlasRedoRequest: number
  requestAtlasRedo: () => void
  // atlasUndoAppliedTick bumps after EVERY successful Undo()/Redo()
  // apply, regardless of trigger (keyboard, palette, or the 0093 delete
  // toast's own button) -- the toast watches this to dismiss itself
  // when ⌘Z resolves the exact delete it's showing, without owning the
  // apply call itself.
  atlasUndoAppliedTick: number
  bumpAtlasUndoApplied: () => void
  // The Atlas toolbar/board actions promoted into the command registry
  // (shared/atlasBoardCommands.ts): same monotonic-counter shape as
  // atlasMatrixRequest above -- each consuming component watches its
  // own field via a ref-compared effect and runs the action a click
  // already runs, so a command dispatched from the palette/keyboard
  // does exactly what the toolbar button does.
  atlasArrangeRequest: number
  requestAtlasArrange: () => void
  // atlas.contents.open (docs/goals/0279): opens the board's Contents dialog.
  atlasContentsRequest: number
  requestAtlasContents: () => void
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
  // The AI companion panel (goal 0101 slice 1): a plain boolean, not a
  // counter -- AtlasToolbar's button and CompanionPanel's own Escape/
  // close controls all just set it, unlike the fire-once request
  // signals above which need a monotonic tick to notice a repeat.
  companionOpen: boolean
  toggleCompanion: () => void
  closeCompanion: () => void
  // atlas.card.exportAs (goal 0133 slice E1): same monotonic-counter
  // shape as the rest of this file -- AtlasCardOverlay watches it
  // (mounted only while a card page is actually open) and fires the
  // identical Export-as choice its own kebab menu item would.
  atlasCardExportAsRequest: number
  requestAtlasCardExportAs: () => void
  // update.whatsNew (goal 0220 S2): same plain-boolean shape as
  // helpOpen -- app/WhatsNewDialog.tsx renders off it, opened by the
  // Settings link and the pill's secondary link, both via the command
  // registry rather than a local dialog-open prop each would otherwise
  // need threading down.
  whatsNewOpen: boolean
  openWhatsNew: () => void
  closeWhatsNew: () => void
  // clipboard.history.open (goal 0234): same plain-boolean shape as
  // whatsNewOpen above -- app/ClipboardHistoryDialog.tsx renders off it.
  clipboardHistoryOpen: boolean
  openClipboardHistory: () => void
  closeClipboardHistory: () => void
  // docs.search (goal 0235 S2): same plain-boolean shape --
  // app/DocsSearchDialog.tsx renders off it, reachable from any view
  // (not scoped to the Docs surface itself).
  docsSearchOpen: boolean
  openDocsSearch: () => void
  closeDocsSearch: () => void
  // codingLoop.run (docs/goals/0240 S1): same plain-boolean shape --
  // app/CodingLoopDialog.tsx renders off it in the main window. Quick
  // Panel's own row uses its own local door state instead (a separate
  // WKWebView has its own store instance), never this signal.
  codingLoopOpen: boolean
  openCodingLoop: () => void
  closeCodingLoop: () => void
  // The leave sheet (goal 0295 S2b, app/UnsavedChangesDialog.tsx):
  // set by the quit / restart / close handshake
  // (app/useBeforeQuitFlush.ts) when explicit save mode holds unsaved
  // edits; carries WHY the app is leaving so the sheet's title can say
  // so. Cleared by the sheet's own answer.
  unsavedLeave: 'quit' | 'restart' | 'close' | null
  requestUnsavedLeave: (reason: 'quit' | 'restart' | 'close') => void
  clearUnsavedLeave: () => void
}

export const useUISignalStore = create<UISignalState>()((set) => ({
  atlasJumpRequest: 0,
  requestAtlasJump: () => set((s) => ({ atlasJumpRequest: s.atlasJumpRequest + 1 })),
  atlasMatrixRequest: 0,
  requestAtlasMatrixOpen: () => set((s) => ({ atlasMatrixRequest: s.atlasMatrixRequest + 1 })),
  atlasCoverageRequest: 0,
  requestAtlasCoverageOpen: () => set((s) => ({ atlasCoverageRequest: s.atlasCoverageRequest + 1 })),
  atlasRoadmapRequest: 0,
  requestAtlasRoadmapOpen: () => set((s) => ({ atlasRoadmapRequest: s.atlasRoadmapRequest + 1 })),
  helpOpen: false,
  openHelp: () => set({ helpOpen: true }),
  closeHelp: () => set({ helpOpen: false }),
  configureCreateRequest: null,
  configureCreatePrefill: null,
  requestConfigureCreate: (tab) => set({ configureCreateRequest: tab, configureCreatePrefill: null }),
  requestConfigureCreateWith: (tab, prefill) => set({ configureCreateRequest: tab, configureCreatePrefill: prefill }),
  consumeConfigureCreate: () => set({ configureCreateRequest: null, configureCreatePrefill: null }),
  configureEditRequest: null,
  requestConfigureEdit: (tab, id) => set({ configureEditRequest: { tab, id } }),
  consumeConfigureEdit: () => set({ configureEditRequest: null }),
  reviewRulesRequest: 0,
  requestReviewRules: () => set((s) => ({ reviewRulesRequest: s.reviewRulesRequest + 1 })),
  atlasArmToolRequest: null,
  requestAtlasArmTool: (tool) => set((s) => ({ atlasArmToolRequest: { tool, token: (s.atlasArmToolRequest?.token ?? 0) + 1 } })),
  atlasTablePickerRequest: 0,
  requestAtlasTablePicker: () => set((s) => ({ atlasTablePickerRequest: s.atlasTablePickerRequest + 1 })),
  atlasTableRenameRequest: null,
  requestAtlasTableRename: (objectID) => set((s) => ({ atlasTableRenameRequest: { id: objectID, seq: (s.atlasTableRenameRequest?.seq ?? 0) + 1 } })),
  atlasImagePopoverRequest: 0,
  requestAtlasImagePopover: () => set((s) => ({ atlasImagePopoverRequest: s.atlasImagePopoverRequest + 1 })),
  atlasUndoAvailable: false,
  atlasRedoAvailable: false,
  setAtlasUndoRedoAvailable: ({ hasUndo, hasRedo }) => set({ atlasUndoAvailable: hasUndo, atlasRedoAvailable: hasRedo }),
  atlasUndoRequest: 0,
  requestAtlasUndo: () => set((s) => ({ atlasUndoRequest: s.atlasUndoRequest + 1 })),
  atlasRedoRequest: 0,
  requestAtlasRedo: () => set((s) => ({ atlasRedoRequest: s.atlasRedoRequest + 1 })),
  atlasUndoAppliedTick: 0,
  bumpAtlasUndoApplied: () => set((s) => ({ atlasUndoAppliedTick: s.atlasUndoAppliedTick + 1 })),
  atlasArrangeRequest: 0,
  requestAtlasArrange: () => set((s) => ({ atlasArrangeRequest: s.atlasArrangeRequest + 1 })),
  atlasContentsRequest: 0,
  requestAtlasContents: () => set((s) => ({ atlasContentsRequest: s.atlasContentsRequest + 1 })),
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
  companionOpen: false,
  toggleCompanion: () => set((s) => ({ companionOpen: !s.companionOpen })),
  closeCompanion: () => set({ companionOpen: false }),
  atlasCardExportAsRequest: 0,
  requestAtlasCardExportAs: () => set((s) => ({ atlasCardExportAsRequest: s.atlasCardExportAsRequest + 1 })),
  whatsNewOpen: false,
  openWhatsNew: () => set({ whatsNewOpen: true }),
  closeWhatsNew: () => set({ whatsNewOpen: false }),
  clipboardHistoryOpen: false,
  openClipboardHistory: () => set({ clipboardHistoryOpen: true }),
  closeClipboardHistory: () => set({ clipboardHistoryOpen: false }),
  docsSearchOpen: false,
  openDocsSearch: () => set({ docsSearchOpen: true }),
  closeDocsSearch: () => set({ docsSearchOpen: false }),
  codingLoopOpen: false,
  openCodingLoop: () => set({ codingLoopOpen: true }),
  closeCodingLoop: () => set({ codingLoopOpen: false }),
  unsavedLeave: null,
  requestUnsavedLeave: (reason) => set({ unsavedLeave: reason }),
  clearUnsavedLeave: () => set({ unsavedLeave: null }),
}))
