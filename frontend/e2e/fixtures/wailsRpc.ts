import type { Page } from '@playwright/test'

// Calls a bound Go method by its stable name over the runtime's own HTTP
// transport -- the escape hatch atlasNativeDropEscapeHatch.ts already
// uses for CreateBoardObject, generalized (testing.md: the same RPC a
// real click goes through, reached without the gesture the harness
// cannot produce). Returns the parsed JSON result.
export async function callBindingViaRPC<T = unknown>(page: Page, methodName: string, args: unknown[]): Promise<T> {
  const result = await page.evaluate(async ({ methodName, args }) => {
    const callID = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const body = { object: 0, method: 0, args: { 'call-id': callID, methodName, args } }
    const res = await fetch(window.location.origin + '/wails/runtime', {
      method: 'POST',
      headers: { 'x-wails-client-id': 'e2e-rpc', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, status: res.status, text: await res.text() }
  }, { methodName, args })
  if (!result.ok) throw new Error(`callBindingViaRPC(${methodName}) failed: ${result.status} ${result.text}`)
  if (!result.text) return undefined as T
  // A bound method returning a bare string answers with the raw text,
  // not a JSON document.
  try {
    return JSON.parse(result.text) as T
  } catch {
    return result.text as T
  }
}
