import { z } from 'zod'

// Validates a draft workflow before Save, against the Wails-generated
// PascalCase wire shape (composition/models.ts) -- not idiomatic
// camelCase -- since this validates exactly what CreateWorkflow will
// receive. The out-degree and single-root checks mirror composition.go's
// own buildGraph/findRoot validation (a save-time error and a run-time
// error never disagree), but deliberately don't replicate its full
// reachability walk or Decision-edge expression/otherwise checks --
// CreateWorkflow/UpdateWorkflow call ValidateGraph server-side as the
// actual authority for those; this is a cheap client-side sanity check,
// same as the canvas's isValidConnection (CompositionCanvas.tsx) already
// is for disallowed shapes at draw-time, so a user hits this validation
// only in edge cases (e.g. deleting a node that leaves the graph
// disconnected).
const configSchema = z.record(z.string(), z.string())
const nodeSchema = z.object({
  ID: z.string().min(1),
  Kind: z.string(),
  NodeTypeID: z.string().min(1),
  Config: configSchema,
  Position: z.object({ X: z.number(), Y: z.number() }),
})
const edgeSchema = z.object({
  ID: z.string().min(1),
  Source: z.string().min(1),
  SourceHandle: z.string(),
  Target: z.string().min(1),
})
// A function, not a module-level constant: the validation messages are
// user-facing copy (docs/goals/0032-copy-management.md), and zod's own
// message strings are baked in at schema-construction time -- so the
// schema is (cheaply) rebuilt per save with the caller's current `t`,
// rather than trying to retrofit i18n into a frozen schema object.
export function buildDraftWorkflowSchema(t: (key: string) => string) {
  return z
    .object({
      Label: z.string().trim().min(1, t('draftWorkflowSchema.needsLabel')),
      Description: z.string(),
      Nodes: z.array(nodeSchema).min(1, t('draftWorkflowSchema.needsAtLeastOneNode')),
      Edges: z.array(edgeSchema),
    })
    .superRefine((draft, ctx) => {
      const ids = new Set(draft.Nodes.map((n) => n.ID))
      const kindByID = new Map(draft.Nodes.map((n) => [n.ID, n.Kind]))
      const outDegree = new Map<string, number>()
      const hasIncoming = new Set<string>()
      for (const e of draft.Edges) {
        if (!ids.has(e.Source) || !ids.has(e.Target)) {
          ctx.addIssue({ code: 'custom', message: t('draftWorkflowSchema.danglingConnection') })
        }
        outDegree.set(e.Source, (outDegree.get(e.Source) ?? 0) + 1)
        hasIncoming.add(e.Target)
      }
      for (const [id, count] of outDegree) {
        // A terminal node (docs/adr/0027 -- code kind "terminal", the
        // user-facing "Decision" node) may have NO outgoing connection at
        // all -- checked before the >1 rule below, since that rule alone
        // would accept exactly one outgoing edge from a terminal node.
        if (count > 0 && kindByID.get(id) === 'terminal') {
          ctx.addIssue({ code: 'custom', message: t('draftWorkflowSchema.terminalCannotHaveOutgoing') })
        }
        if (count > 1 && kindByID.get(id) !== 'decision') {
          ctx.addIssue({ code: 'custom', message: t('draftWorkflowSchema.onlyBranchCanFanOut') })
        }
      }
      if (draft.Nodes.filter((n) => !hasIncoming.has(n.ID)).length !== 1) {
        ctx.addIssue({ code: 'custom', message: t('draftWorkflowSchema.needsExactlyOneStart') })
      }
    })
}
