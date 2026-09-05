import { describe, expect, it } from 'vitest'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { authConfigFrom, draftFrom, EMPTY_DRAFT, joseConfigFrom, type RequestDraft } from './requestDraft'

// docs/goals/0025 item 8: authConfigFrom/joseConfigFrom/draftFrom had no
// direct unit coverage despite being the exact seam ADR-0015/Phase 3's
// 9-AuthType catalogue and JOSE toggle round-trip through -- a wrong
// mapping here would either silently drop a request's real auth config
// or (worse) send the wrong one. Covers every AuthType, JOSE on and
// off, and that a request's secret REFERENCES round-trip through the
// form without ever becoming values (goal 0306).

function baseRequest(overrides: Partial<HTTPRequest> = {}): HTTPRequest {
  return {
    ID: 'req-1', Label: 'Test request', BaseURL: 'https://example.com', Method: 'GET', AuthType: AuthType.AuthNone,
    SecretRef: '', Headers: null, Body: '', Description: '', OpenAPISpec: '', Auth: null, JOSE: null, BuiltIn: false,
    CreatedAt: '', UpdatedAt: '',
    Seed: { SeedRevision: 0, Modified: false },
    ...overrides,
  }
}

describe('authConfigFrom', () => {
  it('returns null for AuthNone', () => {
    expect(authConfigFrom({ ...EMPTY_DRAFT, authType: AuthType.AuthNone })).toBeNull()
  })

  it('returns null for AuthAPIKey (secret-only, no non-secret config)', () => {
    expect(authConfigFrom({ ...EMPTY_DRAFT, authType: AuthType.AuthAPIKey })).toBeNull()
  })

  it('returns null for AuthBearer (secret-only, no non-secret config)', () => {
    expect(authConfigFrom({ ...EMPTY_DRAFT, authType: AuthType.AuthBearer })).toBeNull()
  })

  it('returns null for AuthQueryParam (secret-only, no non-secret config)', () => {
    expect(authConfigFrom({ ...EMPTY_DRAFT, authType: AuthType.AuthQueryParam })).toBeNull()
  })

  it('returns null for AuthOAuth1Vendor (a registered stub, no implemented config shape)', () => {
    expect(authConfigFrom({ ...EMPTY_DRAFT, authType: AuthType.AuthOAuth1Vendor })).toBeNull()
  })

  it('returns null for AuthMTLS (a registered stub, no implemented config shape)', () => {
    expect(authConfigFrom({ ...EMPTY_DRAFT, authType: AuthType.AuthMTLS })).toBeNull()
  })

  it('builds only the OAuth2 branch for AuthOAuth2, leaving HMAC/OAuth1 null', () => {
    const got = authConfigFrom({
      ...EMPTY_DRAFT, authType: AuthType.AuthOAuth2,
      oauth2TokenURL: 'https://example.com/token', oauth2ClientID: 'client-123', oauth2Scope: 'read write',
    })
    expect(got).toEqual({
      OAuth2: { GrantType: 'client_credentials', TokenURL: 'https://example.com/token', ClientID: 'client-123', Scope: 'read write', ContentType: '' },
      HMAC: null, OAuth1: null,
    })
  })

  it('builds only the HMAC branch for AuthHMAC, leaving OAuth2/OAuth1 null', () => {
    const got = authConfigFrom({ ...EMPTY_DRAFT, authType: AuthType.AuthHMAC, hmacHeaderName: 'X-Signature' })
    expect(got).toEqual({ OAuth2: null, HMAC: { HeaderName: 'X-Signature' }, OAuth1: null })
  })

  it('builds only the OAuth1 branch for AuthOAuth1, leaving OAuth2/HMAC null', () => {
    const got = authConfigFrom({ ...EMPTY_DRAFT, authType: AuthType.AuthOAuth1, oauth1ConsumerKey: 'ck', oauth1Token: 'tok', oauth1ConsumerSecretRef: 'vault:cs', oauth1TokenSecretRef: 'vault:ts' })
    expect(got).toEqual({ OAuth2: null, HMAC: null, OAuth1: { ConsumerKey: 'ck', Token: 'tok', ConsumerSecretRef: 'vault:cs', TokenSecretRef: 'vault:ts' } })
  })
})

describe('joseConfigFrom', () => {
  it('returns null when JOSE is disabled, regardless of what the other fields hold', () => {
    const got = joseConfigFrom({ ...EMPTY_DRAFT, joseEnabled: false, joseRecipientPublicKeyRef: 'vault:stale', joseDecryptResponse: true })
    expect(got).toBeNull()
  })

  it('builds a config with Algorithm/ContentEncryption left empty (domain-layer defaults apply) when enabled', () => {
    const got = joseConfigFrom({
      ...EMPTY_DRAFT, joseEnabled: true,
      joseRecipientPublicKeyRef: 'vault:public-key',
      joseDecryptResponse: true,
      josePrivateKeyRef: 'vault:private-key',
    })
    expect(got).toEqual({
      Enabled: true, Algorithm: '', ContentEncryption: '',
      RecipientPublicKeyRef: 'vault:public-key',
      DecryptResponse: true,
      PrivateKeyRef: 'vault:private-key',
    })
  })

  it('carries DecryptResponse: false through when enabled but response decryption is off', () => {
    const got = joseConfigFrom({ ...EMPTY_DRAFT, joseEnabled: true, joseRecipientPublicKeyRef: 'vault:pk', joseDecryptResponse: false })
    expect(got?.DecryptResponse).toBe(false)
  })

  it('drops the private key reference when response decryption is off -- an unused field never names a key', () => {
    const got = joseConfigFrom({ ...EMPTY_DRAFT, joseEnabled: true, joseRecipientPublicKeyRef: 'vault:pk', joseDecryptResponse: false, josePrivateKeyRef: 'vault:stale' })
    expect(got?.PrivateKeyRef).toBe('')
  })
})

describe('draftFrom', () => {
  it('carries every secret REFERENCE through, so an edit does not silently unname a credential', () => {
    const draft = draftFrom(baseRequest({
      AuthType: AuthType.AuthOAuth1,
      SecretRef: 'vault:s',
      Auth: { OAuth2: null, HMAC: null, OAuth1: { ConsumerKey: 'ck', Token: 'tok', ConsumerSecretRef: 'vault:cs', TokenSecretRef: 'vault:ts' } },
      JOSE: { Enabled: true, Algorithm: '', ContentEncryption: '', RecipientPublicKeyRef: 'vault:pub', DecryptResponse: true, PrivateKeyRef: 'vault:priv' },
    }))
    expect(draft.secretRef).toBe('vault:s')
    expect(draft.oauth1ConsumerSecretRef).toBe('vault:cs')
    expect(draft.oauth1TokenSecretRef).toBe('vault:ts')
    expect(draft.joseRecipientPublicKeyRef).toBe('vault:pub')
    expect(draft.josePrivateKeyRef).toBe('vault:priv')
  })

  it('leaves every reference empty for a request that names no secret yet', () => {
    const draft = draftFrom(baseRequest({ AuthType: AuthType.AuthBearer }))
    expect(draft.secretRef).toBe('')
    expect(draft.oauth1ConsumerSecretRef).toBe('')
    expect(draft.oauth1TokenSecretRef).toBe('')
    expect(draft.josePrivateKeyRef).toBe('')
  })

  it('defaults Method to GET when the stored request predates the field (empty string)', () => {
    const draft = draftFrom(baseRequest({ Method: '' }))
    expect(draft.method).toBe('GET')
  })

  it('preserves a real, non-GET Method verbatim', () => {
    const draft = draftFrom(baseRequest({ Method: 'QUERY' }))
    expect(draft.method).toBe('QUERY')
  })

  it('maps Auth.OAuth2 non-secret fields through for AuthOAuth2', () => {
    const r = baseRequest({
      AuthType: AuthType.AuthOAuth2,
      Auth: { OAuth2: { GrantType: 'client_credentials', TokenURL: 'https://x/token', ClientID: 'abc', Scope: 'read', ContentType: '' }, HMAC: null, OAuth1: null },
    })
    const draft = draftFrom(r)
    expect(draft.oauth2TokenURL).toBe('https://x/token')
    expect(draft.oauth2ClientID).toBe('abc')
    expect(draft.oauth2Scope).toBe('read')
  })

  it('maps Auth.HMAC.HeaderName through for AuthHMAC', () => {
    const r = baseRequest({ AuthType: AuthType.AuthHMAC, Auth: { OAuth2: null, HMAC: { HeaderName: 'X-Sig' }, OAuth1: null } })
    expect(draftFrom(r).hmacHeaderName).toBe('X-Sig')
  })

  it('maps Auth.OAuth1 fields through for AuthOAuth1', () => {
    const r = baseRequest({ AuthType: AuthType.AuthOAuth1, Auth: { OAuth2: null, HMAC: null, OAuth1: { ConsumerKey: 'ck', Token: 'tok', ConsumerSecretRef: '', TokenSecretRef: '' } } })
    const draft = draftFrom(r)
    expect(draft.oauth1ConsumerKey).toBe('ck')
    expect(draft.oauth1Token).toBe('tok')
    expect(draft.oauth1ConsumerSecretRef).toBe('')
  })

  it('defaults every Auth-derived field to empty when Auth is null (AuthNone/APIKey/Bearer/QueryParam, or pre-ADR-0015 data)', () => {
    const draft = draftFrom(baseRequest({ AuthType: AuthType.AuthNone, Auth: null }))
    expect(draft.oauth2TokenURL).toBe('')
    expect(draft.oauth2ClientID).toBe('')
    expect(draft.oauth2Scope).toBe('')
    expect(draft.hmacHeaderName).toBe('')
    expect(draft.oauth1ConsumerKey).toBe('')
    expect(draft.oauth1Token).toBe('')
  })

  it('maps JOSE through when present, and stays disabled/empty when JOSE is null', () => {
    const withJOSE = draftFrom(baseRequest({
      JOSE: { Enabled: true, Algorithm: 'RSA-OAEP-256', ContentEncryption: 'A256GCM', RecipientPublicKeyRef: 'vault:pub', DecryptResponse: true, PrivateKeyRef: 'vault:priv' },
    }))
    expect(withJOSE.joseEnabled).toBe(true)
    expect(withJOSE.joseRecipientPublicKeyRef).toBe('vault:pub')
    expect(withJOSE.joseDecryptResponse).toBe(true)

    const withoutJOSE = draftFrom(baseRequest({ JOSE: null }))
    expect(withoutJOSE.joseEnabled).toBe(false)
    expect(withoutJOSE.joseRecipientPublicKeyRef).toBe('')
    expect(withoutJOSE.joseDecryptResponse).toBe(false)
  })

  it('round-trips label/description/baseURL/authType/openAPISpec verbatim', () => {
    const r = baseRequest({
      Label: 'My API', Description: 'does a thing', BaseURL: 'https://api.example.com',
      AuthType: AuthType.AuthAPIKey, OpenAPISpec: '{"openapi":"3.0.0"}',
    })
    const draft = draftFrom(r)
    expect(draft.label).toBe('My API')
    expect(draft.description).toBe('does a thing')
    expect(draft.baseURL).toBe('https://api.example.com')
    expect(draft.authType).toBe(AuthType.AuthAPIKey)
    expect(draft.openAPISpec).toBe('{"openapi":"3.0.0"}')
  })

  it('defaults Body to empty string when the stored request has none set (nullish)', () => {
    const draft = draftFrom(baseRequest({ Body: undefined as unknown as string }))
    expect(draft.body).toBe('')
  })
})

// A round trip across every real AuthType: authConfigFrom(draftFrom(x))
// must reproduce the same Auth shape the request originally carried,
// for every type that actually has a non-secret config -- catches a
// silently-dropped field on either side of the mapping that a
// one-direction-only test could miss.
describe('draftFrom + authConfigFrom round trip', () => {
  const cases: Array<[AuthType, HTTPRequest['Auth']]> = [
    [AuthType.AuthNone, null],
    [AuthType.AuthAPIKey, null],
    [AuthType.AuthBearer, null],
    [AuthType.AuthQueryParam, null],
    [AuthType.AuthOAuth1Vendor, null],
    [AuthType.AuthMTLS, null],
    [AuthType.AuthOAuth2, { OAuth2: { GrantType: 'client_credentials', TokenURL: 'https://x/token', ClientID: 'id', Scope: 'scope', ContentType: '' }, HMAC: null, OAuth1: null }],
    [AuthType.AuthHMAC, { OAuth2: null, HMAC: { HeaderName: 'X-Signature' }, OAuth1: null }],
    [AuthType.AuthOAuth1, { OAuth2: null, HMAC: null, OAuth1: { ConsumerKey: 'ck', Token: 'tok', ConsumerSecretRef: 'vault:cs', TokenSecretRef: 'vault:ts' } }],
  ]

  it.each(cases)('round-trips %s', (authType, auth) => {
    const original = baseRequest({ AuthType: authType, Auth: auth })
    const draft: RequestDraft = draftFrom(original)
    expect(authConfigFrom(draft)).toEqual(auth)
  })
})
