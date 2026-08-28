import { afterEach, describe, expect, it, vi } from 'vitest'

const isSigningTrustedMock = vi.hoisted(() => vi.fn())
const trustSigningIdentityMock = vi.hoisted(() => vi.fn())
vi.mock('./bindings', () => ({
  SettingsService: {
    IsSigningTrusted: isSigningTrustedMock,
    TrustSigningIdentity: trustSigningIdentityMock,
  },
  UpdateState: { UpdateStateIdle: 'idle' },
}))

import { useUpdateNoticeStore } from './updateNoticeStore'

// The trust-disclosure visibility state machine (owner-ruled
// progressive disclosure): e2e's shared worker pool only ever runs
// server-mode, which always takes the ErrUnsupportedPlatform branch,
// so the trusted/not-trusted/other-error branches below are otherwise
// unreachable by any committed test.
describe('trust disclosure visibility', () => {
  afterEach(() => {
    vi.clearAllMocks()
    useUpdateNoticeStore.setState({
      trustDisclosureVisible: true,
      trustSigningStatus: 'idle',
      trustSigningError: '',
    })
  })

  it('hides once IsSigningTrusted reports true', async () => {
    isSigningTrustedMock.mockResolvedValue(true)
    await useUpdateNoticeStore.getState().refreshTrustDisclosureVisibility()
    expect(useUpdateNoticeStore.getState().trustDisclosureVisible).toBe(false)
  })

  it('stays visible while not yet trusted', async () => {
    isSigningTrustedMock.mockResolvedValue(false)
    await useUpdateNoticeStore.getState().refreshTrustDisclosureVisibility()
    expect(useUpdateNoticeStore.getState().trustDisclosureVisible).toBe(true)
  })

  it('hides on the unsupported-platform read error (server mode, non-darwin)', async () => {
    isSigningTrustedMock.mockRejectedValue(new Error('codesigning: unsupported on this platform'))
    await useUpdateNoticeStore.getState().refreshTrustDisclosureVisibility()
    expect(useUpdateNoticeStore.getState().trustDisclosureVisible).toBe(false)
  })

  it('stays visible on any other read error -- fail-visible, offer the action', async () => {
    isSigningTrustedMock.mockRejectedValue(new Error('boom'))
    await useUpdateNoticeStore.getState().refreshTrustDisclosureVisibility()
    expect(useUpdateNoticeStore.getState().trustDisclosureVisible).toBe(true)
  })

  it('re-checks and hides immediately once a trust action succeeds', async () => {
    trustSigningIdentityMock.mockResolvedValue(undefined)
    isSigningTrustedMock.mockResolvedValue(true)

    await useUpdateNoticeStore.getState().runTrustSigning()

    expect(useUpdateNoticeStore.getState().trustSigningStatus).toBe('success')
    expect(useUpdateNoticeStore.getState().trustDisclosureVisible).toBe(false)
  })

  it('leaves visibility untouched when the trust action itself fails', async () => {
    trustSigningIdentityMock.mockRejectedValue(new Error('no window server session'))

    await useUpdateNoticeStore.getState().runTrustSigning()

    expect(useUpdateNoticeStore.getState().trustSigningStatus).toBe('error')
    expect(isSigningTrustedMock).not.toHaveBeenCalled()
    expect(useUpdateNoticeStore.getState().trustDisclosureVisible).toBe(true)
  })
})
