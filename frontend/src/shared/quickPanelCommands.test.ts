import { describe, expect, it } from 'vitest'
import { QUICK_PANEL_RICH_ROW_ORDER, quickPanelRowIds } from './quickPanelCommands'
import { UpdateState } from './bindings'
import { useUpdateNoticeStore } from './updateNoticeStore'

// goal 0222 S2: the Quick Panel's action rows derive from the command
// registry (shared/commands.ts's `quickPanel: true` flag) instead of a
// hand-curated list -- this proves the row-membership/ordering logic
// itself, independently of app/quickPanelActionEntries.tsx's own
// presentation (which needs Primer/React and stays out of a plain
// Vitest run, per testing.md's "components are proven in e2e" layering).
describe('quickPanelRowIds (goal 0222 S2)', () => {
  it('always includes the bespoke rows, in their fixed order, with the update pipeline idle', () => {
    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateIdle)
    const ids = quickPanelRowIds()
    expect(ids.slice(0, QUICK_PANEL_RICH_ROW_ORDER.length)).toEqual(QUICK_PANEL_RICH_ROW_ORDER)
  })

  it('update.check has no enabled() -- its generic-fallback id is always present', () => {
    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateIdle)
    expect(quickPanelRowIds()).toContain('update.check')
  })

  it('update.downloadAndInstall appears only once its state door reports Available', () => {
    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateIdle)
    expect(quickPanelRowIds()).not.toContain('update.downloadAndInstall')

    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateAvailable)
    const ids = quickPanelRowIds()
    expect(ids).toContain('update.downloadAndInstall')
    expect(ids).not.toContain('update.relaunch')

    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateIdle)
  })

  it('update.relaunch appears only once its state door reports Ready, exclusively of downloadAndInstall', () => {
    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateReady)
    const ids = quickPanelRowIds()
    expect(ids).toContain('update.relaunch')
    expect(ids).not.toContain('update.downloadAndInstall')

    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateIdle)
  })

  it('a command that never opted in (quickPanel unset) never appears, regardless of its own enabled()', () => {
    expect(quickPanelRowIds()).not.toContain('tab.close')
  })
})
