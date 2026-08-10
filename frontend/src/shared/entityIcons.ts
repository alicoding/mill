import { CheckCircleIcon, ListUnorderedIcon, PlugIcon, ServerIcon, WorkflowIcon, type Icon } from '@primer/octicons-react'

// Per-entity leading-visual identity for InventoryList.tsx rows
// (docs/goals/0007-resource-inventory-redesign.md): the ambient
// "recognition, not confirmation" cue the goal's acceptance bar names
// -- a distinct icon + background color per resource type, rendered as
// every row's LeadingVisual, so Workflows and Integrations (the two
// pages the owner actually confused) never share a silhouette again.
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
}

export const ENTITY_ICON: Record<string, EntityIcon> = {
  workflow: { Icon: WorkflowIcon, bg: 'var(--bgColor-done-emphasis)' },
  request: { Icon: PlugIcon, bg: 'var(--bgColor-accent-emphasis)' },
  list: { Icon: ListUnorderedIcon, bg: 'var(--bgColor-success-emphasis)' },
  mcpserver: { Icon: ServerIcon, bg: 'var(--bgColor-severe-emphasis)' },
  decision: { Icon: CheckCircleIcon, bg: 'var(--bgColor-sponsors-emphasis)' },
}
