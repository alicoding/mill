import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushNotice, TRANSIENT_NOTICE_MS, useNoticeStore } from './noticeStore'

describe('pushNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useNoticeStore.setState({ notices: [] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('info and success leave on their own after the transient window; warning and error stay', () => {
    pushNotice({ text: 'saved', level: 'success', source: 'Bookmark' })
    pushNotice({ text: 'careful', level: 'warning' })
    pushNotice({ text: 'broke', level: 'error' })
    pushNotice({ text: 'fyi' })
    expect(useNoticeStore.getState().notices.map((n) => n.level)).toEqual(['success', 'warning', 'error', 'info'])
    vi.advanceTimersByTime(TRANSIENT_NOTICE_MS)
    expect(useNoticeStore.getState().notices.map((n) => n.level)).toEqual(['warning', 'error'])
  })

  it('returns a dismiss function, and every pushed notice is dismissible by hand', () => {
    const dismiss = pushNotice({ text: 'broke', level: 'error' })
    const [n] = useNoticeStore.getState().notices
    expect(n.source).toBeUndefined()
    expect(typeof n.onDismiss).toBe('function')
    dismiss()
    expect(useNoticeStore.getState().notices).toEqual([])
  })

  it('a ttl override wins over the level default, and 0 means never', () => {
    pushNotice({ text: 'quick error', level: 'error', ttlMs: 10 })
    pushNotice({ text: 'sticky info', ttlMs: 0 })
    vi.advanceTimersByTime(TRANSIENT_NOTICE_MS * 2)
    expect(useNoticeStore.getState().notices.map((n) => n.text)).toEqual(['sticky info'])
  })
})
