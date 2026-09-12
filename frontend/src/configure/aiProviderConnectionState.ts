import {
  AuthenticationStatus,
  CheckStatus,
  PermissionStatus,
  TransportStatus,
  type Report,
} from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'

export type AIProviderConnectionState =
  | 'notChecked'
  | 'awaitingApproval'
  | 'checking'
  | 'responded'
  | 'unreachable'
  | 'secretUnavailable'
  | 'invalidAddress'
  | 'accessRejected'
  | 'notAllowed'
  | 'cancelled'
  | 'timedOut'

type ConnectionEvidence = Pick<Report, 'lifecycle' | 'permission' | 'transport' | 'authentication' | 'reasonCodes'>

// Metadata connectivity and operation support are separate evidence. In
// particular, a responding metadata endpoint cannot make a feature tested.
export function aiProviderConnectionState(report: ConnectionEvidence | null | undefined): AIProviderConnectionState {
  if (!report) return 'notChecked'
  switch (report.lifecycle) {
    case CheckStatus.CheckNotStarted: return 'notChecked'
    case CheckStatus.CheckAwaitingApproval: return 'awaitingApproval'
    case CheckStatus.CheckChecking: return 'checking'
    case CheckStatus.CheckCancelled: return 'cancelled'
    case CheckStatus.CheckTimedOut: return 'timedOut'
  }

  const reasons = report.reasonCodes ?? []
  if (report.permission.status === PermissionStatus.PermissionDenied
    || reasons.includes('permission-denied')
    || reasons.includes('policy-check-failed')
    || reasons.includes('policy-service-unwired')) return 'notAllowed'

  // Secret resolution may fail after the backend entered TransportChecking.
  // Lifecycle is terminal at that point; transport alone would spin forever.
  if (reasons.includes('secret-resolution-failed')) return 'secretUnavailable'
  if (report.transport === TransportStatus.TransportInvalidConfiguration) return 'invalidAddress'
  if (report.authentication === AuthenticationStatus.AuthenticationRejected) return 'accessRejected'
  if (report.transport === TransportStatus.TransportUnreachable) return 'unreachable'
  if (report.transport === TransportStatus.TransportResponded) return 'responded'
  return 'notChecked'
}
