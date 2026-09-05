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
