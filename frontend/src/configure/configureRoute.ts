import { DEFAULT_CONFIGURE_KIND, resolveConfigureKind, type ConfigureKindID } from '../shared/configureKinds'
import { defineHashRoute } from '../shared/hashRoute'

// The Configure route (goal 0116): `#/configure/<kind>`, with
// `#/configure` meaning the first kind. The same shared/hashRoute.ts
// contract views/settingsRoute.ts instantiates -- a kind's pane is a
// place a user lands on and comes back to, so it has an address.
const route = defineHashRoute<ConfigureKindID>({
  prefix: '#/configure',
  storageKey: 'mill-configure-kind',
  fallback: DEFAULT_CONFIGURE_KIND,
  resolve: resolveConfigureKind,
})

export const kindFromHash = route.fromHash
export const hashForKind = route.hashFor
export const isConfigureHash = route.isHash
export const readLastConfigureKind = route.readLast
export const rememberConfigureKind = route.remember
export const writeConfigureHash = route.write
export const clearConfigureHash = route.clear
