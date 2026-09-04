import { describe, expect, it } from 'vitest'
import { updateSeatFor } from './updateSeat'
import { UpdateState } from './bindings'

describe('updateSeatFor (the update menu seat, goal 0335)', () => {
  it('offers to check for updates when idle', () => {
    expect(updateSeatFor(UpdateState.UpdateStateIdle, '')).toEqual({
      commandId: 'update.check', label: 'Check for updates…', enabled: true,
    })
  })

  it('disables checking while a check is in flight', () => {
    expect(updateSeatFor(UpdateState.UpdateStateChecking, '')).toEqual({
      commandId: 'update.check', label: 'Checking for updates…', enabled: false,
    })
  })

  it('offers to download and install once a version is available, naming it', () => {
    expect(updateSeatFor(UpdateState.UpdateStateAvailable, '1.2.3')).toEqual({
      commandId: 'update.downloadAndInstall', label: 'Download and install v1.2.3…', enabled: true,
    })
  })

  it('disables the download item while it is downloading, still naming the version', () => {
    expect(updateSeatFor(UpdateState.UpdateStateDownloading, '1.2.3')).toEqual({
      commandId: 'update.downloadAndInstall', label: 'Downloading v1.2.3…', enabled: false,
    })
  })

  it('offers to relaunch once ready', () => {
    expect(updateSeatFor(UpdateState.UpdateStateReady, '1.2.3')).toEqual({
      commandId: 'update.relaunch', label: 'Relaunch to update', enabled: true,
    })
  })

  it('falls back to checking again on a failed check, never repeating the failure in the seat', () => {
    expect(updateSeatFor(UpdateState.UpdateStateError, '')).toEqual({
      commandId: 'update.check', label: 'Check for updates…', enabled: true,
    })
  })
})
