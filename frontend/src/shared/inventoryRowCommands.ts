import type { Command } from './commands'
import { entityRowCommands, type EntityRowFamily, type EntityRowItem } from './entityRowCommands'
import { CompositionService, GuardrailService, SecretService } from './bindings'
import { atlasFacts } from './atlasSelectionFacts'
import { refreshSeedRevisions, shippedRevision } from './seedRevisionStore'
import { refreshWorkflows, useAppStore } from './store'
import { useUISignalStore } from './uiSignalStore'
import { parseSourceRef } from './secretReference'

// A row's id tells the two secret backings apart (goal 0408 S2): a
// vault entry's id never carries a colon, a source-backed reference
// always does ("env:<source>/<KEY>" and friends) -- the same test
// SecretPicker.tsx's own vault/source option split already relies on.
const isSourceBackedID = (id: string): boolean => id.includes(':')

// The two inventories outside Configure whose rows use the same row
// contract (goal 0346): Workflows and the secrets vault. They are here
// rather than in shared/configureRowCommands.ts because neither is a
// Configure entity -- the command ids say so (`workflow.row.delete`,
// not `configure.workflow.delete`). A workflow delete now joins the
// same undo journal a Configure entity's does (goal 0404 S1's
// CompositionService.WireUndoJournal), so `workflows` drops
// `undoable: false` and gains the toast every other family gets; a
// secret's delete still registers nothing (an undo journal holding a
// deleted secret's value is the wrong primitive -- goal 0406 is the
// recently-deleted trash instead), so `secrets` keeps it.

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
}

// A secret row needs nothing but its id: both panels it opens are the
// Secrets view's own, reached through a signal, and the delete is a
// bare id. The list itself stays that view's state (it exists only
// while the vault is unlocked), so this family declares no `load`.
//
// A source-backed row (goal 0408 S2, a key ListProviderSecrets
// enumerates directly, never a vault entry) has no wrapping entry to
// edit, no version history and nothing here to delete -- the file owns
// the key. edit/history/delete gate on isSourceBackedID; openSource is
// its own row's replacement, gating the other way.
const secrets: EntityRowFamily<EntityRowItem> = {
  entity: 'secret',
  namespace: 'secret.row',
  refetch: () => { /* the Secrets view re-reads on the mill-data-changed event its own delete emits */ },
  extras: [
    {
      suffix: 'edit',
      label: 'commands.secret.row.edit',
      enabled: (item) => !isSourceBackedID(item.ID),
      run: (item) => useUISignalStore.getState().requestSecretPanel('edit', item.ID),
    },
    {
      suffix: 'history',
      label: 'commands.secret.row.history',
      enabled: (item) => !isSourceBackedID(item.ID),
      run: (item) => useUISignalStore.getState().requestSecretPanel('history', item.ID),
    },
    {
      suffix: 'openSource',
      label: 'commands.secret.row.openSource',
      enabled: (item) => isSourceBackedID(item.ID),
      run: (item) => {
        if (!parseSourceRef(item.ID)) return
        useAppStore.getState().setView({ kind: 'secrets', tab: 'sources' })
      },
    },
  ],
  remove: {
    run: (item) => SecretService.DeleteSecret(item.ID),
    undo: false,
    enabled: (item) => !isSourceBackedID(item.ID),
  },
}

// A guardrail rule row (views/GuardrailRulesPanel.tsx): the rows are
// the panel's own state, so the delete is confirmed by the surface
// (it alone knows the label) and the reload rides a revision signal.
const guardrailRules: EntityRowFamily<EntityRowItem> = {
  entity: 'rule',
  namespace: 'guardrail.rule',
  refetch: () => useUISignalStore.getState().bumpGuardrailRules(),
  extras: [{
    suffix: 'edit',
    label: 'commands.guardrail.rule.edit',
    run: (item) => useUISignalStore.getState().requestGuardrailRuleEdit(item.ID),
  }],
  remove: (id) => GuardrailService.DeleteRule(id),
  undoable: false,
}

// A perspective row in the board's switcher (atlas/AtlasPerspectiveSwitcher.tsx,
// ADR-0041): rename is the switcher's inline field, delete is confirmed
// here (a perspective has no way back) and performed by the switcher,
// which owns the active-perspective reset that follows.
const perspectives: EntityRowFamily<EntityRowItem> = {
  entity: 'perspective',
  namespace: 'perspective.row',
  labelOf: (id) => atlasFacts().perspectives().find((p) => p.id === id)?.name ?? '',
  refetch: () => {},
  extras: [{
    suffix: 'rename',
    label: 'commands.perspective.row.rename',
    run: (item) => useUISignalStore.getState().requestAtlasPerspectiveRename(item.ID),
  }],
  remove: {
    undo: false,
    confirm: { title: 'atlas:perspective.deleteConfirmTitle', body: 'atlas:perspective.deleteConfirmBody', confirmLabel: 'atlas:perspective.delete' },
    run: (item) => useUISignalStore.getState().requestAtlasPerspectiveDelete(item.ID),
  },
}

// Exported for shared/entityDeleteDoors.ts (goal 0404 S1): workflows
// and secrets are the two InventoryList consumers outside Configure
// that get list.deleteSelection wired through their existing delete
// door -- guardrailRules and perspectives render in their OWN panels,
// never through InventoryList, so they carry no bulk-delete door.
export const BULK_DELETABLE_INVENTORY_FAMILIES: EntityRowFamily<EntityRowItem>[] = [workflows, secrets] as EntityRowFamily<EntityRowItem>[]

export const INVENTORY_ROW_COMMANDS: Command[] = [workflows, secrets, guardrailRules, perspectives]
  .flatMap((family) => entityRowCommands(family as EntityRowFamily<EntityRowItem>))
