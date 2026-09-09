import type { Page } from '@playwright/test'
import { callBindingViaRPC } from './wailsRpc'

// The doors a spec reads a REGISTRY- or SEED-derived set through, so a
// count assertion never has to be a hand-kept literal.
//
// The class this exists for: a test asserting "the palette has 51
// steps" or "Extensions lists 8 rows" goes stale the moment an
// unrelated feature registers one more, and the failure lands on that
// feature's PR rather than on anything it broke. The number was never
// the property under test -- completeness was: the surface renders
// EVERY member of its set and drops none. Reading the set back through
// the same door the surface is built from asserts exactly that, and
// costs nothing when the set grows.
//
// Counts of entities a test CREATED itself stay literal: those are the
// test's own fixture, not a set anything else can grow.
// scripts/check-e2e-seed-literals.sh keeps the two apart.

// One registered step type, as CompositionService.NodeTypes reports it.
// Only the fields a palette-group mapping needs -- the rest of the
// NodeType record is irrelevant to a count.
export interface RegisteredStepType {
  ID: string
  Kind: string
  PaletteGroup?: string
}

const NODE_TYPES = 'github.com/alicoding/mill/internal/services/compositionsvc.CompositionService.NodeTypes'

// registeredStepTypes is the palette's own source: the binding
// store.ts's refreshNodeTypes calls. It includes the seeded declared
// step types (ADR-0037), which is why a generated contract's list is
// NOT a substitute here.
export async function registeredStepTypes(page: Page): Promise<RegisteredStepType[]> {
  const types = await callBindingViaRPC<RegisteredStepType[]>(page, NODE_TYPES, [])
  // A door answering nothing would make every count below trivially
  // true -- the floor is what stops a silent zero from passing.
  if (types.length < 40) {
    throw new Error(`registeredStepTypes: the registry answered with ${types.length} step types, far below any real build`)
  }
  return types
}

// One scanned plugin as PluginService.ListPlugins reports it. Only the
// fields a built-in count needs.
export interface ListedPlugin {
  Manifest: { ID: string }
  Builtin: boolean
}

const LIST_PLUGINS = 'github.com/alicoding/mill/internal/services/pluginsvc.PluginService.ListPlugins'

// builtInPluginCount is the Extensions "Built in" disclosure's own
// source (goal 0357 S2): the same ListPlugins scan the page reads,
// counted here instead of hand-kept, so a future bundled plugin never
// needs a matching edit to this door's caller.
export async function builtInPluginCount(page: Page): Promise<number> {
  const plugins = await callBindingViaRPC<ListedPlugin[]>(page, LIST_PLUGINS, [])
  const count = plugins.filter((p) => p.Builtin).length
  // A door answering nothing would make the assertion trivially true --
  // the floor is what stops a silent zero from passing.
  if (count < 1) {
    throw new Error(`builtInPluginCount: the registry answered with ${count} built-in plugins, far below any real build`)
  }
  return count
}

// One scanned plugin's contributed canvas objects, as ListPlugins
// reports them -- only the fields the example-seed enumeration below
// needs.
export interface ListedPluginCanvasObjects {
  Error: string
  Manifest: { contributes?: { canvasObjects?: { kind: string; example: unknown }[] } }
}

// pluginCanvasObjectExampleKinds is atlas-seeded-board-objects.spec.ts's
// own source for "every declaring plugin kind" (goal 0411 S2, the e2e
// half of S1's gate): every VALID plugin's canvasObjects entries that
// declare an example, deduplicated by kind -- the same claim
// pluginsvc.CanvasObjectExamples() reads server-side to seed Board
// gallery, read back through the registry door instead of hand-kept so
// a sixth declaring plugin never needs a matching edit here.
export async function pluginCanvasObjectExampleKinds(page: Page): Promise<string[]> {
  const plugins = await callBindingViaRPC<ListedPluginCanvasObjects[]>(page, LIST_PLUGINS, [])
  const kinds = new Set<string>()
  for (const p of plugins) {
    if (p.Error) continue
    for (const obj of p.Manifest.contributes?.canvasObjects ?? []) {
      if (obj.example) kinds.add(obj.kind)
    }
  }
  // A door answering nothing would make the assertion trivially true --
  // the floor is what stops a silent zero from passing.
  if (kinds.size < 1) {
    throw new Error(`pluginCanvasObjectExampleKinds: the registry answered with ${kinds.size} declaring kinds, far below any real build`)
  }
  return [...kinds]
}
