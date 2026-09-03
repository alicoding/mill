import {
  AppsIcon, CheckCircleIcon, KeyIcon, ListUnorderedIcon, PackageIcon, PlugIcon, ServerIcon, SparkleFillIcon, TerminalIcon, WorkflowIcon, type Icon, LockIcon } from '@primer/octicons-react'

// Per-entity leading-visual identity for InventoryList.tsx rows
// (docs/goals/0007-resource-inventory-redesign.md): the ambient
// "recognition, not confirmation" cue the goal's acceptance bar names
// -- a distinct icon + background color per resource type, rendered as
// every row's LeadingVisual, so Workflows and Integrations (two
// visually similar list pages) never share a silhouette again.
//
// Follows the same icon+bg-token pairing composition/nodeKind.ts
// already established for node kinds (KIND_ICON/KIND_ICON_BG) rather
// than inventing a new visual language. Kept as its own small map here
// instead of importing nodeKind.ts directly: shared/ is a
// dependency-cruiser leaf (.claude/rules/frontend.md) that composition/
// and configure/ both import from, never the reverse, so shared/ can't
// depend on composition/nodeKind.ts. `decision`'s entry intentionally
// duplicates nodeKind.ts's own `terminal` kind values (CheckCircleIcon,
// --bgColor-sponsors-emphasis) for that reason -- a Decision (ADR-0027's
// terminal outcome) is visually the same "settled/done" concept there.
export interface EntityIcon {
  Icon: Icon
  bg: string
  fg: string
}

// Soft-tint (not saturated-emphasis) leading visuals. `-emphasis` tokens
// are full-saturation solid fills meant for ONE high-emphasis element on
// a screen (a primary button); repeated as a solid block down every row
// of a long inventory they read as loud and "hard on the eyes". The
// industry-standard list-icon pattern
// (Linear/GitHub/Notion) is a low-saturation `-muted` tint background
// with the glyph in the MATCHING `-fg` color, not white-on-saturated --
// same per-entity recognition hue, far calmer. Each bg/fg pair is one of
// Primer's own status-color families (the same pairs its Label component
// uses), so contrast is already vetted in both light and dark themes.
export const ENTITY_ICON: Record<string, EntityIcon> = {
  workflow: { Icon: WorkflowIcon, bg: 'var(--bgColor-done-muted)', fg: 'var(--fgColor-done)' },
  request: { Icon: PlugIcon, bg: 'var(--bgColor-accent-muted)', fg: 'var(--fgColor-accent)' },
  list: { Icon: ListUnorderedIcon, bg: 'var(--bgColor-success-muted)', fg: 'var(--fgColor-success)' },
  mcpserver: { Icon: ServerIcon, bg: 'var(--bgColor-severe-muted)', fg: 'var(--fgColor-severe)' },
  decision: { Icon: CheckCircleIcon, bg: 'var(--bgColor-sponsors-muted)', fg: 'var(--fgColor-sponsors)' },
  execenv: { Icon: TerminalIcon, bg: 'var(--bgColor-attention-muted)', fg: 'var(--fgColor-attention)' },
  aiprovider: { Icon: SparkleFillIcon, bg: 'var(--bgColor-open-muted)', fg: 'var(--fgColor-open)' },
  steptype: { Icon: PackageIcon, bg: 'var(--bgColor-neutral-muted)', fg: 'var(--fgColor-neutral)' },
  secret: { Icon: KeyIcon, bg: 'var(--bgColor-danger-muted)', fg: 'var(--fgColor-danger)' },
  // secretsource (ADR-0050): a store Mill reads secrets through.
  secretsource: { Icon: LockIcon, bg: 'var(--bgColor-danger-muted)', fg: 'var(--fgColor-danger)' },
  // plugin (docs/goals/0290): a plugin-owned work tab's visual.
  plugin: { Icon: AppsIcon, bg: 'var(--bgColor-neutral-muted)', fg: 'var(--fgColor-muted)' },
}
