import type { Command } from './commands'
import { entityRowCommands, type EntityRowFamily, type EntityRowItem } from './entityRowCommands'
import { CompositionService, SecretService } from './bindings'
import { refreshSeedRevisions, shippedRevision } from './seedRevisionStore'
import { refreshWorkflows, useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'

// The two inventories outside Configure whose rows use the same row
// contract (goal 0346): Workflows and the secrets vault. They are here
// rather than in shared/configureRowCommands.ts because neither is a
// Configure entity -- the command ids say so (`workflow.row.delete`,
// not `configure.workflow.delete`), and neither service registers a
// delete-undo, so both declare `undoable: false`.

const workflows: EntityRowFamily<EntityRowItem & { Seed: { SeedRevision: number; Modified: boolean } }> = {
  entity: 'workflow',
  namespace: 'workflow.row',
  load: () => useAppStore.getState().workflows,
  refetch: () => {
    void refreshWorkflows()
    void refreshSeedRevisions('workflow')
  },
  // Editing needs the node-type catalogue the canvas renders from; until
  // it has loaded there is nothing to open, which is the honest reason
  // the action is unavailable rather than silently inert.
  extras: [{
    suffix: 'edit',
    label: 'commands.workflow.row.edit',
    enabled: () => useAppStore.getState().nodeTypes !== null,
    run: (item) => useAppStore.getState().openWorkTab({ kind: 'workflow-edit', workflowId: item.ID, mode: 'edit' }),
  }],
  exportEntity: (id) => CompositionService.ExportWorkflow(id),
  reset: (id) => CompositionService.ResetWorkflowToSeed(id),
  seedOf: (item) => item.Seed,
  shippedRevision: (item) => shippedRevision('workflow', item.ID, item.Seed.SeedRevision),
  remove: (id) => CompositionService.DeleteWorkflow(id),
  undoable: false,
}

// A secret row needs nothing but its id: both panels it opens are the
// Secrets view's own, reached through a signal, and the delete is a
// bare id. The list itself stays that view's state (it exists only
// while the vault is unlocked), so this family declares no `load`.
const secrets: EntityRowFamily<EntityRowItem> = {
  entity: 'secret',
  namespace: 'secret.row',
  refetch: () => { /* the Secrets view re-reads on the mill-data-changed event its own delete emits */ },
  extras: [
    {
      suffix: 'edit',
      label: 'commands.secret.row.edit',
      run: (item) => useUISignalStore.getState().requestSecretPanel('edit', item.ID),
    },
    {
      suffix: 'history',
      label: 'commands.secret.row.history',
      run: (item) => useUISignalStore.getState().requestSecretPanel('history', item.ID),
    },
  ],
  remove: (id) => SecretService.DeleteSecret(id),
  undoable: false,
}

export const INVENTORY_ROW_COMMANDS: Command[] = [workflows, secrets]
  .flatMap((family) => entityRowCommands(family as EntityRowFamily<EntityRowItem>))
