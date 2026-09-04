import { copy } from './copy'

// Shared reset-to-shipped-example affordance logic (docs/goals/0037
// item 4), used by every resource-inventory page's row menu (Workflows,
// Integrations, Decisions, Lists, MCP Servers, Environments) --
// deliberately one implementation shared by all six call sites rather
// than six near-identical `Modified ? … : …` blocks (the same "one
// shared primitive" discipline inventorySort.ts's own header comment
// already established for this exact family of pages).
//
// No ambient "outdated" badge anywhere (docs/goals/0037's research-
// converged decision, recorded in docs/SPEC.md's Seed lifecycle
// subsection) -- this only computes the on-demand menu-item label/
// disabled state, evaluated at the moment a user opens the row's own
// menu, never rendered as a standing indicator on the row itself.

/** The minimal seed-provenance shape every reset call site has on hand
 * (a Workflow/HTTPRequest/Decision/List/MCPServer/ExecEnv's own `Seed`
 * field) -- structurally typed so this file never has to import all
 * six generated model types just to describe one shared shape. */
export interface SeedLike {
  SeedRevision: number
  Modified: boolean
}

export interface SeedResetDescription {
  label: string
  disabled: boolean
}

// describeSeedReset decides the reset menu item's label/disabled state
// for one built-in-origin row. currentRevision is the CURRENTLY
// SHIPPED golden's revision (CompositionService/ConfigureService's own
// SeedRevisions() RPC) -- not seed.SeedRevision alone, since a Modified
// row's own stamp freezes at whatever it was when the latch fired and
// can drift behind a later Mill release's golden.
export function describeSeedReset(seed: SeedLike, currentRevision: number): SeedResetDescription {
  const upToDate = !seed.Modified && seed.SeedRevision >= currentRevision
  if (upToDate) {
    return { label: copy('seedReset.upToDate'), disabled: true }
  }
  return { label: copy('seedReset.reset', { revision: currentRevision }), disabled: false }
}
