import { describe, expect, it } from 'vitest'
import views from '../locales/en/views.json'
import { installFailureKey, isUpdateFailure } from './updatesDisplay'

describe('isUpdateFailure', () => {
  it('recognizes a background install failure without a local check result', () => {
    expect(isUpdateFailure('error', 'backup')).toBe(true)
    expect(isUpdateFailure('error', '')).toBe(false)
  })
})

describe('installFailureKey', () => {
  it('projects preflight backup failures to the dedicated Updates copy', () => {
    expect(installFailureKey('backup')).toBe('settings.updates.installFailedBackup')
    expect(views.settings.updates.installFailedBackup).toBe("Couldn't back up your data. The update hasn't started.")
  })

  it.each([
    ['download', 'settings.updates.installFailedDownload'],
    ['install', 'settings.updates.installFailedInstall'],
    ['unknown', 'settings.updates.installFailedUnknown'],
  ])('keeps the %s failure projection', (stage, key) => {
    expect(installFailureKey(stage)).toBe(key)
  })
})
