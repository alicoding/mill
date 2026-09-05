import { describe, expect, it } from 'vitest'
import {
  CUSTOM_MINUTES_MAX,
  CUSTOM_MINUTES_MIN,
  humanizeLockAfter,
  isLockAfterPreset,
  LOCK_AFTER_PRESETS,
  unlockStatusKey,
  unlockToggleLabelKey,
} from './vaultLockCopy'

describe('humanizeLockAfter', () => {
  it('names the largest whole unit a timeout divides into', () => {
    expect(humanizeLockAfter(60)).toEqual({ key: 'locking.minutes', count: 1 })
    expect(humanizeLockAfter(300)).toEqual({ key: 'locking.minutes', count: 5 })
    expect(humanizeLockAfter(900)).toEqual({ key: 'locking.minutes', count: 15 })
    expect(humanizeLockAfter(1800)).toEqual({ key: 'locking.minutes', count: 30 })
    expect(humanizeLockAfter(3600)).toEqual({ key: 'locking.hours', count: 1 })
    expect(humanizeLockAfter(7200)).toEqual({ key: 'locking.hours', count: 2 })
    expect(humanizeLockAfter(14400)).toEqual({ key: 'locking.hours', count: 4 })
    expect(humanizeLockAfter(28800)).toEqual({ key: 'locking.hours', count: 8 })
    expect(humanizeLockAfter(86400)).toEqual({ key: 'locking.days', count: 1 })
    expect(humanizeLockAfter(CUSTOM_MINUTES_MAX * 60)).toEqual({ key: 'locking.days', count: 30 })
  })

  it('has no duration to name for Never', () => {
    expect(humanizeLockAfter(0)).toBeNull()
    expect(humanizeLockAfter(-1)).toBeNull()
  })

  it('rounds a timeout that is not a whole number of minutes up off zero', () => {
    expect(humanizeLockAfter(90)).toEqual({ key: 'locking.minutes', count: 2 })
    expect(humanizeLockAfter(CUSTOM_MINUTES_MIN)).toEqual({ key: 'locking.minutes', count: 1 })
  })
})

describe('isLockAfterPreset', () => {
  it('recognises every offered preset, Never included', () => {
    for (const preset of LOCK_AFTER_PRESETS) expect(isLockAfterPreset(preset)).toBe(true)
  })

  it('sends anything else to the custom field', () => {
    expect(isLockAfterPreset(120)).toBe(false)
    expect(isLockAfterPreset(7200)).toBe(false)
  })
})

describe('unlock wording', () => {
  it('names only what the Mac in front of the reader can ask for', () => {
    expect(unlockToggleLabelKey('touchID')).toBe('touchId.toggleLabelTouchId')
    expect(unlockToggleLabelKey('touchIDAndWatch')).toBe('touchId.toggleLabelTouchIdAndWatch')
    expect(unlockToggleLabelKey('watch')).toBe('touchId.toggleLabelWatch')
    expect(unlockToggleLabelKey('password')).toBe('touchId.toggleLabelPassword')
    expect(unlockStatusKey('touchID')).toBe('touchId.requiredStatusTouchId')
    expect(unlockStatusKey('touchIDAndWatch')).toBe('touchId.requiredStatusTouchIdAndWatch')
    expect(unlockStatusKey('watch')).toBe('touchId.requiredStatusWatch')
    expect(unlockStatusKey('password')).toBe('touchId.requiredStatusPassword')
  })

  it('falls back to the password wording for an unknown capability', () => {
    expect(unlockToggleLabelKey('none')).toBe('touchId.toggleLabelPassword')
    expect(unlockToggleLabelKey('somethingNewer')).toBe('touchId.toggleLabelPassword')
    expect(unlockStatusKey('none')).toBe('touchId.requiredStatusPassword')
  })
})
