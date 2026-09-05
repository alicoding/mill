// The target a command acts on (goal 0343). A registry command used to
// be a closure over global store state, so anything acting on a
// specific row -- stop THIS run, pin THIS clipboard entry, open THIS
// workflow -- had to live outside the registry as its own inline
// handler (goal 0335's own recorded reason, restated at every such
// site). The invoker supplies the target instead: a typed context
// object handed to BOTH enabled() and run(), never a positional
// argument, so a command's availability and its effect read the same
// target.
//
// A kind is added only when a real surface needs it -- the four below
// are the ones that exist today. `pinned` on 'entry' is the entry's
// own state at the moment the surface offers the action: the clipboard
// entry list is a dialog's local state, unreachable from this leaf, so
// the invoker states it rather than a command re-fetching it.
export type CommandContext =
  | { kind: 'workflow'; workflowId: string }
  // nodeId is the step a paused run is parked on -- present only when
  // the surface offering the action can see the park (the canvas dock,
  // Activity's paused row). run.continue/run.step need it to answer;
  // run.stop/run.open do not, so it stays optional.
  // values is the reviewer's typed edit-and-resume input, stated by the
  // surface that collected it (the same "the invoker states it rather
  // than a command re-fetching it" reasoning as `pinned` above) --
  // discarded by every command that isn't resuming a park.
  | { kind: 'run'; runId: string; workflowId?: string; nodeId?: string; values?: Record<string, string> }
  | { kind: 'entry'; entryId: string; pinned?: boolean }
  | { kind: 'card'; cardId: string }
  // The List grid's live selection (goal 0349 S4): which rows the
  // row-marker checkboxes hold, which column header is selected, and
  // the tab/newline text a copy would write. All three are stated by
  // the grid rather than re-derived, for the same reason `pinned` is:
  // the selection is that mount's own state, unreachable from here.
  | { kind: 'listGrid'; listID: string; rowIDs: string[]; columnKey?: string; text?: string }
  // A row in an entity inventory (goal 0346): `entity` is the family
  // slug every surface already spells the same way -- InventoryItem.
  // entity, ENTITY_ICON's keys, deleteWithUndo's data-event name -- and
  // `id` is that row's entity id. One kind for every family, because a
  // row action differs by FAMILY, not by kind of target: the command's
  // own id carries the family, and entityContext(ctx, family) below is
  // what refuses a context from a different one.
  | { kind: 'entity'; entity: string; id: string }

export type CommandContextKind = CommandContext['kind']

// Whether a command declaring `needs` can run against this context.
// A command with no `needs` accepts anything (including nothing); one
// with `needs` and no matching context cannot run at all.
export function contextSatisfies(needs: CommandContextKind | undefined, ctx: CommandContext | undefined): boolean {
  if (!needs) return true
  return ctx?.kind === needs
}

// Narrowing helpers, so a run(ctx) reads its own target without
// re-asserting the discriminant at every use.
export function workflowContext(ctx: CommandContext | undefined): { workflowId: string } | null {
  return ctx?.kind === 'workflow' ? { workflowId: ctx.workflowId } : null
}

export function runContext(ctx: CommandContext | undefined): { runId: string; workflowId?: string; nodeId?: string; values?: Record<string, string> } | null {
  return ctx?.kind === 'run' ? { runId: ctx.runId, workflowId: ctx.workflowId, nodeId: ctx.nodeId, values: ctx.values } : null
}

// entityContext narrows to ONE family: contextSatisfies only compares
// the discriminant, so `configure.list.delete` handed a request's
// context would otherwise pass its `needs` check. Every command the
// row-command factory mints answers through this, so a family's
// command can never act on another family's row.
export function entityContext(ctx: CommandContext | undefined, entity: string): { id: string } | null {
  return ctx?.kind === 'entity' && ctx.entity === entity ? { id: ctx.id } : null
}

export function entryContext(ctx: CommandContext | undefined): { entryId: string; pinned?: boolean } | null {
  return ctx?.kind === 'entry' ? { entryId: ctx.entryId, pinned: ctx.pinned } : null
}

export function listGridContext(ctx: CommandContext | undefined): { listID: string; rowIDs: string[]; columnKey?: string; text?: string } | null {
  return ctx?.kind === 'listGrid' ? { listID: ctx.listID, rowIDs: ctx.rowIDs, columnKey: ctx.columnKey, text: ctx.text } : null
}
