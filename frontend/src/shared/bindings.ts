// One barrel over the generated Wails service bindings, so app code
// imports every bound-service namespace and common model type from one
// place instead of deep generated paths -- a future Go service-package
// move (which changes every generated binding path) becomes a one-file
// change here, not an every-consumer rewrite. Domain-model imports
// (bindings/.../internal/domain/*, internal/adapters/*) are unaffected
// by service moves and stay direct.
export { CapabilitiesService } from '../../bindings/github.com/alicoding/mill/internal/services/capabilitysvc'
export { CompositionService } from '../../bindings/github.com/alicoding/mill/internal/services/compositionsvc'
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
  PendingApproval,
  RunDetail,
  RunStep,
  RunSummary,
} from '../../bindings/github.com/alicoding/mill/internal/services/executionsvc'
export { GuardrailService } from '../../bindings/github.com/alicoding/mill/internal/services/guardrailsvc'
export type { RuleTestResult } from '../../bindings/github.com/alicoding/mill/internal/services/guardrailsvc'
export type { MCPWriteRequest } from '../../bindings/github.com/alicoding/mill/internal/services/mcpsvc'
export { SettingsService } from '../../bindings/github.com/alicoding/mill/internal/services/settingssvc'
export type {
  BuildInfo,
  UpdateCheckResult,
} from '../../bindings/github.com/alicoding/mill/internal/services/settingssvc'
export { TriggerService } from '../../bindings/github.com/alicoding/mill/internal/services/triggersvc'
export type { HotkeyActivity } from '../../bindings/github.com/alicoding/mill/internal/services/triggersvc'
