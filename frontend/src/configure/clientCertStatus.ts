import type { Status } from '../../bindings/github.com/alicoding/mill/internal/domain/clientcert/models'
import { State } from '../../bindings/github.com/alicoding/mill/internal/domain/clientcert/models'
import type { StatusStampVariant } from '../shared/StatusStamp'

// One row's status, in the two forms a surface needs it: the sentence
// fragment the pill shows, and the pill's own colour. Pure, so the
// mapping is tested once instead of re-asserted per surface.

export function clientCertStatusText(status: Status | undefined, t: (key: string, params?: Record<string, unknown>) => string): string {
  switch (status?.state) {
    case State.StateReady:
      return t('configureClientCerts.status.ready')
    case State.StateExpiring:
      return t('configureClientCerts.status.expiring', { days: status.daysLeft })
    case State.StateExpired:
      return t('configureClientCerts.status.expired')
    case State.StateUnreadable:
      return t('configureClientCerts.status.unreadable')
    default:
      return t('configureClientCerts.status.incomplete')
  }
}

export function clientCertStatusVariant(status: Status | undefined): StatusStampVariant {
  switch (status?.state) {
    case State.StateReady:
      return 'success'
    case State.StateExpiring:
      return 'caution'
    case State.StateExpired:
    case State.StateUnreadable:
      return 'danger'
    default:
      return 'neutral'
  }
}

// A wildcard names a family of hosts, so there is nothing for the Test
// button to connect to.
export function isWildcardHost(host: string): boolean {
  return host.trim().startsWith('*.')
}
