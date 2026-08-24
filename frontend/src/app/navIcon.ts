import {
  BookIcon,
  HomeIcon,
  KeyIcon,
  PlugIcon,
  ProjectIcon,
  PulseIcon,
  ShieldCheckIcon,
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
  'capability-home': HomeIcon,
  'activity-log': PulseIcon,
  'capability-composition': WorkflowIcon,
  'capability-configure': PlugIcon,
  'capability-atlas': ProjectIcon,
  'capability-review': ShieldCheckIcon,
  'capability-docs': BookIcon,
  'capability-secrets': KeyIcon,
}
