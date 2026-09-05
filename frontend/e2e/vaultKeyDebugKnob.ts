import type { Page } from '@playwright/test'

// corruptVaultKeyForTests drives SecretService.DebugCorruptVaultKeyForTests
// (an e2e-only knob, internal/services/secretsvc/secretservice_debug.go)
// directly over Wails3's own runtime call wire protocol -- same shape
// and same reasoning as mcpTestClient.ts's backdatePendingMCPWrite:
// page.evaluate can't `import` a production-bundled chunk by a stable
// path, and the generated bindings' own numeric method IDs (Call.ByID)
// are regenerated per `wails3 generate bindings` run, too fragile to
// hardcode in a test, so this uses the stable METHOD NAME form
// (Call.ByName, "package.Struct.Method") instead.
//
// This knob exists because a genuine key-mismatch (a stored key that no
// longer opens its vault file) otherwise needs a second physical device
// holding the real key -- there's no other way to reproduce it against
// one server-mode process. It overwrites the vault's own stored key
// with a freshly minted, unrelated one, so the next unlock attempt
// reports ErrKeyMismatch. Server-side gated to MILL_TEST_KEYRING=memory
// (the same in-memory-keyring switch spawnMillServer already sets for
// every worker), so this can never reach a real device's keychain.
//
// baseURL is taken explicitly (rather than relying on page.request's
// own base) because this spec's dedicated-server tests build their
// page via a bare browser.newPage(), not the shared-pool `test`
// fixture that overrides the context's baseURL per worker.
export async function corruptVaultKeyForTests(page: Page, baseURL: string): Promise<void> {
  const res = await page.request.post(`${baseURL}/wails/runtime`, {
    headers: { 'x-wails-client-id': 'e2e-test-knob', 'Content-Type': 'application/json' },
    data: {
      object: 0, // objectNames.Call
      method: 0, // CallBinding
      args: {
        'call-id': `e2e-corrupt-vault-key-${Date.now()}`,
        methodName: 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.DebugCorruptVaultKeyForTests',
        args: [],
      },
    },
  })
  if (!res.ok()) {
    throw new Error(`corruptVaultKeyForTests failed: ${res.status()} ${await res.text()}`)
  }
}
