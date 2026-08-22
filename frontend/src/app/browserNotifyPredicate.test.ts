import { describe, expect, it } from 'vitest'
import { shouldNotifyBrowserTab } from './browserNotifyPredicate'

describe('shouldNotifyBrowserTab', () => {
  it('notifies when server mode, unfocused, and unseen', () => {
    expect(shouldNotifyBrowserTab({ isServerMode: true, hasFocus: false, alreadyNotified: false })).toBe(true)
  })

  it('never notifies in desktop mode, even unfocused and unseen', () => {
    expect(shouldNotifyBrowserTab({ isServerMode: false, hasFocus: false, alreadyNotified: false })).toBe(false)
  })

  it('never notifies while the tab is focused', () => {
    expect(shouldNotifyBrowserTab({ isServerMode: true, hasFocus: true, alreadyNotified: false })).toBe(false)
  })

  it('never notifies twice for the same pending id', () => {
    expect(shouldNotifyBrowserTab({ isServerMode: true, hasFocus: false, alreadyNotified: true })).toBe(false)
  })

  it('never notifies when desktop mode AND focused', () => {
    expect(shouldNotifyBrowserTab({ isServerMode: false, hasFocus: true, alreadyNotified: false })).toBe(false)
  })

  it('never notifies when desktop mode AND already notified', () => {
    expect(shouldNotifyBrowserTab({ isServerMode: false, hasFocus: false, alreadyNotified: true })).toBe(false)
  })

  it('never notifies when focused AND already notified', () => {
    expect(shouldNotifyBrowserTab({ isServerMode: true, hasFocus: true, alreadyNotified: true })).toBe(false)
  })

  it('never notifies when all three disqualifying conditions hold', () => {
    expect(shouldNotifyBrowserTab({ isServerMode: false, hasFocus: true, alreadyNotified: true })).toBe(false)
  })
})
