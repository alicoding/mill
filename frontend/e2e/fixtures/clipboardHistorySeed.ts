import type { Page } from '@playwright/test'

// Seeds a real Clipboard history entry by running the seeded
// "Clipboard history" workflow's own graph directly via
// ExecutionService.RunWorkflowWithPayload -- the SAME bound RPC the
// canvas's own test-run-with-payload feature already uses (docs/adr/
// 0008), called by its stable Go method name rather than driven
// through a real clipboard change. Goal 0234's own e2e-divergence note:
// the real trigger needs an actual macOS clipboard change to fire,
// which is CI-hostile (GitHub's headless runners have no pasteboard
// session); this exercises the exact same production
// apply-clipboard-history-store step every real capture goes through,
// just started a different way -- same reasoning as
// atlasNativeDropEscapeHatch.ts's own CreateBoardObject call. Runs the
// workflow's DRAFT head (RunKind "test"), which the seed ships
// PUBLISHED-and-identical to, so this works whether or not the seed
// has been enabled.
export async function seedClipboardHistoryEntry(page: Page, text: string): Promise<void> {
  const result = await page.evaluate(async (text) => {
    const callID = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const body = {
      object: 0, // @wailsio/runtime's objectNames.Call
      method: 0, // CallBinding
      args: {
        'call-id': callID,
        methodName: 'github.com/alicoding/mill/internal/services/executionsvc.ExecutionService.RunWorkflowWithPayload',
        args: ['clipboard-history-workflow', 'test', null, text],
      },
    }
    const res = await fetch(window.location.origin + '/wails/runtime', {
      method: 'POST',
      headers: { 'x-wails-client-id': 'e2e-clipboard-history-seed', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, status: res.status, text: await res.text() }
  }, text)
  if (!result.ok) {
    throw new Error(`seedClipboardHistoryEntry(${JSON.stringify(text)}) failed: ${result.status} ${result.text}`)
  }
}
