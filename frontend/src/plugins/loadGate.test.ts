import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// warnIfSnapshotBeforePlugins bails out entirely when `window` is
// undefined (typeof window === 'undefined', Vitest's own Node
// environment) -- every case here stubs a minimal `window` so the
// hash-scoped early return is actually reachable.
describe('warnIfSnapshotBeforePlugins', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  async function loadGateWithHash(hash: string) {
    vi.stubGlobal('window', { location: { hash } })
    return import('./loadGate')
  }

  it('warns once plugins are unsettled and the hash is empty (the main window)', async () => {
    const { warnIfSnapshotBeforePlugins } = await loadGateWithHash('')
    warnIfSnapshotBeforePlugins()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('stays silent once markPluginsSettled has run', async () => {
    const { warnIfSnapshotBeforePlugins, markPluginsSettled } = await loadGateWithHash('')
    markPluginsSettled()
    warnIfSnapshotBeforePlugins()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('stays silent on the #/settings route even while plugins are unsettled', async () => {
    const { warnIfSnapshotBeforePlugins } = await loadGateWithHash('#/settings')
    warnIfSnapshotBeforePlugins()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  // The narrowed early return (was: any non-empty hash) -- a non-
  // settings hash route (an auxiliary window) still carries the
  // invariant and warns if its own snapshot is ever read unsettled.
  it('still warns on a non-settings hash route', async () => {
    const { warnIfSnapshotBeforePlugins } = await loadGateWithHash('#/traypanel')
    warnIfSnapshotBeforePlugins()
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })
})
