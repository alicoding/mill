import type { Command } from './commands'
import { entityRowCommands, type EntityRowFamily, type EntityRowItem } from './entityRowCommands'
import { ConfigureService } from './bindings'
import { listMCPServerTools } from './mcpToolsStore'
import {
  refreshAIProviders, refreshClientCerts, refreshConversionProfiles, refreshDecisions, refreshDeclaredStepTypes,
  refreshExecEnvs, refreshLists, refreshMCPServers, refreshSecretSources, useConfigureEntityStore,
} from './configureEntityStore'
import { refreshRequests, useAppStore } from './store'
import { refreshSeedRevisions, shippedRevision } from './seedRevisionStore'
import { useUISignalStore } from './uiSignalStore'
import type { SeedLike } from './seedLifecycle'

// One descriptor per Configure entity family (goal 0346), minted into
// that family's row actions by shared/entityRowCommands.ts. Adding a
// tenth family is one entry in the table at the bottom of this file --
// not another page's worth of `onClick` closures.
//
// A family's `entity` slug is the one every surface already uses:
// InventoryItem.entity, ENTITY_ICON's key, and the data-event name
// ConfigureService.UndoDelete restores through. The command id namespace
// is `configure.<entity>`, so a row's Delete is `configure.list.delete`.

// A Duplicate opens the tab's own create form prefilled from the row --
// state a registry command cannot reach directly, so it sets the view
// and the signal in the same tick, the pair a reference field's "Open in
// Configure" already fires (goal 0312).
function openConfigureDuplicate(tab: string, id: string): void {
  useAppStore.getState().setView({ kind: 'configure', tab })
  useUISignalStore.getState().requestConfigureDuplicate(tab, id)
}

// Every seeded Configure family judges its reset against the SAME
// shipped-revision map (ConfigureService.SeedRevisions), so the two seed
// fields are filled in once here rather than per descriptor.
function seeded<T extends EntityRowItem & { Seed: SeedLike }>(family: EntityRowFamily<T>): EntityRowFamily<T> {
  return {
    ...family,
    seedOf: (item) => item.Seed,
    shippedRevision: (item) => shippedRevision('configure', item.ID, item.Seed.SeedRevision),
  }
}

// A mutation that can change a row's seed provenance (a delete makes a
// built-in restorable; a reset re-stamps it) has to re-read the shipped
// map too, or the reset command's own enablement answers from stale data.
function refetchWith(refresh: () => Promise<void>): () => void {
  return () => {
    void refresh()
    void refreshSeedRevisions('configure')
  }
}

const requests = seeded({
  entity: 'request',
  namespace: 'configure.request',
  load: () => useAppStore.getState().requests,
  refetch: refetchWith(refreshRequests),
  // An Integration edits in its own work tab beside the canvas, never in
  // an in-page form -- the only Configure family whose row menu carries
  // an explicit Edit for that reason.
  edit: (item) => useAppStore.getState().openWorkTab({ kind: 'request-edit', requestId: item.ID }),
  exportEntity: (id) => ConfigureService.ExportHTTPRequest(id),
  reset: (id) => ConfigureService.ResetHTTPRequestToSeed(id),
  remove: (id) => ConfigureService.DeleteHTTPRequest(id),
})

const lists = seeded({
  entity: 'list',
  namespace: 'configure.list',
  load: () => useConfigureEntityStore.getState().lists,
  refetch: refetchWith(refreshLists),
  exportEntity: (id) => ConfigureService.ExportList(id),
  reset: (id) => ConfigureService.ResetListToSeed(id),
  remove: (id) => ConfigureService.DeleteList(id),
})

const mcpServers = seeded({
  entity: 'mcpserver',
  namespace: 'configure.mcpserver',
  load: () => useConfigureEntityStore.getState().mcpServers,
  refetch: refetchWith(refreshMCPServers),
  // "List tools" is this family's own discoverability action: it names
  // the exact tool a workflow node has to ask for. The result lands in
  // shared/mcpToolsStore.ts, which the page renders below its list.
  extras: [{
    suffix: 'listTools',
    label: 'commands.configure.mcpserver.listTools',
    run: (item) => listMCPServerTools(item.ID),
  }],
  exportEntity: (id) => ConfigureService.ExportMCPServer(id),
  reset: (id) => ConfigureService.ResetMCPServerToSeed(id),
  remove: (id) => ConfigureService.DeleteMCPServer(id),
})

const decisions = seeded({
  entity: 'decision',
  namespace: 'configure.decision',
  load: () => useConfigureEntityStore.getState().decisions,
  refetch: refetchWith(refreshDecisions),
  duplicate: (item) => openConfigureDuplicate('decisions', item.ID),
  exportEntity: (id) => ConfigureService.ExportDecision(id),
  reset: (id) => ConfigureService.ResetDecisionToSeed(id),
  remove: (id) => ConfigureService.DeleteDecision(id),
})

const execEnvs = seeded({
  entity: 'execenv',
  namespace: 'configure.execenv',
  load: () => useConfigureEntityStore.getState().execEnvs,
  refetch: refetchWith(refreshExecEnvs),
  exportEntity: (id) => ConfigureService.ExportExecEnv(id),
  reset: (id) => ConfigureService.ResetExecEnvToSeed(id),
  remove: (id) => ConfigureService.DeleteExecEnv(id),
})

const aiProviders = seeded({
  entity: 'aiprovider',
  namespace: 'configure.aiprovider',
  load: () => useConfigureEntityStore.getState().aiProviders,
  refetch: refetchWith(refreshAIProviders),
  exportEntity: (id) => ConfigureService.ExportAIProvider(id),
  reset: (id) => ConfigureService.ResetAIProviderToSeed(id),
  remove: (id) => ConfigureService.DeleteAIProvider(id),
})

// Step types ship no seeded examples, so no reset -- the factory simply
// mints no reset command for a family that declares none.
const stepTypes: EntityRowFamily<EntityRowItem> = {
  entity: 'steptype',
  namespace: 'configure.steptype',
  load: () => useConfigureEntityStore.getState().declaredStepTypes,
  refetch: () => { void refreshDeclaredStepTypes() },
  exportEntity: (id) => ConfigureService.ExportDeclaredStepType(id),
  remove: (id) => ConfigureService.DeleteDeclaredStepType(id),
}

// A conversion profile is a rule set authored in place -- nothing
// portable to export, and no shipped example to reset to.
const conversionProfiles: EntityRowFamily<EntityRowItem> = {
  entity: 'conversionprofile',
  namespace: 'configure.conversionprofile',
  load: () => useConfigureEntityStore.getState().conversionProfiles,
  refetch: () => { void refreshConversionProfiles() },
  remove: (id) => ConfigureService.DeleteConversionProfile(id),
}

// A secret source names a path on THIS machine, so it has neither an
// export nor a seeded example (ADR-0050).
const secretSources: EntityRowFamily<EntityRowItem> = {
  entity: 'secretsource',
  namespace: 'configure.secretsource',
  load: () => useConfigureEntityStore.getState().secretSources,
  refetch: () => { void refreshSecretSources() },
  remove: (id) => ConfigureService.DeleteSecretSource(id),
}

// Certificates predates goal 0346 and kept its own command ids
// (`clientcert.*`, not `configure.clientcert.*`) -- the namespace stays
// as it shipped rather than renaming live command ids. Its row is
// already the editor, but a reference field's "Open in Configure"
// (goal 0312) can reach it from elsewhere, so edit navigates to the
// tab before signalling. Duplicate calls the same backend copy RPC the
// kebab always did (an immediate copy, not a prefilled create form
// like the shared `duplicate` field above), so it arrives as an extra.
const clientCerts: EntityRowFamily<EntityRowItem> = {
  entity: 'clientcert',
  namespace: 'clientcert',
  load: () => useConfigureEntityStore.getState().clientCerts,
  refetch: () => { void refreshClientCerts() },
  edit: (item) => {
    useAppStore.getState().setView({ kind: 'configure', tab: 'certificates' })
    useUISignalStore.getState().requestConfigureEdit('certificates', item.ID)
  },
  extras: [{
    suffix: 'duplicate',
    label: 'commands.clientcert.duplicate',
    run: async (item) => {
      await ConfigureService.DuplicateClientCertificate(item.ID)
      await refreshClientCerts()
    },
  }],
  remove: (id) => ConfigureService.DeleteClientCertificate(id),
}

export const CONFIGURE_ROW_COMMANDS: Command[] = [
  requests, lists, mcpServers, decisions, execEnvs, aiProviders,
  stepTypes, conversionProfiles, secretSources, clientCerts,
].flatMap((family) => entityRowCommands(family as EntityRowFamily<EntityRowItem>))
