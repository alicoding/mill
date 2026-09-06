import { AtlasService } from './bindings'

// openExternalUrl -- the ONE door a user-facing surface uses to send a
// link OUT of the app, into the system's default browser (goal 0356
// part 2, generalizing goal 0271's single embedded-viewer seam to
// every external-link surface: WhatsNewDialog, DocsView, Settings'
// system-preferences links, the diagram tool's accessibility-settings
// button, the object.openInDefaultApp door's own PDF/JSON/sheet
// viewers). Routed through AtlasService.OpenURL -- a Mill-bound method
// whose Go-side port (internal/adapters/osopen) resolves to an
// in-memory recorder inside a `go test` binary or an e2e-spawned
// server -- rather than the adopted runtime's Browser.OpenURL, which
// always reaches the real OS opener and bypasses that port entirely.
// This is the ONLY file allowed to call AtlasService.OpenURL or import
// Browser from '@wailsio/runtime'; check-test-side-effects.sh and an
// ESLint restriction both deny either one everywhere else, so a click
// can never quietly open a real browser tab on the machine running the
// tests.
export function openExternalUrl(url: string): Promise<void> {
  return AtlasService.OpenURL(url)
}
