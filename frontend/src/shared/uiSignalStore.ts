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
}))
