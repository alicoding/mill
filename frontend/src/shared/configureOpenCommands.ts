import type { Command } from './commands'
import { copy } from './copy'
import { useAppStore } from './store'
import { CONFIGURE_KINDS, resolveKindLabel } from './configureKinds'

// One palette-only deep-link command per registered Configure KIND
// (goal 0116, shared/configureKinds.ts) -- the same shape
// settingsCommands.ts derives from SETTINGS_GROUPS: always unbound
// (defaultBinding: null), discoverable only by searching the palette,
// the kind carried by the id (`configure.open.<kind>`), the id-per-
// command convention every other parameterized command follows.
// Distinct from configureCreateCommands.ts: this lands on the kind's
// list, that one on its create form.
export const CONFIGURE_OPEN_COMMANDS: Command[] = CONFIGURE_KINDS.map((kind): Command => ({
  id: `configure.open.${kind.id}`,
  label: copy('commands.configure.openKind', { label: resolveKindLabel(kind) }),
  defaultBinding: null,
  run: () => useAppStore.getState().setView({ kind: 'configure', tab: kind.id }),
}))
