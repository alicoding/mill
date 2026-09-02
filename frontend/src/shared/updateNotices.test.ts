import { describe, expect, it } from 'vitest'
import { UpdateState } from './bindings'
import { updateNotices } from './updateNotices'

const t = (k: string) => k

describe('updateNotices', () => {
  it('a server-driven update state takes the pill with its stable id, level, and primary command', () => {
    expect(updateNotices(UpdateState.UpdateStateReady, 'idle', t)).toMatchObject([
      { id: 'update-ready', level: 'success', text: 'noticePill.updateReady', primaryCommandId: 'update.relaunch', actions: [{ id: 'whats-new', commandId: 'update.whatsNew' }] },
    ])
    const downloading = updateNotices(UpdateState.UpdateStateDownloading, 'idle', t)[0]
    expect(downloading).toMatchObject({ id: 'update-downloading', level: 'progress' })
    expect(downloading.primaryCommandId).toBeUndefined()
    const available = updateNotices(UpdateState.UpdateStateAvailable, 'idle', t)[0]
    expect(available).toMatchObject({ id: 'update-available', level: 'info', primaryCommandId: 'update.downloadAndInstall' })
    expect(typeof available.onDismiss).toBe('function')
  })

  it('a user-run check renders only when no server state claimed the pill', () => {
    expect(updateNotices(UpdateState.UpdateStateReady, 'failed', t).map((n) => n.id)).toEqual(['update-ready'])
    expect(updateNotices(UpdateState.UpdateStateIdle, 'checking', t)).toMatchObject([{ id: 'update-checking', level: 'progress' }])
    expect(updateNotices(UpdateState.UpdateStateIdle, 'upToDate', t)).toMatchObject([{ id: 'update-uptodate', level: 'progress' }])
    const failed = updateNotices(UpdateState.UpdateStateIdle, 'failed', t)[0]
    expect(failed).toMatchObject({ id: 'update-check-failed', level: 'error', primaryCommandId: 'settings.open' })
    expect(typeof failed.onDismiss).toBe('function')
  })

  it('idle and idle renders nothing', () => {
    expect(updateNotices(UpdateState.UpdateStateIdle, 'idle', t)).toEqual([])
  })
})
