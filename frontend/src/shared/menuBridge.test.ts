import { beforeEach, describe, expect, it, vi } from 'vitest'

const { installMock, setEnabledMock } = vi.hoisted(() => ({
  installMock: vi.fn(),
  setEnabledMock: vi.fn(),
}))

// Only MenuService is faked; every other binding the registry reaches
// for on import stays real.
vi.mock('./bindings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./bindings')>()),
  MenuService: { Install: installMock, SetEnabled: setEnabledMock },
}))

import { installNativeMenu, pushMenuEnablement } from './menuBridge'
import { isMenuOwnedCombo } from './menuOwnership'
import { comboKey } from './keybinding'
import { useAppStore } from './store'

beforeEach(() => {
  installMock.mockReset().mockResolvedValue(true)
  setEnabledMock.mockReset().mockResolvedValue(undefined)
  useAppStore.setState({ view: { kind: 'home' } })
})

describe('the native menu bridge', () => {
  it('hands Go a flat wire tree and takes ownership of the accelerators it installed', async () => {
    await expect(installNativeMenu()).resolves.toBe(true)
    const spec = installMock.mock.calls[0][0]
    expect(spec.Menus.map((m: { Label: string }) => m.Label)).toEqual([
      'Mill', 'File', 'Edit', 'View', 'Workflow', 'Atlas', 'Window', 'Help',
    ])
    // Every wire item carries every field, present or empty -- a bound
    // method's generated model has no optional fields.
    const file = spec.Menus.find((m: { Label: string }) => m.Label === 'File')
    expect(file.Groups[0][0]).toEqual({
      Kind: 'command', ID: 'workflow.new', Label: 'New workflow',
      Accelerator: 'cmdorctrl+n', Enabled: false, Role: '', ReleaseAccelerator: false, Groups: [],
    })
    expect(isMenuOwnedCombo(comboKey(['cmd'], 'N'))).toBe(true)
  })

  it('claims nothing when no native menu took the tree', async () => {
    installMock.mockResolvedValue(false)
    await expect(installNativeMenu()).resolves.toBe(false)
    expect(isMenuOwnedCombo(comboKey(['cmd'], 'N'))).toBe(false)
  })

  it('sends only the items whose state actually moved', async () => {
    await installNativeMenu()
    pushMenuEnablement()
    expect(setEnabledMock).not.toHaveBeenCalled()

    // Opening a work tab makes the close-tab family valid.
    useAppStore.setState({ activeWorkTabKey: 'tab-1' })
    pushMenuEnablement()
    expect(setEnabledMock).toHaveBeenCalledTimes(1)
    const diff = setEnabledMock.mock.calls[0][0]
    expect(diff).toEqual({ 'tab.close': true, 'tab.closeOthers': true })

    pushMenuEnablement()
    expect(setEnabledMock).toHaveBeenCalledTimes(1)
  })

  it('kills a surface-scoped item when the user leaves its surface', async () => {
    useAppStore.setState({ view: { kind: 'atlas' } })
    await installNativeMenu()
    useAppStore.setState({ view: { kind: 'home' } })
    pushMenuEnablement()
    expect(setEnabledMock.mock.calls[0][0]['atlas.up']).toBe(false)
  })
})
