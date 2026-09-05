import { describe, expect, it } from 'vitest'
import { clientCertStatusText, clientCertStatusVariant, isWildcardHost } from './clientCertStatus'
import { State } from '../../bindings/github.com/alicoding/mill/internal/domain/clientcert/models'

// The key path and its parameters, so a renamed key fails here rather
// than showing a reader a raw key path.
const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key)

const status = (state: State, daysLeft = 0) => ({
  id: 'c1', state, daysLeft, subject: '', issuer: '', notBefore: '', notAfter: '',
})

describe('clientCertStatusText', () => {
  it('names every state, and treats an unknown entity as incomplete', () => {
    expect(clientCertStatusText(status(State.StateReady), t)).toBe('configureClientCerts.status.ready')
    expect(clientCertStatusText(status(State.StateExpiring, 7), t)).toBe('configureClientCerts.status.expiring:{"days":7}')
    expect(clientCertStatusText(status(State.StateExpired), t)).toBe('configureClientCerts.status.expired')
    expect(clientCertStatusText(status(State.StateUnreadable), t)).toBe('configureClientCerts.status.unreadable')
    expect(clientCertStatusText(status(State.StateIncomplete), t)).toBe('configureClientCerts.status.incomplete')
    expect(clientCertStatusText(undefined, t)).toBe('configureClientCerts.status.incomplete')
  })
})

describe('clientCertStatusVariant', () => {
  it('reserves danger for a certificate that cannot work right now', () => {
    expect(clientCertStatusVariant(status(State.StateReady))).toBe('success')
    expect(clientCertStatusVariant(status(State.StateExpiring, 3))).toBe('caution')
    expect(clientCertStatusVariant(status(State.StateExpired))).toBe('danger')
    expect(clientCertStatusVariant(status(State.StateUnreadable))).toBe('danger')
    expect(clientCertStatusVariant(undefined)).toBe('neutral')
  })
})

describe('isWildcardHost', () => {
  it('is true only for a leftmost wildcard, which names no host to connect to', () => {
    expect(isWildcardHost('*.example.com')).toBe(true)
    expect(isWildcardHost('  *.example.com ')).toBe(true)
    expect(isWildcardHost('api.example.com')).toBe(false)
    expect(isWildcardHost('')).toBe(false)
  })
})
