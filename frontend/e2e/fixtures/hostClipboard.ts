import { execFileSync } from 'node:child_process'

// The one Node-side door onto the real macOS pasteboard for e2e specs
// (goal 0229): shells out to pbcopy, the exact same tool
// internal/adapters/clipboard's WriteText wraps, so a spec seeding a
// payload here lands on the identical resource the app's own
// CompositionService.ReadHostClipboardText RPC (pbpaste) reads back --
// unlike navigator.clipboard.writeText, which this repo's headless test
// browser does NOT bridge to the real OS pasteboard (confirmed directly:
// switching the panel's read side to the Go RPC broke every clipboard-
// apply test seeded via navigator.clipboard, since the RPC was reading
// back something else entirely). Callers still wrap the surrounding
// flow in withClipboardLock (./clipboardLock.ts) -- this is the same
// single real OS-wide resource, still contended across parallel
// workers.

// hostClipboardAvailable mirrors the already-documented CI constraint
// (docs/SPEC.md §1.3, composition-seeded-runs.spec.ts's own header
// comment): pbcopy/pbpaste don't exist on CI's ubuntu-latest e2e
// runner, so neither this write door nor the Go clipboard adapter it
// mirrors can reach a real pasteboard there. Callers branch their
// content-specific assertions on this instead of asserting a specific
// payload round-tripped unconditionally -- the same environment-
// independent shape composition-seeded-runs.spec.ts already uses for
// the Go-side clipboard nodes.
export const hostClipboardAvailable = process.platform === 'darwin'

export function writeHostClipboardText(text: string): void {
  if (!hostClipboardAvailable) return
  execFileSync('pbcopy', { input: text })
}
