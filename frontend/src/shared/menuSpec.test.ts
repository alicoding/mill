import { describe, expect, it } from 'vitest'
import { COMMANDS } from './commands'
import { menuPlaceable, menuSpecFor } from './menuSpec'
import type { MenuEntry, MenuNode, MenuSpec } from './menuSpec'

function menu(spec: MenuSpec, label: string): MenuNode {
  const found = spec.menus.find((m) => m.label === label)
  if (!found) throw new Error(`no menu labelled ${label}`)
  return found
}

// One menu's items as labels, with '-' for a band boundary -- the same
// shape the platform renders, so a whole menu is one assertion.
function shapeOf(node: MenuNode): string[] {
  if (node.kind === 'roleMenu') return [`role:${node.role}`]
  return node.groups.flatMap((group, i) => (i === 0 ? [] : ['-']).concat(group.map(describeEntry)))
}

function describeEntry(entry: MenuEntry): string {
  if (entry.kind === 'role') return `role:${entry.role}`
  if (entry.kind === 'submenu') return `submenu:${entry.label}`
  return entry.label
}

function commandEntries(spec: MenuSpec): { id: string; label: string; accelerator: string | null; enabled: boolean }[] {
  const out: { id: string; label: string; accelerator: string | null; enabled: boolean }[] = []
  const walk = (entries: MenuEntry[]) => {
    for (const entry of entries) {
      if (entry.kind === 'command') out.push({ id: entry.id, label: entry.label, accelerator: entry.accelerator, enabled: entry.enabled })
      if (entry.kind === 'submenu') entry.groups.forEach(walk)
    }
  }
  for (const node of spec.menus) if (node.kind === 'menu') node.groups.forEach(walk)
  return out
}

function acceleratorOf(spec: MenuSpec, id: string): string | null | undefined {
  return commandEntries(spec).find((e) => e.id === id)?.accelerator
}

describe('menuSpecFor (the native menu bar as a projection of the command registry)', () => {
  const spec = menuSpecFor(COMMANDS)

  it('lays the menu bar out in the platform order, with the app-specific menus between View and Window', () => {
    expect(spec.menus.map((m) => m.label)).toEqual(['Mill', 'File', 'Edit', 'View', 'Workflow', 'Atlas', 'Window', 'Help'])
  })

  it('opens the app menu with About and closes it with Quit, Settings and Back up now each in their own band', () => {
    expect(shapeOf(menu(spec, 'Mill'))).toEqual([
      'role:about', 'Check for updates…',
      '-', 'Settings…',
      '-', 'Back up now',
      '-', 'role:services',
      '-', 'role:hide', 'role:hideOthers', 'role:showAll',
      '-', 'role:quit',
    ])
  })

  it('groups File into new, the New… submenu, close, save, export and vault bands', () => {
    expect(shapeOf(menu(spec, 'File'))).toEqual([
      'New workflow', 'New note',
      '-', 'submenu:New…',
      '-', 'Close tab', 'Close other tabs', 'Close all tabs',
      '-', 'Save',
      '-', 'Export everything', 'Export plugin audit',
      '-', 'Lock vault',
    ])
  })

  it('leaves Edit entirely to the platform', () => {
    expect(shapeOf(menu(spec, 'Edit'))).toEqual(['role:edit'])
  })

  it('puts the views, the palette and tab cycling in View, and the zoom roles last', () => {
    expect(shapeOf(menu(spec, 'View'))).toEqual([
      'Home', 'Workflows', 'Configure', 'Atlas', 'Activity', 'Review', 'Review rules', 'Secrets', 'Extensions', 'Docs',
      '-', 'Command palette',
      '-', 'Next tab', 'Previous tab',
      '-', 'Clipboard history',
      '-', 'role:resetZoom', 'role:zoomIn', 'role:zoomOut', 'role:toggleFullscreen',
    ])
  })

  it('opens Workflow with the two run entries and the mode switch, then the save band, then the canvas band', () => {
    const shape = shapeOf(menu(spec, 'Workflow'))
    expect(shape.slice(0, 7)).toEqual([
      'Run workflow', 'Run step by step', 'Run from clipboard…', 'View workflow', 'Edit workflow',
      '-', 'Save',
    ])
    expect(shape).toContain('Fit view')
  })

  it('opens Atlas with the navigation band before the board and create bands', () => {
    const shape = shapeOf(menu(spec, 'Atlas'))
    expect(shape.slice(0, 7)).toEqual([
      'Go up one level', 'Jump to a card or object', 'Undo', 'Redo',
      'Open traceability matrix', 'Open coverage', 'Open roadmap',
    ])
    expect(shape).toContain('Auto-arrange')
  })

  it('seats Quick panel and Run monitor in Window’s middle band', () => {
    expect(shapeOf(menu(spec, 'Window'))).toEqual([
      'role:minimise', 'role:zoom',
      '-', 'Quick panel', 'Run monitor',
      '-', 'role:bringAllToFront',
    ])
  })

  it('keeps the developer roles out of View and behind a Help submenu', () => {
    expect(shapeOf(menu(spec, 'View'))).not.toContain('role:reload')
    const help = menu(spec, 'Help')
    expect(shapeOf(help)).toEqual([
      'Mill help', 'Search docs', 'Keyboard shortcuts', "What's new",
      '-', 'Report an issue…', 'Open data folder',
      '-', 'submenu:Developer',
    ])
    const developer = help.kind === 'menu' ? help.groups[help.groups.length - 1][0] : undefined
    expect(developer && developer.kind === 'submenu' ? developer.groups : []).toEqual([
      [
        { kind: 'role', role: 'reload', releaseAccelerator: false },
        { kind: 'role', role: 'forceReload', releaseAccelerator: false },
        { kind: 'role', role: 'openDevTools', releaseAccelerator: false },
      ],
    ])
  })

  it('places every command that asked for a seat, and nothing else', () => {
    const placed = new Set(commandEntries(spec).map((e) => e.id))
    for (const command of COMMANDS) {
      expect(placed.has(command.id)).toBe(menuPlaceable(command))
    }
  })

  it('declines a command that needs a live focus the menu cannot supply; seats one over the ambient selection', () => {
    const placed = new Set(commandEntries(spec).map((e) => e.id))
    for (const id of ['atlas.focusNext', 'atlas.nudgeSelection']) {
      expect(placed.has(id)).toBe(false)
    }
    // The selection is ambient (goal 0346 slice B): the menu bar reads
    // it like the palette does, so a selection command has a seat.
    for (const id of ['atlas.delete.selection', 'object.rename']) {
      expect(placed.has(id)).toBe(true)
    }
  })

  it('leaves the command families with no menu home out of the bar', () => {
    const placed = new Set(commandEntries(spec).map((e) => e.id))
    for (const id of [
      // panel.applyClipboard/update.downloadAndInstall/update.relaunch
      // are palette/state-seat-only by design; secrets.unlockVault/
      // resetVault are the vault seat's OTHER states -- only the
      // anchor (secrets.lockVault) carries `menu`, the seat's actual
      // occupant comes from shared/vaultSeat.ts's seatOverride.
      'panel.applyClipboard', 'update.downloadAndInstall', 'update.relaunch',
      'secrets.unlockVault', 'secrets.resetVault',
    ]) {
      expect(placed.has(id)).toBe(false)
    }
  })

  it('appears once per seat -- Docs is both a view and the help page', () => {
    const ids = commandEntries(spec).map((e) => e.id)
    const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i)
    expect(duplicated).toEqual(['view.docs'])
  })

  it('translates a command binding into a native accelerator', () => {
    expect(acceleratorOf(spec, 'view.home')).toBe('cmdorctrl+0')
    expect(acceleratorOf(spec, 'tab.close')).toBe('cmdorctrl+w')
    expect(acceleratorOf(spec, 'tab.closeOthers')).toBe('cmdorctrl+option+w')
    expect(acceleratorOf(spec, 'workflow.run')).toBe('cmdorctrl+enter')
    expect(acceleratorOf(spec, 'tab.next')).toBe('ctrl+tab')
  })

  it('gives no accelerator to a combo two menu items would both claim', () => {
    // ⌘S is workflow.save in an editor tab and edit.save everywhere
    // else; ⌘K is the Atlas jump dialog on Atlas and the palette
    // elsewhere. The menu bar resolves a duplicate key equivalent by
    // menu order alone, which cannot express either rule -- so both
    // stay with the in-window dispatcher that can.
    expect(acceleratorOf(spec, 'workflow.save')).toBeNull()
    expect(acceleratorOf(spec, 'edit.save')).toBeNull()
    expect(acceleratorOf(spec, 'palette.open')).toBeNull()
    expect(acceleratorOf(spec, 'atlas.jump')).toBeNull()
  })

  it('gives up the platform zoom roles’ shortcuts, which are Mill’s own combos', () => {
    const view = menu(spec, 'View')
    const zoomBand = view.kind === 'menu' ? view.groups[view.groups.length - 1] : []
    expect(zoomBand).toEqual([
      { kind: 'role', role: 'resetZoom', releaseAccelerator: true },
      { kind: 'role', role: 'zoomIn', releaseAccelerator: true },
      { kind: 'role', role: 'zoomOut', releaseAccelerator: true },
      { kind: 'role', role: 'toggleFullscreen', releaseAccelerator: false },
    ])
  })

  it('gives no accelerator to a command whose keypress needs a live selection', () => {
    expect(acceleratorOf(spec, 'canvas.undo')).toBeNull()
    expect(acceleratorOf(spec, 'atlas.selectAll')).toBeNull()
  })

  it('takes a rebound command’s current combo, not the shipped default', () => {
    const rebound = menuSpecFor(COMMANDS, { overrides: { 'view.home': { mods: ['cmd', 'shift'], key: '9' } } })
    expect(acceleratorOf(rebound, 'view.home')).toBe('cmdorctrl+shift+9')
  })

  it('kills a surface-scoped item off its surface, so its shortcut cannot fire there', () => {
    const onAtlas = commandEntries(menuSpecFor(COMMANDS, { surface: 'atlas' }))
    const onHome = commandEntries(menuSpecFor(COMMANDS, { surface: 'home' }))
    expect(onAtlas.find((e) => e.id === 'atlas.up')?.enabled).toBe(true)
    expect(onHome.find((e) => e.id === 'atlas.up')?.enabled).toBe(false)
  })

  // The state-following seats (goal 0335): seatOverrides swaps which
  // command a seat's item actually fires, and its label/enabled,
  // while the seat's own band/position (declared on the anchor,
  // update.check / secrets.lockVault) never moves.
  it('swaps the update seat to whichever command the override names', () => {
    const overridden = menuSpecFor(COMMANDS, {
      seatOverrides: { 'update.check': { commandId: 'update.relaunch', label: 'Relaunch to update', enabled: true } },
    })
    const entry = commandEntries(overridden).find((e) => e.label === 'Relaunch to update')
    expect(entry).toEqual({ id: 'update.relaunch', label: 'Relaunch to update', accelerator: null, enabled: true })
    // The anchor's own id no longer appears -- one seat, one item.
    expect(commandEntries(overridden).some((e) => e.id === 'update.check')).toBe(false)
  })

  it('swaps the vault seat to whichever command the override names, respecting the override’s own enabled', () => {
    const overridden = menuSpecFor(COMMANDS, {
      seatOverrides: { 'secrets.lockVault': { commandId: 'secrets.unlockVault', label: 'Unlock vault', enabled: false } },
    })
    const entry = commandEntries(overridden).find((e) => e.label === 'Unlock vault')
    expect(entry).toEqual({ id: 'secrets.unlockVault', label: 'Unlock vault', accelerator: null, enabled: false })
  })

  it('leaves a seat at its own static command and label with no seatOverrides', () => {
    const entry = commandEntries(spec).find((e) => e.id === 'update.check')
    expect(entry?.label).toBe('Check for updates…')
  })
})
