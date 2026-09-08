import { describe, expect, it } from 'vitest'
import { driveRunCommand } from './driveBridge'
import { useAppStore } from './store'

describe('driveRunCommand', () => {
  it('runs a real registry command and reports ok', async () => {
    const result = await driveRunCommand('settings.open')
    expect(result).toEqual({ ok: true })
    expect(useAppStore.getState().view.kind).toBe('settings')
  })

  it('reports an unknown id without running anything', async () => {
    const result = await driveRunCommand('not.a.real.command')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('not.a.real.command')
  })
})
