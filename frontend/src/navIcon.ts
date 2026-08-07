import {
  BookIcon,
  CommentDiscussionIcon,
  HistoryIcon,
  PlugIcon,
  PulseIcon,
  ShieldLockIcon,
  WorkflowIcon,
  type Icon,
} from '@primer/octicons-react'

// Frontend-owned, keyed by Capability.ID (internal/domain/capabilities) --
// same pattern as nodeKind.ts's KIND_ICON map for Composition node types.
// CapabilitiesService.List() stays plain ID/Label/Status data; icons are
// presentation, decided here rather than adding an IconName field Go
// would have no real opinion on. No 'runbook-page' entry: that page is
// retired (docs/SPEC.md §2.2's Update note) -- capability-composition is
// its successor and already has its own icon below.
export const CAPABILITY_ICON: Record<string, Icon> = {
  'activity-log': PulseIcon,
  'copilot-bridge': CommentDiscussionIcon,
  'capability-composition': WorkflowIcon,
  'capability-configure': PlugIcon,
  'process-tracking': HistoryIcon,
  guardrails: ShieldLockIcon,
}

// Spec isn't a capability (no build status), so it isn't in the map above --
// it gets its own fixed icon here instead.
export const SPEC_ICON: Icon = BookIcon
