import type { Icon } from '@primer/octicons-react'
import {
  AiModelIcon,
  ArrowSwitchIcon,
  ChecklistIcon,
  GlobeIcon,
  PackageIcon,
  PlugIcon,
  ServerIcon,
  ShieldLockIcon,
  TableIcon,
  TagIcon,
  TerminalIcon,
} from '@primer/octicons-react'
import { copy } from './copy'

// The Configure kind registry (goal 0116): eleven kinds in four named
// groups, one pane rendered per kind. Replaces the hard-coded tab
// strip -- at this many kinds the converged shape is a grouped left
// rail with a filter, the same rail Settings already navigates by
// (shared/settingsGroups.ts, views/SettingsGroupNav.tsx).
//
// id is the whole address of a kind: the `#/configure/<id>` route, the
// View.tab deep-link value (shared/viewKinds.ts), the `configure:<id>`
// navigate target (shared/navigateTarget.ts), the pane's own
// `configure-pane-<id>` test id, and the `configure.open.<id>` /
// `configure.new.<id>` command suffixes. The ids predate this registry
// and are a public surface -- a rename is a breaking change.
//
// Lives in shared/ (dependency-cruiser's shared-is-a-leaf rule) since
// shared/configureOpenCommands.ts reads this list to build one command
// per kind, and configure/ConfigureView.tsx reads it to render.
export type ConfigureKindID =
  | 'integration'
  | 'mcpservers'
  | 'aiproviders'
  | 'certificates'
  | 'environments'
  | 'execenvs'
  | 'lists'
  | 'attributes'
  | 'conversionprofiles'
  | 'decisions'
  | 'steptypes'

// The groups in reading order. 'extensions' is the slot a plugin-
// contributed kind lands in; no plugin contributes one yet, so the
// group renders only once a kind with a plugin source exists.
export type ConfigureGroupID = 'connections' | 'runtime' | 'data' | 'workflowLogic' | 'extensions'

// Where a kind comes from. A plugin's kind carries its plugin id so the
// rail can place it under "From extensions" regardless of the group the
// contribution names -- extension kinds never interleave with built-in
// ones.
export type ConfigureKindSource = 'builtin' | { plugin: string }

export interface ConfigureGroup {
  id: ConfigureGroupID
  // 'configure' namespace i18next keys.
  titleKey: string
  captionKey?: string
}

export interface ConfigureKind {
  id: string
  // A 'configure' namespace i18next key, resolved inside React via
  // useTranslation('configure') and outside it via resolveKindLabel.
  labelKey: string
  icon: Icon
  group: ConfigureGroupID
  source: ConfigureKindSource
  // The RefKind (docs/adr/0009) a step field uses to point at an entity
  // of this kind -- absent for a kind no field references by id.
  refKind?: string
  // The create-flow command that lands on this kind's own create form
  // (shared/configureCreateCommands.ts) -- absent for a kind with no
  // "new" flow of its own.
  createCommandId?: string
}

export const CONFIGURE_GROUPS: ConfigureGroup[] = [
  { id: 'connections', titleKey: 'configureView.groups.connections.title', captionKey: 'configureView.groups.connections.caption' },
  { id: 'runtime', titleKey: 'configureView.groups.runtime.title', captionKey: 'configureView.groups.runtime.caption' },
  { id: 'data', titleKey: 'configureView.groups.data.title', captionKey: 'configureView.groups.data.caption' },
  { id: 'workflowLogic', titleKey: 'configureView.groups.workflowLogic.title', captionKey: 'configureView.groups.workflowLogic.caption' },
  { id: 'extensions', titleKey: 'configureView.groups.extensions.title' },
]

const builtin = (kind: Omit<ConfigureKind, 'source'> & { id: ConfigureKindID }): ConfigureKind & { id: ConfigureKindID } => ({ ...kind, source: 'builtin' })

// The ORDER is the reading order of the rail within each group.
export const CONFIGURE_KINDS: (ConfigureKind & { id: ConfigureKindID })[] = [
  builtin({ id: 'integration', labelKey: 'configureView.integration', icon: PlugIcon, group: 'connections', refKind: 'request', createCommandId: 'configure.new.integration' }),
  builtin({ id: 'mcpservers', labelKey: 'configureView.mcpServers', icon: ServerIcon, group: 'connections', refKind: 'mcpserver', createCommandId: 'configure.new.mcpservers' }),
  builtin({ id: 'aiproviders', labelKey: 'configureView.aiProviders', icon: AiModelIcon, group: 'connections', refKind: 'aiprovider', createCommandId: 'configure.new.aiproviders' }),
  builtin({ id: 'certificates', labelKey: 'configureView.certificates', icon: ShieldLockIcon, group: 'connections', createCommandId: 'configure.new.certificates' }),
  builtin({ id: 'environments', labelKey: 'configureView.environments', icon: GlobeIcon, group: 'runtime', createCommandId: 'configure.new.environments' }),
  builtin({ id: 'execenvs', labelKey: 'configureView.execEnvs', icon: TerminalIcon, group: 'runtime', refKind: 'execenv', createCommandId: 'configure.new.execenvs' }),
  builtin({ id: 'lists', labelKey: 'configureView.lists', icon: TableIcon, group: 'data', refKind: 'list', createCommandId: 'configure.new.lists' }),
  builtin({ id: 'attributes', labelKey: 'configureView.attributes', icon: TagIcon, group: 'data' }),
  builtin({ id: 'conversionprofiles', labelKey: 'configureView.conversionProfiles', icon: ArrowSwitchIcon, group: 'data', refKind: 'conversionprofile', createCommandId: 'configure.new.conversionprofiles' }),
  builtin({ id: 'decisions', labelKey: 'configureView.decisions', icon: ChecklistIcon, group: 'workflowLogic', refKind: 'decision', createCommandId: 'configure.new.decisions' }),
  builtin({ id: 'steptypes', labelKey: 'configureView.stepTypes', icon: PackageIcon, group: 'workflowLogic', createCommandId: 'configure.new.steptypes' }),
]

export const DEFAULT_CONFIGURE_KIND: ConfigureKindID = 'integration'

export function isConfigureKind(value: string | undefined | null): value is ConfigureKindID {
  return CONFIGURE_KINDS.some((k) => k.id === value)
}

// resolveConfigureKind maps any incoming tab/route value onto a real
// kind, falling back to the first one -- an unknown id (a retired tab,
// a typo in a hand-edited address) lands somewhere honest.
export function resolveConfigureKind(value: string | undefined | null): ConfigureKindID {
  return isConfigureKind(value) ? value : DEFAULT_CONFIGURE_KIND
}

// The kind's label outside a React tree (the command registry builds
// its list at module scope) -- the same 'configure' namespace copy the
// rail renders through t().
export function resolveKindLabel(kind: ConfigureKind): string {
  return copy(`configure:${kind.labelKey}`)
}

export interface ConfigureKindGroup {
  group: ConfigureGroup
  kinds: ConfigureKind[]
}

// groupForKind places a kind: built-in kinds sit in the group they
// declare; every plugin-contributed kind sits under "From extensions".
export function groupForKind(kind: ConfigureKind): ConfigureGroupID {
  return kind.source === 'builtin' ? kind.group : 'extensions'
}

// groupConfigureKinds arranges kinds by CONFIGURE_GROUPS' reading order,
// dropping a group with nothing in it -- a filter that matches no kind
// in Runtime shows no Runtime heading, and "From extensions" only
// appears once an extension contributes a kind.
export function groupConfigureKinds(kinds: ConfigureKind[]): ConfigureKindGroup[] {
  return CONFIGURE_GROUPS
    .map((group) => ({ group, kinds: kinds.filter((k) => groupForKind(k) === group.id) }))
    .filter((g) => g.kinds.length > 0)
}

// filterConfigureKinds narrows by label, case-insensitively, across
// every group. An empty query keeps everything.
export function filterConfigureKinds(kinds: ConfigureKind[], query: string, label: (kind: ConfigureKind) => string): ConfigureKind[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return kinds
  return kinds.filter((k) => label(k).toLowerCase().includes(needle))
}
