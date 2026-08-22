// One barrel over the generated Wails service bindings, so app code
// imports every bound-service namespace and common model type from one
// place instead of deep generated paths -- a future Go service-package
// move (which changes every generated binding path) becomes a one-file
// change here, not an every-consumer rewrite. Domain-model imports
// (bindings/.../internal/domain/*, internal/adapters/*) are unaffected
// by service moves and stay direct.
export { AtlasService } from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc'
export type {
  ClipbridgeCardOffer,
  ClipbridgeReplyPreview,
} from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc'
export type {
  FolderImportSummary,
  FolderScanEntry,
  FolderScanResult,
  ImportFolderSuggestionsRequest,
} from '../../bindings/github.com/alicoding/mill/internal/services/atlassvc'
export { BackupService } from '../../bindings/github.com/alicoding/mill/internal/services/backupsvc'
export type {
  BackupStatus,
  FamilySummary,
  ImportEverythingSummary,
} from '../../bindings/github.com/alicoding/mill/internal/services/backupsvc'
export { CapabilitiesService } from '../../bindings/github.com/alicoding/mill/internal/services/capabilitysvc'
export { DocsService } from '../../bindings/github.com/alicoding/mill/internal/services/docssvc'
export { CompanionService } from '../../bindings/github.com/alicoding/mill/internal/services/companionsvc'
export type {
  ChatMessage as CompanionChatMessage,
  CompanionDelta,
  CompanionReply,
} from '../../bindings/github.com/alicoding/mill/internal/services/companionsvc'
export { CompositionService } from '../../bindings/github.com/alicoding/mill/internal/services/compositionsvc'
export {
  ClipboardApplyAction,
  ClipboardApplyKind,
} from '../../bindings/github.com/alicoding/mill/internal/services/compositionsvc'
export type {
  ClipboardApplyPreview,
  ClipboardUnresolvedRef,
} from '../../bindings/github.com/alicoding/mill/internal/services/compositionsvc'
export { ConfigureService } from '../../bindings/github.com/alicoding/mill/internal/services/configuresvc'
export type {
  TestHTTPRequestInput,
  TestHTTPRequestResult,
} from '../../bindings/github.com/alicoding/mill/internal/services/configuresvc'
export {
  ExecutionService,
  RunKind,
} from '../../bindings/github.com/alicoding/mill/internal/services/executionsvc'
export type {
  AmbientMetric,
  AvgDurationMetric,
  DailyBucket,
  ErrorRateMetric,
  GuardrailPendingChanged,
  HomeMetrics,
  PendingApproval,
  RunDetail,
  RunStep,
  RunSummary,
  StepFailureCount,
  TimeSavedMetric,
  WorkflowTimeSaved,
  WorkflowUsage,
} from '../../bindings/github.com/alicoding/mill/internal/services/executionsvc'
export { GuardrailService } from '../../bindings/github.com/alicoding/mill/internal/services/guardrailsvc'
export type { RuleTestResult } from '../../bindings/github.com/alicoding/mill/internal/services/guardrailsvc'
export { Effect as GuardrailEffect } from '../../bindings/github.com/alicoding/mill/internal/domain/guardrail/models'
export type { Rule as GuardrailRule } from '../../bindings/github.com/alicoding/mill/internal/domain/guardrail/models'
export type { MCPWriteActivity, MCPWriteRequest, MCPWriteResolved } from '../../bindings/github.com/alicoding/mill/internal/services/mcpsvc'
export { SettingsService } from '../../bindings/github.com/alicoding/mill/internal/services/settingssvc'
export type {
  BuildInfo,
  UpdateCheckResult,
} from '../../bindings/github.com/alicoding/mill/internal/services/settingssvc'
// GetWorkflowMinutesSaved/ListWorkflowMinutesSaved/SetWorkflowMinutesSaved
// (docs/goals/0014-home-dashboard.md) are plain SettingsService methods,
// already covered by the `export { SettingsService }` line above -- no
// separate export needed, same as every other RPC on that service.
export { TriggerService } from '../../bindings/github.com/alicoding/mill/internal/services/triggersvc'
export type { HotkeyActivity } from '../../bindings/github.com/alicoding/mill/internal/services/triggersvc'
