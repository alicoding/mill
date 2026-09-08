import {
  BrowserIcon, DatabaseIcon, DownloadIcon, GitBranchIcon, PlayIcon, ShieldIcon, SparkleFillIcon, SyncIcon, UploadIcon,
  ZapIcon,
  type Icon,
} from '@primer/octicons-react'
import type { NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// Design wave 3 (goal 0001, audit §5): the palette's real IA problem
// wasn't rendering (TreeView, wave-1 fix) -- it was grouping strictly
// by domain Kind (Trigger/Capture/Process/Apply/Decision/Terminal,
// composition/nodeKind.ts), which is a real, LOCKED backend concept
// (SPEC.md §3.4) but a poor navigation axis: 14 of Mill's 29 node
// types share the single `process` Kind (AI nodes, list nodes,
// integration/MCP/code-exec, child-workflow, human-review, ruleset --
// everything that isn't literally capture/apply/trigger/route/
// terminal), so a Kind-grouped palette put "AI: Classify" and "List:
// lookup" and "MCP: tool call" in one undifferentiated 14-item bucket.
// This file is a frontend DISPLAY map only -- domain Kinds
// (nodeKind.ts) are UNTOUCHED, still what the backend/canvas-color
// system reasons about; PaletteGroupId is presentation-only.
//
// Lives in shared/, not composition/, despite composition/NodePalette.tsx
// being its original and still-primary consumer: the step designer
// (configure/ConfigureStepTypes.tsx, goal 0054 slice B) needs the same
// group id/label/order to offer as a step type's palette-group choice,
// and configure/ may not depend on composition/
// (.claude/rules/frontend.md's dependency-cruiser boundary) -- the
// "used by 2+ bounded contexts" bar that rule sets for promoting a file
// into shared/.
export type PaletteGroupId =
  | 'triggers'
  | 'capture'
  | 'transform'
  | 'ai'
  | 'data'
  | 'actions'
  | 'browser'
  | 'flow'
  | 'guardrails'
  | 'apply'

// Display order, top to bottom -- roughly the shape of a workflow
// reading top to bottom (starts with a Trigger, captures/transforms/
// enriches data, acts, branches, is guarded, ends by applying a
// result), not alphabetical.
export const PALETTE_GROUP_ORDER: PaletteGroupId[] = [
  'triggers', 'capture', 'transform', 'ai', 'data', 'actions', 'browser', 'flow', 'guardrails', 'apply',
]

export const PALETTE_GROUP_LABEL: Record<PaletteGroupId, string> = {
  triggers: 'Triggers',
  capture: 'Capture',
  transform: 'Transform',
  ai: 'AI',
  data: 'Data',
  actions: 'Actions',
  browser: 'Browser',
  flow: 'Flow',
  guardrails: 'Guardrails',
  apply: 'Apply',
}

// Group-header icons -- a THEME icon per group, deliberately not a
// per-item Kind-colored square anymore: two of the 10 display groups
// (`flow`: child-workflow is Kind `process`, decision-route is Kind
// `decision`; `guardrails`: human-review/ruleset are Kind `process`,
// decision-outcome is Kind `terminal`) mix domain Kinds, so a single
// Kind-derived color for the whole group would be arbitrary/wrong for
// some of its own members. Reuses icons already established elsewhere
// in the app for the same concept where one exists (ShieldIcon for
// guardrails -- ReviewView.tsx/NodeGuardrailSection.tsx; SparkleFillIcon
// for AI -- ConfigureAIProviders.tsx; DatabaseIcon for Data, matching
// List entities) rather than inventing a parallel icon vocabulary.
export const PALETTE_GROUP_ICON: Record<PaletteGroupId, Icon> = {
  triggers: ZapIcon,
  capture: DownloadIcon,
  transform: SyncIcon,
  ai: SparkleFillIcon,
  data: DatabaseIcon,
  actions: PlayIcon,
  browser: BrowserIcon,
  flow: GitBranchIcon,
  guardrails: ShieldIcon,
  apply: UploadIcon,
}

// paletteGroupFor reads the group straight off the NodeType descriptor
// (composition.NodeType.PaletteGroup, goal 0389) instead of a
// hand-kept ID-keyed map: the backend registry is the one place a node
// type's group is authored now, for a built-in (every RegisterNodeType
// call site sets it, enforced by TestNodeTypes) exactly like a declared
// step type (ADR-0037, its own author-chosen group carried through
// resolveDeclaredEntry) or a plugin-contributed one (pluginservice_steps.go).
// A missing/invalid value can therefore only mean a real registry bug,
// not an unmaintained frontend list -- warned loudly rather than
// silently mis-grouped.
export function paletteGroupFor(nt: { ID: string; Kind: string; PaletteGroup: string }): PaletteGroupId {
  if ((PALETTE_GROUP_ORDER as string[]).includes(nt.PaletteGroup)) {
    return nt.PaletteGroup as PaletteGroupId
  }
  console.warn(`[NodePalette] NodeType "${nt.ID}" (Kind "${nt.Kind}") has an invalid PaletteGroup ${JSON.stringify(nt.PaletteGroup)}. The registry should never emit this; falling back to Actions.`)
  return 'actions'
}

// Built-in NodeType labels are now verb-first with no prefix (goal
// 0113 -- "Classify with AI", "Look up list row"), so shortLabel is a
// no-op for them; a declared/legacy step type may still author the
// older "<Word(s)>: <specifics>" colon style, and this strip keeps
// that case from showing its redundant group prefix once a display
// GROUP header already supplies that context. A generic
// strip-up-to-first-colon, not a Kind- or Group-keyed prefix lookup
// (wave 1's original version computed the prefix from
// KIND_LABEL[nt.Kind], which silently failed to strip most labels
// here -- e.g. Kind `process`'s "Process: " prefix never matched
// richer, non-Kind prefixes some labels used). nt.Label itself (canvas
// node cards, the saved-workflow step chips -- both need the full
// self-contained name since a card has no surrounding group context)
// is untouched; this is a display-only transform for the palette
// specifically.
export function shortLabel(nt: Pick<NodeType, 'Label'>): string {
  const short = nt.Label.replace(/^[^:]+:\s*/, '')
  return short.charAt(0).toUpperCase() + short.slice(1)
}
