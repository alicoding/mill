// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '../shared/store'
import type { AtlasBoardView } from '../shared/viewKinds'

// The projection-pane view state (goal 0355 S2) -- one stored field on
// the persisted atlas View, exercised at the store layer the hook reads
// and writes (the hook itself is the thin selector/action pair over
// exactly these calls; jsdom supplies the localStorage persist runs
// through).
describe('atlas board-view state (goal 0355 S2)', () => {
  beforeEach(() => {
    useAppStore.getState().setView({ kind: 'home' })
  })

  // The exact derivation useAtlasProjectionViews runs.
  const activeView = (): AtlasBoardView => {
    const v = useAppStore.getState().view
    return v.kind === 'atlas' ? (v.boardView ?? 'board') : 'board'
  }

  it('the board is the view when no pane was ever picked', () => {
    useAppStore.getState().setView({ kind: 'atlas' })
    expect(activeView()).toBe('board')
  })

  it('switching panes writes the view and switching back lands on the board', () => {
    useAppStore.getState().setView({ kind: 'atlas' })
    useAppStore.getState().setAtlasBoardView('matrix')
    expect(activeView()).toBe('matrix')
    useAppStore.getState().setAtlasBoardView('coverage')
    // One field IS the mutual exclusion: two panes can never be active.
    expect(activeView()).toBe('coverage')
    useAppStore.getState().setAtlasBoardView('board')
    expect(activeView()).toBe('board')
  })

  it('the write never clobbers a card deep link already stored on the view', () => {
    useAppStore.getState().setView({ kind: 'atlas', cardID: 'card-1' })
    useAppStore.getState().setAtlasBoardView('roadmap')
    const v = useAppStore.getState().view
    expect(v.kind === 'atlas' && v.cardID).toBe('card-1')
    expect(activeView()).toBe('roadmap')
  })

  it('the write is a no-op while Atlas is not the current view', () => {
    useAppStore.getState().setAtlasBoardView('matrix')
    expect(useAppStore.getState().view.kind).toBe('home')
  })

  it('the view survives a persisted-store round trip (reload)', async () => {
    useAppStore.getState().setView({ kind: 'atlas' })
    useAppStore.getState().setAtlasBoardView('list')
    await useAppStore.persist.rehydrate()
    expect(activeView()).toBe('list')
  })
})
