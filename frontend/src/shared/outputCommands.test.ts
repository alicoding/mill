import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from './commands'
import { OUTPUT_COMMANDS } from './outputCommands'
import { useOutputFocusStore } from './outputFocusStore'
import { useNoticeStore } from './noticeStore'

const saveCommand = OUTPUT_COMMANDS.find((command) => command.id === 'output.save')

describe('output.save command', () => {
  beforeEach(() => {
    useOutputFocusStore.setState({ focused: null })
    useNoticeStore.setState({ notices: [] })
  })

  it('is disabled without a focused save capability', () => {
    expect(saveCommand?.enabled?.()).toBe(false)
    useOutputFocusStore.getState().setFocused({ id: 'text', copyText: () => '', toggleFind: vi.fn() })
    expect(saveCommand?.enabled?.()).toBe(false)
  })

  it('uses the latest focused viewer and returns its save promise', async () => {
    const first = vi.fn().mockResolvedValue(undefined)
    const second = vi.fn().mockResolvedValue(undefined)
    useOutputFocusStore.getState().setFocused({ id: 'first', copyText: () => '', toggleFind: vi.fn(), save: first })
    useOutputFocusStore.getState().setFocused({ id: 'second', copyText: () => '', toggleFind: vi.fn(), save: second })

    await expect(saveCommand?.run()).resolves.toBeUndefined()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })

  it('routes a rejected save through the command error notice', async () => {
    useOutputFocusStore.getState().setFocused({
      id: 'binary', copyText: () => '', toggleFind: vi.fn(),
      save: vi.fn().mockRejectedValue(new Error('save failed')),
    })

    expect(await runCommand('output.save')).toBe(false)
    const notices = useNoticeStore.getState().notices
    expect(notices[notices.length - 1]?.text).toContain('save failed')
  })
})
