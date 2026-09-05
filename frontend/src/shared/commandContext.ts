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
  // A row of a Configure inventory (goal 0306 S1): `entity` is the
  // family's own data-event name ("clientcert"), `id` the row. One
  // kind for every family rather than one per family -- the commands
  // acting on a row (edit, duplicate, delete) are the same three
  // everywhere, and a per-family kind would multiply the discriminant
  // without changing a single call site's shape.
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

export function entityContext(ctx: CommandContext | undefined): { entity: string; id: string } | null {
  return ctx?.kind === 'entity' ? { entity: ctx.entity, id: ctx.id } : null
}

export function entryContext(ctx: CommandContext | undefined): { entryId: string; pinned?: boolean } | null {
  return ctx?.kind === 'entry' ? { entryId: ctx.entryId, pinned: ctx.pinned } : null
}
