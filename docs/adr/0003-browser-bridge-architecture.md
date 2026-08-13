# ADR-0003: Browser bridge architecture (SPEC.md §5)

## Status
proposed

## Context
SPEC.md §5 (browser bridge) is the last unresolved blocker for §2.1 (the
M365 Copilot chat bridge, the actual first real milestone) — hotkeys
(§2.2) are done, the Runbook page is done, all that's left is getting a
browser tab's DOM content and a "run this" gesture into Mill and a result
back out.

Two hard constraints shaped every option below, both stated directly by
Ali, not inferred:

1. **No hand-rolled protocol code, strictly.** Not "prefer a library" —
   a firm rule. Ruled out writing Mill's own native-messaging-host wire
   format even though it's a genuinely trivial protocol (4-byte length
   prefix + JSON) with no adequate existing Go library, because writing
   it at all is still Mill authoring a protocol.
2. **The extension must have zero business logic.** Its only job is
   capturing DOM content and relaying it, purely event-driven — "not
   doing anything smart." All real logic (Capture→Process→Apply
   orchestration, per CLAUDE.md) stays in Mill's Go backend, matching the
   ports/adapters discipline already applied to `internal/domain/runbook`.

## Decision drivers
- CLAUDE.md's ports/adapters rule: commodity concerns bought via vetted
  libraries or reused platform APIs; Mill's own domain logic never
  duplicated into the extension.
- SPEC.md §0: avoid inner-platform effect / point solutions / NIH — the
  three failure modes this whole rebuild exists to escape.
- This session already built and tested Wails3 server mode (HTTP +
  WebSocket, real service bindings) — any bridge design that ignores this
  and reinvents a parallel channel is repeating work already done.
- Mill stays macOS-first (SPEC.md), but the extension framework choice
  should not foreclose Firefox/other browsers later without a rewrite.

## Options — extension framework

### A. WXT (recommended)
MIT license, 10.3k GitHub stars, pushed within the last day at research
time — actively maintained, not a side project. Confirmed directly (not
from search-summary claims alone): `npm view wxt` shows MIT, and its
`peerDependencies` include `vite: "^6.3.4 || ^7.0.0 || ^8.0.0-0"`, so it
rides on the Vite 8 `frontend/` already has rather than pulling in a
second bundler toolchain. Multiple independent 2026 framework comparisons
converge on it as the current default choice: smallest bundle output,
fastest HMR, and — unlike Plasmo/CRXJS — first-class multi-browser
support (Chrome, Firefox, Safari) rather than Chrome-only.

### B. Plasmo
"Next.js for extensions," React-opinionated. Rejected: multiple
independent sources describe it as in maintenance mode as of early 2026
(commits continue, feature development has slowed), and its Parcel-based
builds produce roughly 2x the bundle size of WXT's in head-to-head tests.

### C. CRXJS
Not a framework, a Vite plugin — deliberately minimal. Rejected as the
primary choice: Chrome-focused with only partial Firefox support, and
WXT already gets the same Vite-based build speed with broader
cross-browser reach and more structure (file-based entrypoints,
auto-imports) for near-zero extra cost.

### D. Hand-rolled MV3 boilerplate (no framework)
Rejected outright — directly violates the no-hand-roll rule for exactly
the kind of commodity scaffolding (manifest generation, build config,
cross-browser polyfilling) frameworks exist to solve.

**Recommendation: A (WXT).**

## Side finding: does Vite 8 (rolldown) violate CLAUDE.md's no-Rust rule?
Checked directly because WXT depends on Vite 8, and Vite 8 made Rolldown
(a Rust-written bundler) its default. Verified via `npm view` and the
installed tree: `rolldown` and its companion `lightningcss` both ship as
prebuilt, platform-specific native binaries selected through npm's
`optionalDependencies` (e.g. `@rolldown/binding-darwin-arm64`) — no local
`cargo`/`rustc` invocation ever happens on `npm install`. The `scripts` in
rolldown's own `package.json` (`build-binding`, `napi artifacts`) are how
its *maintainers* produce those binaries, not something a consumer's
install runs. This is the same shape as the `mise`-via-Homebrew carve-out
already locked in SPEC.md §1.1: prebuilt binary, zero local compilation,
distributed through the ecosystem's already-trusted package manager. Not
a violation. Recorded so this isn't re-litigated later — see SPEC.md
§1.1 update.

## Options — bridge mechanism (extension ↔ Mill)

### A. Native messaging + Mill-authored Go host
The traditional pattern (1Password, Bitwarden). Rejected under the strict
no-hand-roll rule: checked two Go libraries directly (not from search
summaries) — `lhside/chrome-go` is archived since 2015 with no license
shown; `jfarleyx/chrome-native-messaging-golang` last pushed April 2020,
44 stars, more sample than library. Neither is adequate, and the protocol
itself (~30 lines of `encoding/binary` + `encoding/json`) would have to
be Mill-authored either way — exactly what the rule excludes, regardless
of how trivial the protocol is.

Scope note (goal 0044 research, 2026-08-13): this rejection is about
protocol authorship ONLY — it was never an admin-rights problem.
Native-messaging-host manifests register per-user with no admin/root
on both Windows (`HKEY_CURRENT_USER\...\NativeMessagingHosts`) and
macOS (`~/Library/Application Support/.../NativeMessagingHosts/`),
per Chrome's own native-messaging docs. If an adequate Go library
ever appears, admin rights would not be the blocker.

### B. Direct localhost fetch/WebSocket from the extension
Extension calls `http://localhost:8080` directly via `fetch()` or the
`@wailsio/runtime` client with `setTransport()` pointed at that origin.
`setTransport()` is a real, documented extension point in
`@wailsio/runtime` (confirmed by reading the shipped source, not just
type declarations) — built by the Wails team for exactly this kind of
substitution, so using it isn't hand-rolling, it's consuming an
officially exposed API. Considered viable, but two open problems pushed
it below Option C: (1) a bare `localhost:8080` HTTP server is reachable
by *any* local process, not just Mill's extension, unless Mill adds its
own auth — a real guardrail-adjacent decision (§8) that shouldn't be
bolted on incidentally here; (2) it requires Mill's desktop mode to also
expose the HTTP interface concurrently with the native window, which it
doesn't today (server mode is a separate build tag).

### C. Offscreen document (iframe) + Mill's existing server-mode page (recommended)
Chrome's `chrome.offscreen` API (Chrome 109+, official, not a workaround)
creates a hidden document for exactly the class of thing service workers
can't do (DOM access, iframe embedding). Its `Reason` enum includes
`IFRAME_SCRIPTING` — *"the offscreen document needs to embed and script
an iframe in order to modify the iframe's content"* — confirmed directly
against Chrome's own docs to be the literal, purpose-built category for
this, not a stretch. Critically: **only the `AUDIO_PLAYBACK` reason gets
a forced 30-second timeout; every other reason, including
`IFRAME_SCRIPTING`, has no lifetime limit** — it persists until
explicitly closed. This was checked specifically because Ali raised MV3's
well-known service-worker/WebSocket 30s-idle-termination problem
(real, confirmed: Chrome kills MV3 service workers after 30s idle;
WebSocket messages reset the timer since Chrome 116, but only with an
active keepalive ping loop the extension would have to own).

The offscreen document's bundled HTML contains a hidden
`<iframe src="http://localhost:8080">` — same origin as Mill's own
already-tested server-mode page, so `@wailsio/runtime` and every existing
generated binding (`RunbookService`, etc.) work completely unmodified,
zero new Go code, zero new protocol. The extension's own code is reduced
to two official, standard hops: content script → `chrome.runtime.
sendMessage` (official API) → offscreen document → the iframe (Mill's
existing frontend). No custom wire format anywhere in that chain.

**Recommendation: C.**

## Recommendation
WXT (framework) + offscreen document with `IFRAME_SCRIPTING` reason,
hosting an iframe onto Mill's existing server-mode page (bridge
mechanism). Zero hand-rolled protocol code on either side; the extension
has no business logic — capture (content script) and relay (service
worker, offscreen document) only. Reuses `internal/domain/runbook` and
every existing generated TS binding unmodified.

## Open question — not resolved by this ADR
Option C's iframe needs `http://localhost:8080` reachable whenever the
browser needs it, independent of whether Mill's native desktop window is
open. Today, server mode is a separate build tag from desktop mode — they
don't run concurrently. Whether desktop mode should also expose the HTTP
interface always-on, or whether Mill needs a distinct "background
helper" process/mode, is a real product decision that intersects with
§7 (process/session tracking — a "session" already needs to span tab +
agent run + process). `OPEN`, deliberately not resolved here — needs its
own decision, not a default assumed by the bridge mechanism choice.

## Consequences
- Locks: WXT as the extension framework; `browser-extension/` as a new
  package (revives the npm-workspaces question from ADR-0001 §3.2 — now
  there's a real second JS package, so that's ripe to resolve too, not
  covered by this ADR).
- Unlocks: §2.1 (M365 Copilot bridge) can start once the "always-on HTTP
  interface" question above resolves.
- Explicitly not decided here: auth/security model for the HTTP interface
  if Option B's concerns ever resurface; Firefox support timing (WXT
  supports it day one, but nothing requires shipping it immediately).

## Lifecycle
- Owner: architect + Ali (raised the no-hand-roll rule and the MV3
  service-worker constraint that shaped this)
- Maintains: extension framework choice; bridge mechanism; the
  Rust/Rolldown reading of SPEC.md §1.1
- Update triggers: the always-on-HTTP-interface open question resolving;
  `browser-extension/` actually getting scaffolded (fires the
  npm-workspaces question); WXT's own maintenance status changing
- Last reviewed: 2026-08-06
- Review interval: 30 days while `proposed`; 365 days once `accepted`
