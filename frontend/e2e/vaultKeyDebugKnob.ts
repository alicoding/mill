import type { Page } from '@playwright/test'

// callBoundMethod drives any Wails-bound RPC directly over Wails3's own
// runtime call wire protocol, by its stable Go method NAME (never a
// numeric hash, which Wails derives from the method signature and
// would drift on an unrelated refactor) -- same shape
// atlasNativeDropEscapeHatch.ts's createBoardObjectViaRPC and
// clipboardHistorySeed.ts's seedClipboardHistoryEntry already
// establish: page.evaluate + fetch(window.location.origin + ...), not
// page.request.post, since a dedicated-server spec's page (built via a
// bare browser.newPage(), not the shared-pool `test` fixture) has no
// baseURL configured for page.request to resolve a relative path
// against, while the PAGE ITSELF always knows its own origin.
export async function callBoundMethod(page: Page, methodName: string, args: unknown[]): Promise<void> {
  const result = await page.evaluate(async ({ methodName, args }) => {
    const callID = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const body = {
      object: 0, // @wailsio/runtime's objectNames.Call
      method: 0, // CallBinding
      args: { 'call-id': callID, methodName, args },
    }
    const res = await fetch(window.location.origin + '/wails/runtime', {
      method: 'POST',
      headers: { 'x-wails-client-id': 'e2e-vault-key-knob', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, status: res.status, text: await res.text() }
  }, { methodName, args })
  if (!result.ok) {
    throw new Error(`callBoundMethod(${methodName}) failed: ${result.status} ${result.text}`)
  }
}

// corruptVaultKeyForTests drives SecretService.DebugCorruptVaultKeyForTests
// (an e2e-only knob, internal/services/secretsvc/secretservice_debug.go):
// overwrites the CURRENT vault's stored key with a freshly minted,
// unrelated one, so the next unlock attempt reports ErrKeyMismatch --
// the only way to reproduce a genuine key mismatch (a stored key that
// no longer opens its file) against one server-mode process, without a
// second physical device holding the real key. Server-side gated to
// MILL_TEST_KEYRING=memory (the same in-memory-keyring switch
// spawnMillServer already sets for every worker), so this can never
// reach a real device's keychain.
export async function corruptVaultKeyForTests(page: Page): Promise<void> {
  await callBoundMethod(page, 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.DebugCorruptVaultKeyForTests', [])
}
