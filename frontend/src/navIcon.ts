import {
  BookIcon,
  CommentDiscussionIcon,
  HistoryIcon,
  PlayIcon,
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
// would have no real opinion on.
export const CAPABILITY_ICON: Record<string, Icon> = {
  'runbook-page': PlayIcon,
  'activity-log': PulseIcon,
  'copilot-bridge': CommentDiscussionIcon,
  'capability-composition': WorkflowIcon,
  connectors: PlugIcon,
  'process-tracking': HistoryIcon,
  guardrails: ShieldLockIcon,
}

// Spec isn't a capability (no build status), so it isn't in the map above --
// it gets its own fixed icon here instead.
export const SPEC_ICON: Icon = BookIcon
