import {
  DatabaseIcon, DownloadIcon, GitBranchIcon, PlayIcon, ShieldIcon, SparkleFillIcon, SyncIcon, UploadIcon, ZapIcon,
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
  | 'flow'
  | 'guardrails'
  | 'apply'

// Display order, top to bottom -- roughly the shape of a workflow
// reading top to bottom (starts with a Trigger, captures/transforms/
// enriches data, acts, branches, is guarded, ends by applying a
// result), not alphabetical.
export const PALETTE_GROUP_ORDER: PaletteGroupId[] = [
  'triggers', 'capture', 'transform', 'ai', 'data', 'actions', 'flow', 'guardrails', 'apply',
]

export const PALETTE_GROUP_LABEL: Record<PaletteGroupId, string> = {
  triggers: 'Triggers',
  capture: 'Capture',
  transform: 'Transform',
  ai: 'AI',
  data: 'Data',
  actions: 'Actions',
  flow: 'Flow',
  guardrails: 'Guardrails',
  apply: 'Apply',
}

// Group-header icons -- a THEME icon per group, deliberately not a
// per-item Kind-colored square anymore: two of the 9 display groups
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
  flow: GitBranchIcon,
  guardrails: ShieldIcon,
  apply: UploadIcon,
}

// Every registered NodeType ID as of this change (internal/domain/
// composition/*.go's RegisterNodeType call sites, checked directly
// against the Go registry, not guessed) -- 39 total, every one
// accounted for. vitest (paletteGroups.test.ts) asserts every ID
// NodeTypes() actually returns has an entry here, so this map can't
// silently drift from the backend registry.
const NODE_TYPE_GROUP: Record<string, PaletteGroupId> = {
  // Triggers (8)
  'trigger-manual': 'triggers',
  'trigger-hotkey': 'triggers',
  'trigger-schedule': 'triggers',
  'trigger-clipboard-watch': 'triggers',
  'trigger-filesystem-watch': 'triggers',
  'trigger-callable': 'triggers',
  'trigger-system-event': 'triggers',
  'trigger-atlas-card': 'triggers',
  // Capture (4)
  'capture-clipboard-html': 'capture',
  'capture-clipboard-info': 'capture',
  'capture-file': 'capture',
  'capture-attribute': 'capture',
  // Transform (3)
  'process-extract-html': 'transform',
  'process-html-to-markdown': 'transform',
  'process-inject-text': 'transform',
  // AI (3)
  'process-ai-classify': 'ai',
  'process-ai-completion': 'ai',
  'process-ai-extract-structured': 'ai',
  // Data (5)
  'list-lookup': 'data',
  'list-search': 'data',
  'process-run-receipt': 'data',
  'process-atlas-card-find': 'data',
  'process-todo-scan': 'data',
  // Actions (3)
  'integration-http': 'actions',
  'mcp-tool-call': 'actions',
  'code-execution': 'actions',
  // Flow (2)
  'child-workflow': 'flow',
  'decision-route': 'flow',
  // Guardrails (3)
  'human-review': 'guardrails',
  'ruleset': 'guardrails',
  'decision-outcome': 'guardrails',
  // Apply (7)
  'apply-clipboard-write-html': 'apply',
  'apply-clipboard-write-text': 'apply',
  'apply-file-write': 'apply',
  'apply-file-move': 'apply',
  'apply-atlas-card-create': 'apply',
  'apply-atlas-card-update': 'apply',
  'apply-atlas-card-link': 'apply',
  'apply-list-row': 'apply',
  // Declared step types (ADR-0037, goal 0054 slice A): data-backed, not
  // a RegisterNodeType call site, so not counted in this map's "31
  // registered node types" total above -- the seeded "Check httpbin"
  // example still needs its own group entry, same as any built-in, so
  // it renders under its real group instead of paletteGroupFor's
  // Kind-fallback path.
  'example-check-httpbin-step': 'actions',
}

// Fallback for a NodeType ID this map hasn't been updated for yet
// (a new node type shipped without a matching palette-group entry) --
// nearest Kind-based group rather than a crash or a silently hidden
// item. `process` alone spans 5 of the 9 display groups above, so
// this is a best-effort landing spot, not a claim of correctness --
// paletteGroupFor warns to the dev console specifically so the real
// fix (adding a NODE_TYPE_GROUP entry) gets noticed during
// development, not silently shipped.
const KIND_FALLBACK_GROUP: Record<string, PaletteGroupId> = {
  trigger: 'triggers',
  capture: 'capture',
  process: 'actions',
  apply: 'apply',
  decision: 'flow',
  terminal: 'guardrails',
}

// Structural (ID/Kind/PaletteGroup as plain strings), not
// `Pick<NodeType, ...>` -- this is a plain string-keyed lookup with no
// real dependency on NodeKind's enum type, and staying structural lets
// the vitest suite exercise the fallback path with an
// intentionally-unknown Kind string without needing to import/cast the
// generated enum.
export function paletteGroupFor(nt: { ID: string; Kind: string; PaletteGroup?: string }): PaletteGroupId {
  // A declared step type (ADR-0037, goal 0054) is authored at runtime,
  // so it can never have a compile-time NODE_TYPE_GROUP entry below --
  // its own chosen group (composition.NodeType.PaletteGroup, empty for
  // every built-in) is the only place its real group can come from.
  // Checked first, no console.warn: this isn't a missing-mapping gap,
  // it's the declared-type path working as designed.
  if (nt.PaletteGroup && (PALETTE_GROUP_ORDER as string[]).includes(nt.PaletteGroup)) {
    return nt.PaletteGroup as PaletteGroupId
  }
  const known = NODE_TYPE_GROUP[nt.ID]
  if (known) return known
  console.warn(`[NodePalette] NodeType "${nt.ID}" (Kind "${nt.Kind}") has no palette display-group mapping -- add it to NODE_TYPE_GROUP in composition/paletteGroups.ts. Falling back to its Kind's nearest group.`)
  return KIND_FALLBACK_GROUP[nt.Kind] ?? 'actions'
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
