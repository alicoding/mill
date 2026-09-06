import { DEFAULT_SETTINGS_GROUP, resolveSettingsGroup, type SettingsGroupID } from '../shared/settingsGroups'
import { defineHashRoute } from '../shared/hashRoute'

// The Settings route (goal 0321): `#/settings/<group>`, with
// `#/settings` meaning General. One instance of shared/hashRoute.ts's
// contract; configure/configureRoute.ts is the other. The names below
// stay the surface's own vocabulary so a caller reads "groupFromHash",
// never a generic route object.
const route = defineHashRoute<SettingsGroupID>({
  prefix: '#/settings',
  storageKey: 'mill-settings-group',
  fallback: DEFAULT_SETTINGS_GROUP,
  resolve: resolveSettingsGroup,
})

export const groupFromHash = route.fromHash
export const hashForGroup = route.hashFor
export const isSettingsHash = route.isHash
export const readLastSettingsGroup = route.readLast
export const rememberSettingsGroup = route.remember
export const writeSettingsHash = route.write
export const clearSettingsHash = route.clear
