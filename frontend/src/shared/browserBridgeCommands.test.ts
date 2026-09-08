import { afterEach, describe, expect, it, vi } from 'vitest'

const { acceptMock, denyMock } = vi.hoisted(() => ({ acceptMock: vi.fn(), denyMock: vi.fn() }))

// Only the two RPCs the pair-request Accept/Deny commands call are
// faked; every other binding the registry reaches for on import stays
// real, the same partial-mock shape listGridCommands.test.ts uses.
vi.mock('./bindings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bindings')>()
  return {
    ...actual,
    RemoteAuthService: {
      ...actual.RemoteAuthService,
      AcceptPairingRequest: acceptMock,
      DenyPairingRequest: denyMock,
      ListBrowsers: vi.fn().mockResolvedValue([]),
      PendingPairingRequest: vi.fn().mockResolvedValue({ requestId: '', code: '', label: '', expiresAt: '' }),
    },
    BridgeService: {
      ...actual.BridgeService,
      BridgeStatus: vi.fn().mockResolvedValue({ address: 'http://127.0.0.1:8092', envOverride: false, connected: false, browsers: 0 }),
    },
  }
})

import { findCommand, commandLabel } from './commands'
import { useBrowserBridgeStore } from './browserBridgeStore'
import viewsEn from '../locales/en/views.json'
import commonEn from '../locales/en/common.json'

const PENDING_REQUEST = { requestId: 'req-1', code: '482913', label: 'Chrome', expiresAt: new Date(Date.now() + 120_000).toISOString() }

describe('browser.pairRequest.accept / .deny', () => {
  afterEach(() => {
    vi.clearAllMocks()
    useBrowserBridgeStore.setState({ incomingRequest: null })
  })

  it('is disabled with nothing pending, enabled once a request arrives', () => {
    const accept = findCommand('browser.pairRequest.accept')!
    const deny = findCommand('browser.pairRequest.deny')!

    expect(accept.enabled?.()).toBe(false)
    expect(deny.enabled?.()).toBe(false)

    useBrowserBridgeStore.setState({ incomingRequest: PENDING_REQUEST })

    expect(accept.enabled?.()).toBe(true)
    expect(deny.enabled?.()).toBe(true)
  })

  it('accept calls AcceptPairingRequest with the pending request id and clears it', async () => {
    acceptMock.mockResolvedValue({ token: 'tok', deviceId: 'browser-1', label: 'Chrome' })
    useBrowserBridgeStore.setState({ incomingRequest: PENDING_REQUEST })

    await useBrowserBridgeStore.getState().acceptPairRequest()

    expect(acceptMock).toHaveBeenCalledWith('req-1')
    expect(useBrowserBridgeStore.getState().incomingRequest).toBeNull()
  })

  it('deny calls DenyPairingRequest with the pending request id and clears it without refreshing the list', async () => {
    denyMock.mockResolvedValue(undefined)
    useBrowserBridgeStore.setState({ incomingRequest: PENDING_REQUEST })

    await useBrowserBridgeStore.getState().denyPairRequest()

    expect(denyMock).toHaveBeenCalledWith('req-1')
    expect(useBrowserBridgeStore.getState().incomingRequest).toBeNull()
  })

  it('does nothing when run with no request pending', async () => {
    await useBrowserBridgeStore.getState().acceptPairRequest()
    await useBrowserBridgeStore.getState().denyPairRequest()

    expect(acceptMock).not.toHaveBeenCalled()
    expect(denyMock).not.toHaveBeenCalled()
  })

  it('resolves the palette labels from the command registry', () => {
    const accept = findCommand('browser.pairRequest.accept')!
    const deny = findCommand('browser.pairRequest.deny')!

    expect(commandLabel(accept)).toBe(commonEn.commands.browser.pairRequest.accept)
    expect(commandLabel(deny)).toBe(commonEn.commands.browser.pairRequest.deny)
  })
})

describe('the request card copy', () => {
  it('matches the design contract verbatim', () => {
    expect(viewsEn.settings.browsers.pairRequestTitle).toBe('{{label}} wants to pair')
    expect(viewsEn.settings.browsers.pairRequestCaption).toBe('Check the same code shows in the browser, then accept.')
    expect(viewsEn.settings.browsers.pairRequestAccept).toBe('Accept')
    expect(viewsEn.settings.browsers.pairRequestDeny).toBe('Deny')
    expect(viewsEn.settings.browsers.codeCountdown).toBe('Expires in {{time}}')
  })
})
