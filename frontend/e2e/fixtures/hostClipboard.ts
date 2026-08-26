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
export function writeHostClipboardText(text: string): void {
  execFileSync('pbcopy', { input: text })
}
