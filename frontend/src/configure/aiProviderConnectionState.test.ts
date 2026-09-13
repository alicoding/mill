import { describe, expect, it } from 'vitest'
import {
  AuthenticationStatus,
  CheckStatus,
  PermissionStatus,
  TransportStatus,
} from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import { aiProviderConnectionState } from './aiProviderConnectionState'

type ConnectionEvidence = NonNullable<Parameters<typeof aiProviderConnectionState>[0]>

function evidence(overrides: Partial<ConnectionEvidence> = {}): ConnectionEvidence {
  return {
    transport: TransportStatus.TransportUnchecked,
    authentication: AuthenticationStatus.AuthenticationUnknown,
    permission: { status: PermissionStatus.PermissionAllowed, source: '', ruleId: '', ruleLabel: '' },
    reasonCodes: [], lifecycle: CheckStatus.CheckCompleted,
    ...overrides,
  }
}

describe('aiProviderConnectionState', () => {
  it('shows no inspection as unchecked even when there is other evidence', () => {
    expect(aiProviderConnectionState(undefined)).toBe('notChecked')
    expect(aiProviderConnectionState(evidence({ lifecycle: CheckStatus.CheckNotStarted }))).toBe('notChecked')
  })

  it.each([
    [CheckStatus.CheckAwaitingApproval, 'awaitingApproval'],
    [CheckStatus.CheckChecking, 'checking'],
    [CheckStatus.CheckCancelled, 'cancelled'],
    [CheckStatus.CheckTimedOut, 'timedOut'],
  ] as const)('gives lifecycle %s precedence over intermediate transport state', (lifecycle, expected) => {
    expect(aiProviderConnectionState(evidence({ lifecycle, transport: TransportStatus.TransportChecking }))).toBe(expected)
  })

  it.each(['permission-denied', 'policy-check-failed', 'policy-service-unwired'])('surfaces %s before transport', (reason) => {
    expect(aiProviderConnectionState(evidence({ reasonCodes: [reason], transport: TransportStatus.TransportChecking }))).toBe('notAllowed')
  })

  it('finishes the spinner when secret resolution fails', () => {
    expect(aiProviderConnectionState(evidence({ reasonCodes: ['secret-resolution-failed'], transport: TransportStatus.TransportChecking }))).toBe('secretUnavailable')
  })

  it('honors explicit permission denial even without a reason code', () => {
    expect(aiProviderConnectionState(evidence({
      permission: { status: PermissionStatus.PermissionDenied, source: '', ruleId: '', ruleLabel: '' },
      transport: TransportStatus.TransportResponded,
      reasonCodes: null,
    }))).toBe('notAllowed')
  })

  it('keeps denial ahead of a secret or metadata failure', () => {
    expect(aiProviderConnectionState(evidence({
      reasonCodes: ['permission-denied', 'secret-resolution-failed'],
      authentication: AuthenticationStatus.AuthenticationRejected,
      transport: TransportStatus.TransportResponded,
    }))).toBe('notAllowed')
  })

  it('distinguishes address, authentication and reachability failures', () => {
    expect(aiProviderConnectionState(evidence({ transport: TransportStatus.TransportInvalidConfiguration }))).toBe('invalidAddress')
    expect(aiProviderConnectionState(evidence({ transport: TransportStatus.TransportResponded, authentication: AuthenticationStatus.AuthenticationRejected }))).toBe('accessRejected')
    expect(aiProviderConnectionState(evidence({ transport: TransportStatus.TransportUnreachable }))).toBe('unreachable')
  })

  it.each(['metadata-api-unsupported', 'metadata-response-malformed', 'metadata-available', 'selected-model-not-listed'])('keeps %s separate from feature support', (reason) => {
    expect(aiProviderConnectionState(evidence({ transport: TransportStatus.TransportResponded, reasonCodes: [reason] }))).toBe('responded')
  })

  it('accepts nullable reason codes without inventing an outcome', () => {
    expect(aiProviderConnectionState(evidence({ reasonCodes: null }))).toBe('notChecked')
  })
})
