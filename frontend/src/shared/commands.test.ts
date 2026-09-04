import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMANDS, dispatchCommandForEvent, findCommand, runCommand, surfacesIntersect } from './commands'
import type { Command } from './commands'
import { useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'
import { UpdateState } from './bindings'
import { useUpdateNoticeStore } from './updateNoticeStore'
import { useVaultStatusStore } from './vaultStatusStore'
import { useNoticeStore } from './noticeStore'

// docs/goals/BACKLOG.md Standing #6 (⌘?/⌘/ palette aliases): a
// Command's optional extraBindings (shared/commands.ts) must dispatch
// the SAME command as its primary defaultBinding, and an override on
// the primary must never affect extras (they're deliberately not
// override-checked -- see Command.extraBindings' own doc comment).
describe('dispatchCommandForEvent with extraBindings', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('palette.open carries only its ⌘/ extra binding -- ⌘⇧/ moved to help.shortcuts (goal 0071)', () => {
    const command = findCommand('palette.open')
    expect(command?.extraBindings).toEqual([{ mods: ['cmd'], key: '/' }])
  })

  it('help.shortcuts carries the ⌘⇧/ (⌘?) alias, unbound by default', () => {
    const command = findCommand('help.shortcuts')
    expect(command?.defaultBinding).toBeNull()
    expect(command?.extraBindings).toEqual([{ mods: ['cmd', 'shift'], key: '/' }])
  })

  it('Cmd+K (the primary default) still opens the palette', () => {
    const ran = dispatchCommandForEvent(event({ code: 'KeyK', metaKey: true }), {})
    expect(ran).toBe(true)
  })

  it('Cmd+/ (an extra binding) also dispatches palette.open', () => {
    const ran = dispatchCommandForEvent(event({ code: 'Slash', metaKey: true }), {})
    expect(ran).toBe(true)
  })

  it('Cmd+Shift+/ (the ⌘? glyph) now dispatches help.shortcuts, not the palette', () => {
    useAppStore.getState().closePalette()
    useUISignalStore.getState().closeHelp()
    const ran = dispatchCommandForEvent(event({ code: 'Slash', metaKey: true, shiftKey: true }), {})
    expect(ran).toBe(true)
    expect(useUISignalStore.getState().helpOpen).toBe(true)
    expect(useAppStore.getState().paletteOpen).toBe(false)
    useUISignalStore.getState().closeHelp()
  })

  it('Ctrl+/ is not bound to anything -- extras match on their exact mods, not just the "/" key', () => {
    const ran = dispatchCommandForEvent(event({ code: 'Slash', ctrlKey: true }), {})
    expect(ran).toBe(false)
  })

  it('an override on the primary binding does not disable the extras', () => {
    // palette.open rebound to Cmd+P in Settings -- Cmd+K itself no
    // longer runs it, but the two extras (never override-checked, per
    // Command.extraBindings' own doc comment) still do.
    const overrides = { 'palette.open': { mods: ['cmd'], key: 'P' } }
    expect(dispatchCommandForEvent(event({ code: 'KeyK', metaKey: true }), overrides)).toBe(false)
    expect(dispatchCommandForEvent(event({ code: 'Slash', metaKey: true }), overrides)).toBe(true)
    expect(dispatchCommandForEvent(event({ code: 'KeyP', metaKey: true }), overrides)).toBe(true)
  })

  it('tab.next/tab.prev carry the browser-convention bracket aliases', () => {
    expect(findCommand('tab.next')?.extraBindings).toEqual([{ mods: ['cmd', 'shift'], key: ']' }])
    expect(findCommand('tab.prev')?.extraBindings).toEqual([{ mods: ['cmd', 'shift'], key: '[' }])
  })

  it('Cmd+Shift+] and Cmd+Shift+[ dispatch (tab cycling via the aliases)', () => {
    expect(dispatchCommandForEvent(event({ code: 'BracketRight', metaKey: true, shiftKey: true }), {})).toBe(true)
    expect(dispatchCommandForEvent(event({ code: 'BracketLeft', metaKey: true, shiftKey: true }), {})).toBe(true)
  })

  it('bare Cmd+] stays unbound -- the aliases require Shift, exact-mods matching', () => {
    expect(dispatchCommandForEvent(event({ code: 'BracketRight', metaKey: true }), {})).toBe(false)
    expect(dispatchCommandForEvent(event({ code: 'BracketLeft', metaKey: true }), {})).toBe(false)
  })

  it('a command with no extraBindings is unaffected (backward-compatible)', () => {
    // tab.close has no extras -- only its own Cmd+W default dispatches
    // it, same behavior as before this feature existed. Needs an open
    // work tab now that tab.close carries a real enabled() (goal 0222
    // S1) -- previously it ran unconditionally regardless of state.
    useAppStore.getState().openWorkTab({ kind: 'workflow-new' })
    expect(dispatchCommandForEvent(event({ code: 'KeyW', metaKey: true }), {})).toBe(true)
    expect(dispatchCommandForEvent(event({ code: 'Slash', metaKey: true, ctrlKey: true }), {})).toBe(false)
    useAppStore.getState().closeAllWorkTabs()
  })
})

// Goal 0071's ⌘K reconciliation: atlas.jump (surface: ['atlas']) and
// palette.open (surface-less) share the same ⌘K default -- legal only
// because dispatchCommandForEvent tries every surface-scoped command
// matching the active view BEFORE any surface-less global.
describe('dispatchCommandForEvent surface precedence (goal 0071)', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('⌘K on the atlas surface dispatches atlas.jump, not palette.open', () => {
    useAppStore.getState().setView({ kind: 'atlas' })
    useAppStore.getState().closePalette()
    const before = useUISignalStore.getState().atlasJumpRequest
    const ran = dispatchCommandForEvent(event({ code: 'KeyK', metaKey: true }), {})
    expect(ran).toBe(true)
    expect(useUISignalStore.getState().atlasJumpRequest).toBe(before + 1)
    expect(useAppStore.getState().paletteOpen).toBe(false)
  })

  it('⌘K on a non-atlas surface dispatches palette.open, not atlas.jump', () => {
    useAppStore.getState().setView({ kind: 'composition' })
    useAppStore.getState().closePalette()
    const before = useUISignalStore.getState().atlasJumpRequest
    const ran = dispatchCommandForEvent(event({ code: 'KeyK', metaKey: true }), {})
    expect(ran).toBe(true)
    expect(useUISignalStore.getState().atlasJumpRequest).toBe(before)
    expect(useAppStore.getState().paletteOpen).toBe(true)
    useAppStore.getState().closePalette()
  })
})

// Goal 0071's Settings rebind conflict rule: a same-combo pair is only
// a real conflict when their surface sets intersect.
describe('surfacesIntersect', () => {
  it('two surface-less (global) commands intersect', () => {
    expect(surfacesIntersect(undefined, undefined)).toBe(true)
  })

  it('a surface-less command intersects every specific surface', () => {
    expect(surfacesIntersect(undefined, ['atlas'])).toBe(true)
    expect(surfacesIntersect(['atlas'], undefined)).toBe(true)
  })

  it('two commands scoped to the SAME surface intersect', () => {
    expect(surfacesIntersect(['atlas'], ['atlas'])).toBe(true)
  })

  it('two commands scoped to DISJOINT surfaces do not intersect -- sharing a combo between them is legal', () => {
    expect(surfacesIntersect(['atlas'], ['composition'])).toBe(false)
  })

  it('overlapping multi-surface lists intersect on the shared surface', () => {
    expect(surfacesIntersect(['atlas', 'composition'], ['composition', 'configure'])).toBe(true)
  })
})

// shared/atlasBoardCommands.ts's hintOnly/paletteHidden commands: their
// real dispatch lives in dedicated listeners elsewhere, never the
// generic dispatcher below (Command.hintOnly's own doc comment).
describe('hintOnly / paletteHidden commands', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  it('atlas.selectAll is hintOnly with its own ⌘A default binding', () => {
    const command = findCommand('atlas.selectAll')
    expect(command?.hintOnly).toBe(true)
    expect(command?.defaultBinding).toEqual({ mods: ['cmd'], key: 'A' })
  })

  it('atlas.selectAll does not carry paletteHidden', () => {
    expect(findCommand('atlas.selectAll')?.paletteHidden).toBeFalsy()
  })

  it('generic dispatch never runs atlas.selectAll, even on the atlas surface', () => {
    useAppStore.getState().setView({ kind: 'atlas' })
    const ran = dispatchCommandForEvent(event({ code: 'KeyA', metaKey: true }), {})
    expect(ran).toBe(false)
  })

  it('atlas.delete.selection and atlas.group.selection are both hintOnly and paletteHidden', () => {
    for (const id of ['atlas.delete.selection', 'atlas.group.selection']) {
      const command = findCommand(id)
      expect(command?.hintOnly).toBe(true)
      expect(command?.paletteHidden).toBe(true)
    }
  })
})

// The enablement predicate (goal 0222 S1): a command's `enabled` gates
// both the palette's filtering (app/CommandPalette.tsx's own
// isCommandAvailable) and dispatchCommandForEvent's keyboard dispatch --
// tested here against fake commands (the filter shape) and real
// registry commands (the actual state doors: workflow editor tabs, work
// tabs, the vault, the update notice).
describe('Command.enabled (goal 0222 S1)', () => {
  const event = (init: Partial<KeyboardEvent>) => init as KeyboardEvent

  // Mirrors CommandPalette.tsx's own isCommandAvailable exactly -- a
  // disabled command is OMITTED, not dimmed (VSCode's own convention).
  const isPaletteAvailable = (c: Pick<Command, 'paletteHidden' | 'enabled'>) => !c.paletteHidden && (!c.enabled || c.enabled())

  it('a command with no enabled predicate is always available', () => {
    expect(isPaletteAvailable({})).toBe(true)
  })

  it('a command whose enabled() returns false is excluded from the palette filter', () => {
    expect(isPaletteAvailable({ enabled: () => false })).toBe(false)
  })

  it('a command whose enabled() returns true passes the palette filter', () => {
    expect(isPaletteAvailable({ enabled: () => true })).toBe(true)
  })

  it('workflow.save is disabled with no workflow editor tab open, and dispatch no-ops -- the run() body carries no guard of its own anymore', () => {
    useAppStore.getState().setView({ kind: 'composition' })
    useAppStore.getState().closeAllWorkTabs()
    expect(findCommand('workflow.save')?.enabled?.()).toBe(false)
    expect(dispatchCommandForEvent(event({ code: 'KeyS', metaKey: true }), {})).toBe(false)
  })

  it('workflow.save/workflow.run become enabled once a workflow editor tab is open, and dispatch runs them', () => {
    useAppStore.getState().setView({ kind: 'composition' })
    useAppStore.getState().closeAllWorkTabs()
    useAppStore.getState().openWorkTab({ kind: 'workflow-new' })
    expect(findCommand('workflow.save')?.enabled?.()).toBe(true)
    expect(dispatchCommandForEvent(event({ code: 'KeyS', metaKey: true }), {})).toBe(true)
    expect(dispatchCommandForEvent(event({ code: 'Enter', metaKey: true }), {})).toBe(true)
    useAppStore.getState().closeAllWorkTabs()
  })

  it('tab.close/tab.closeOthers are disabled with no active work tab, matching the SAME truth WorkTabShell already renders off', () => {
    useAppStore.getState().closeAllWorkTabs()
    expect(findCommand('tab.close')?.enabled?.()).toBe(false)
    expect(findCommand('tab.closeOthers')?.enabled?.()).toBe(false)
    expect(dispatchCommandForEvent(event({ code: 'KeyW', metaKey: true }), {})).toBe(false)
  })

  it('secrets.lockVault/unlockVault mirror the vault-lock state door (shared/vaultStatusStore.ts) exclusively -- exactly one is ever enabled', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: true, RequireAuth: false, AuthAvailable: false })
    expect(findCommand('secrets.lockVault')?.enabled?.()).toBe(true)
    expect(findCommand('secrets.unlockVault')?.enabled?.()).toBe(false)

    useVaultStatusStore.getState().setVaultStatus({ Exists: true, Unlocked: false, RequireAuth: false, AuthAvailable: false })
    expect(findCommand('secrets.lockVault')?.enabled?.()).toBe(false)
    expect(findCommand('secrets.unlockVault')?.enabled?.()).toBe(true)
  })

  it('secrets.lockVault/unlockVault are both disabled before a vault exists at all', () => {
    useVaultStatusStore.getState().setVaultStatus({ Exists: false, Unlocked: false, RequireAuth: false, AuthAvailable: false })
    expect(findCommand('secrets.lockVault')?.enabled?.()).toBe(false)
    expect(findCommand('secrets.unlockVault')?.enabled?.()).toBe(false)
  })

  it('update.downloadAndInstall/update.relaunch mirror the update-notice state door (shared/updateNoticeStore.ts), migrated off their old inline UpdateNoticeState() re-fetch', () => {
    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateAvailable)
    expect(findCommand('update.downloadAndInstall')?.enabled?.()).toBe(true)
    expect(findCommand('update.relaunch')?.enabled?.()).toBe(false)

    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateReady)
    expect(findCommand('update.downloadAndInstall')?.enabled?.()).toBe(false)
    expect(findCommand('update.relaunch')?.enabled?.()).toBe(true)

    useUpdateNoticeStore.getState().setUpdateNoticeState(UpdateState.UpdateStateIdle)
    expect(findCommand('update.downloadAndInstall')?.enabled?.()).toBe(false)
    expect(findCommand('update.relaunch')?.enabled?.()).toBe(false)
  })

  it('workflow.publish is enabled only for a SAVED workflow editor tab (kind workflow-edit), never a not-yet-saved workflow-new one', () => {
    useAppStore.getState().setView({ kind: 'composition' })
    useAppStore.getState().closeAllWorkTabs()
    useAppStore.getState().openWorkTab({ kind: 'workflow-new' })
    expect(findCommand('workflow.publish')?.enabled?.()).toBe(false)
    useAppStore.getState().closeAllWorkTabs()
    useAppStore.getState().openWorkTab({ kind: 'workflow-edit', workflowId: 'wf-1', mode: 'edit' })
    expect(findCommand('workflow.publish')?.enabled?.()).toBe(true)
    useAppStore.getState().closeAllWorkTabs()
  })

  it('every registered command with an enabled predicate is a real function (registry sanity)', () => {
    for (const command of COMMANDS) {
      if (command.enabled) expect(typeof command.enabled).toBe('function')
    }
  })
})

// goal 0222 S2: the Quick Panel's action rows derive from the exact
// same `quickPanel: true` flag app/quickPanelActionEntries.tsx filters
// on -- this is the registry-side half of that contract (which ids
// opted in), not the row-derivation logic itself (that file's own
// quickPanelActionEntries.test.ts).
describe('Command.quickPanel opt-in (goal 0222 S2)', () => {
  it('the four rows the panel already shipped, plus the update pipeline, all opted in', () => {
    for (const id of [
      'panel.openMill', 'settings.open', 'view.review', 'panel.applyClipboard',
      'update.check', 'update.downloadAndInstall', 'update.relaunch',
    ]) {
      expect(findCommand(id)?.quickPanel).toBe(true)
    }
  })

  it('panel.openMill is Quick-Panel-only -- paletteHidden in the main window, since it would just refocus itself there', () => {
    expect(findCommand('panel.openMill')?.paletteHidden).toBe(true)
  })

  it('an ordinary command with no reason to appear in the panel stays opted out', () => {
    expect(findCommand('tab.close')?.quickPanel).toBeFalsy()
  })
})

// goal 0313: runCommand is the ONE door every invoker (palette, menu,
// keymap, notice pill, a plain button) uses instead of a bare run() --
// this pins its four outcomes (unknown id, disabled, sync success,
// rejection) against the footer notice channel it reports failure
// through.
describe('runCommand (goal 0313)', () => {
  afterEach(() => {
    useNoticeStore.setState({ notices: [] })
  })

  const withTestCommand = (command: Command, fn: () => Promise<void> | void) => {
    COMMANDS.push(command)
    return Promise.resolve(fn()).finally(() => {
      const idx = COMMANDS.indexOf(command)
      if (idx >= 0) COMMANDS.splice(idx, 1)
    })
  }

  it('an unknown id resolves false and posts no notice', async () => {
    await expect(runCommand('no.such.command')).resolves.toBe(false)
    expect(useNoticeStore.getState().notices).toEqual([])
  })

  it('a disabled command resolves false, run() never called, no notice', async () => {
    const run = vi.fn()
    await withTestCommand(
      { id: 'test.disabled', label: 'Disabled test', defaultBinding: null, enabled: () => false, run },
      async () => {
        await expect(runCommand('test.disabled')).resolves.toBe(false)
        expect(run).not.toHaveBeenCalled()
        expect(useNoticeStore.getState().notices).toEqual([])
      },
    )
  })

  it('a synchronous run() resolves true, no notice', async () => {
    const run = vi.fn()
    await withTestCommand(
      { id: 'test.sync', label: 'Sync test', defaultBinding: null, run },
      async () => {
        await expect(runCommand('test.sync')).resolves.toBe(true)
        expect(run).toHaveBeenCalledTimes(1)
        expect(useNoticeStore.getState().notices).toEqual([])
      },
    )
  })

  it('an async run() that resolves settles true, no notice', async () => {
    await withTestCommand(
      { id: 'test.asyncOk', label: 'Async ok test', defaultBinding: null, run: () => Promise.resolve() },
      async () => {
        await expect(runCommand('test.asyncOk')).resolves.toBe(true)
        expect(useNoticeStore.getState().notices).toEqual([])
      },
    )
  })

  it('a rejecting run() resolves false and posts exactly one error notice naming the label and the message', async () => {
    await withTestCommand(
      { id: 'test.fails', label: 'Fails test', defaultBinding: null, run: () => Promise.reject(new Error('boom')) },
      async () => {
        await expect(runCommand('test.fails')).resolves.toBe(false)
        const notices = useNoticeStore.getState().notices
        expect(notices).toHaveLength(1)
        expect(notices[0].level).toBe('error')
        expect(notices[0].text).toBe('Fails test: boom')
        expect(notices[0].source).toBeUndefined()
      },
    )
  })

  it('a bound-method rejection shows the failure\'s own sentence, never the Go chain (goal 0339)', async () => {
    const rejection = new Error('github: download: no release asset in test mode')
    ;(rejection as { cause?: unknown }).cause = { code: 'download-failed', message: 'The update could not be downloaded.' }
    await withTestCommand(
      { id: 'test.bound', label: 'Download the update and install', defaultBinding: null, run: () => Promise.reject(rejection) },
      async () => {
        await expect(runCommand('test.bound')).resolves.toBe(false)
        const text = useNoticeStore.getState().notices[0]?.text ?? ''
        expect(text).toBe('Download the update and install: The update could not be downloaded.')
        expect(text).not.toContain('github')
        // One separator only: the label's own, never a wrapped chain's.
        expect(text.split(': ')).toHaveLength(2)
      },
    )
  })

  it('a THROWING synchronous run() is caught the same way a rejection is', async () => {
    await withTestCommand(
      {
        id: 'test.throws',
        label: 'Throws test',
        defaultBinding: null,
        run: () => {
          throw new Error('sync boom')
        },
      },
      async () => {
        await expect(runCommand('test.throws')).resolves.toBe(false)
        expect(useNoticeStore.getState().notices[0]?.text).toBe('Throws test: sync boom')
      },
    )
  })
})
