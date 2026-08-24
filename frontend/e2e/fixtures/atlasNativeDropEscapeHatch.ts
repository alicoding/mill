import type { Page } from '@playwright/test'

// Native OS file-drop (Wails3's WindowFilesDropped) needs a real
// *WebviewWindow -- server-mode Playwright's connection structurally
// isn't one (atlas-capture.spec.ts's own header comment has the full
// trail). CreateBoardObject itself carries NO such requirement -- it's
// an ordinary bound RPC, the exact one every tray click already goes
// through -- so a diagram board object (only ever produced by a native
// drop, goal 0179 S2) can still be landed for a REAL rendering check by
// calling that RPC directly, by its stable Go method NAME (never a
// numeric hash, which Wails derives from the method signature and
// would drift on an unrelated refactor). This is the last-resort
// escape hatch testing.md's own primitives rule carves out: no user
// gesture in this harness can reach a native-drop-created object at
// all, so the object's own EXISTENCE is created this way while every
// assertion afterward still drives the real rendered DOM.
export async function createBoardObjectViaRPC(page: Page, kind: string, payload: Record<string, string>, position: { X: number; Y: number }, parentID: string): Promise<void> {
  const result = await page.evaluate(async ({ kind, payload, position, parentID }) => {
    const callID = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const body = {
      object: 0, // @wailsio/runtime's objectNames.Call
      method: 0, // CallBinding
      args: {
        'call-id': callID,
        methodName: 'github.com/alicoding/mill/internal/services/atlassvc.AtlasService.CreateBoardObject',
        args: [kind, payload, position, parentID],
      },
    }
    const res = await fetch(window.location.origin + '/wails/runtime', {
      method: 'POST',
      headers: { 'x-wails-client-id': 'e2e-native-drop-escape-hatch', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, status: res.status, text: await res.text() }
  }, { kind, payload, position, parentID })
  if (!result.ok) {
    throw new Error(`createBoardObjectViaRPC(${kind}) failed: ${result.status} ${result.text}`)
  }
}

// The seeded default landing space every fresh Atlas view opens onto
// (internal/domain/atlas/builtin.go's own cardMySpaceID) -- the escape
// hatch above must file into the SAME container the board is actually
// viewing, or the created object exists server-side but never renders.
export const ATLAS_DEFAULT_SPACE_ID = 'atlas-card-my-space'
