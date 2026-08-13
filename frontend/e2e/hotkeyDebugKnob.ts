import type { Page } from '@playwright/test'

// assignDebugWorkflowHotkey drives SettingsService.DebugAssignWorkflowHotkey
// (an e2e-only test knob, internal/services/settingssvc/settingsservice.go)
// directly over Wails3's own runtime call wire protocol -- same shape
// and same reasoning as mcpTestClient.ts's backdatePendingMCPWrite:
// page.evaluate can't `import` a production-bundled chunk by a stable
// path, and the generated bindings' own numeric method IDs (Call.ByID)
// are regenerated per `wails3 generate bindings` run, too fragile to
// hardcode in a test, so this uses the stable METHOD NAME form
// (Call.ByName, "package.Struct.Method") instead.
//
// This knob exists because a real hotkey assignment
// (TriggerService.AssignHotkey) always fails in server mode -- there's
// no native run loop for the OS to deliver a global keypress through
// (internal/adapters/hotkey/hotkey_server.go's Bind always errors), so
// no e2e path can ever complete the interactive press-to-capture flow
// trigger-row.spec.ts's own hotkey test already documents stopping
// short of. This bypasses that OS probe, server-side, gated to isolated
// test data only (SettingsService.isolatedData).
export async function assignDebugWorkflowHotkey(page: Page, workflowID: string, mods: string[], key: string): Promise<string> {
  const res = await page.request.post('/wails/runtime', {
    headers: { 'x-wails-client-id': 'e2e-test-knob', 'Content-Type': 'application/json' },
    data: {
      object: 0, // objectNames.Call
      method: 0, // CallBinding
      args: {
        'call-id': `e2e-assign-hotkey-${Date.now()}`,
        methodName: 'github.com/alicoding/mill/internal/services/settingssvc.SettingsService.DebugAssignWorkflowHotkey',
        args: [workflowID, mods, key],
      },
    },
  })
  if (!res.ok()) {
    throw new Error(`assignDebugWorkflowHotkey failed: ${res.status()} ${await res.text()}`)
  }
  return res.text()
}
