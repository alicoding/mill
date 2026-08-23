import type { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import { Type as FieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import type { Field } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'

// goal 0172 S2's "create a new type from these files" proposal: pure
// state-shaping logic only, deliberately split out of
// AtlasKindProposal.tsx (which pulls in @primer/react and its own CSS)
// so this is unit-testable under Vitest's plain node environment, the
// same listRowImportParse.ts split its own pure column-inference logic
// out from ListRowImport.tsx for.

// The Kind picker's own sentinel value for "create a new type from
// these files" -- distinct from every real Kind ID (seeding.NewSlugID
// never produces this literal), so the picker's existing onChange can
// tell the two apart with a plain equality check.
export const CREATE_KIND_OPTION = '__create_kind_from_files__'

// statusFieldKey/statusFieldLabel are the one field S2's status toggle
// ever adds -- a literal Key (the coercion contract this whole feature
// rests on: a Kind field with no matching frontmatter key is simply
// never written by CoerceFrontmatterFields, so this field can never
// collide with an inferred one that already claimed the same key) and
// a plain default Label, editable afterward like any other Kind field
// once created.
const statusFieldKey = 'status'
const statusFieldLabel = 'Status'

export interface ProposalFieldState {
  key: string
  label: string
  type: FieldType
  include: boolean
  showOnCard: boolean
  multiline: boolean
  options: string[]
}

export interface KindProposalState {
  name: string
  fields: ProposalFieldState[]
  statusEnabled: boolean
  statusValues: string
}

// folderDisplayName reads the last path segment of an absolute scan
// root, forward- or backslash-separated -- the "Type name" input's own
// prefill (the design contract's "prefilled with the folder's own
// name").
function folderDisplayName(scanRoot: string): string {
  const segments = scanRoot.split(/[/\\]/).filter(Boolean)
  return segments[segments.length - 1] ?? scanRoot
}

// initialProposalState builds a fresh, unedited proposal from one
// category's own inferred fields -- called every time the Kind picker
// transitions INTO the create option, so re-selecting it after
// switching away always starts from a clean inference, never stale
// edits (the design contract's own "discards its edits" rule).
export function initialProposalState(scanRoot: string, inferredFields: Field[]): KindProposalState {
  return {
    name: folderDisplayName(scanRoot),
    fields: inferredFields.map((f) => ({
      key: f.Key,
      label: f.Label,
      type: f.Type,
      include: true,
      showOnCard: f.ShowOnCard ?? false,
      multiline: f.Multiline ?? false,
      options: f.Options ?? [],
    })),
    statusEnabled: false,
    statusValues: '',
  }
}

// proposalNameTaken reports whether name case-insensitively matches an
// already-existing Kind's own Label -- the blur-driven validation the
// design contract names.
export function proposalNameTaken(name: string, kinds: Kind[]): boolean {
  const trimmed = name.trim().toLowerCase()
  if (!trimmed) return false
  return kinds.some((k) => k.Label.trim().toLowerCase() === trimmed)
}

// buildProposalFields turns a proposal's own edited state into the
// typedfield.Field list CreateKind expects -- excluded rows are
// dropped, and the status toggle (when on) appends exactly one
// TypeOptions field the files never carry, so it starts absent from
// every card's Fields (CoerceFrontmatterFields only ever writes a
// field it finds a matching key for) and survives untouched forever
// after.
export function buildProposalFields(state: KindProposalState): Field[] {
  const fields: Field[] = state.fields
    .filter((f) => f.include)
    .map((f) => ({
      Key: f.key,
      Label: f.label,
      Type: f.type,
      Options: f.type === FieldType.TypeOptions ? f.options : undefined,
      Multiline: f.multiline,
      ShowOnCard: f.showOnCard,
    }) as Field)
  if (state.statusEnabled) {
    fields.push({
      Key: statusFieldKey,
      Label: statusFieldLabel,
      Type: FieldType.TypeOptions,
      Options: state.statusValues.split(',').map((s) => s.trim()).filter(Boolean),
      ShowOnCard: true,
    } as Field)
  }
  return fields
}
