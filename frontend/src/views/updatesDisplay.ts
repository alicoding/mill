import type { BuildInfo } from '../shared/bindings'

export function buildOriginKey(buildInfo: BuildInfo | null): string | null {
  if (buildInfo === null) return null
  if (buildInfo.BuildChannel === 'beta') return 'settings.updates.originBeta'
  if (buildInfo.BuildChannel === 'release') return 'settings.updates.originRelease'
  if (buildInfo.BuildChannel !== '') return 'settings.updates.originLocal'
  return 'settings.updates.originUnknown'
}

export function automaticUpdatesCaptionKey(
  autoCheck: boolean | null,
  checkInterval: string,
  buildInfo: BuildInfo | null,
): string | null {
  if (autoCheck === null) return null
  if (!autoCheck) return 'settings.updates.autoUpdateOffCaption'
  if (buildInfo === null) return null

  const scheduled = checkInterval !== 'manual'
  if (buildInfo.LocalBuild) {
    return scheduled
      ? 'settings.updates.autoUpdateLocalScheduledCaption'
      : 'settings.updates.autoUpdateLocalManualCaption'
  }
  return scheduled
    ? 'settings.updates.autoUpdateEligibleScheduledCaption'
    : 'settings.updates.autoUpdateEligibleManualCaption'
}
