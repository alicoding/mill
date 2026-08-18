import { afterEach, describe, expect, it, vi } from 'vitest'

const copyMock = vi.hoisted(() => vi.fn())
vi.mock('copy-to-clipboard', () => ({ default: copyMock }))

import { writeClipboardText } from './clipboardWrite'

// Regression: over plain http on another device (the remote server
// instance) navigator.clipboard does not exist, and the old direct
// writeText calls silently dropped every copy action.
describe('writeClipboardText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    copyMock.mockReset()
  })

  it('uses navigator.clipboard when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await writeClipboardText('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(copyMock).not.toHaveBeenCalled()
  })

  it('falls back to the execCommand path when navigator.clipboard is absent', async () => {
    vi.stubGlobal('navigator', {})
    copyMock.mockReturnValue(true)
    await writeClipboardText('hello')
    expect(copyMock).toHaveBeenCalledWith('hello')
  })

  it('falls back when the clipboard API rejects (permission denied)', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    copyMock.mockReturnValue(true)
    await writeClipboardText('hello')
    expect(copyMock).toHaveBeenCalledWith('hello')
  })

  it('throws when both doors fail, so callers surface real feedback', async () => {
    vi.stubGlobal('navigator', {})
    copyMock.mockReturnValue(false)
    await expect(writeClipboardText('hello')).rejects.toThrow(/Copy failed/)
  })
})
