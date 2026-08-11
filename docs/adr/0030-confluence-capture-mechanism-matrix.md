# ADR-0030: Confluence/Jira capture mechanism under bank policy — decision matrix

## Status
proposed — awaiting the owner's on-site policy findings (the checklist
below). This ADR deliberately does NOT pick a winner; it exists so the
owner can find out at the bank which paths survive policy, and so the
decision then gets made against evidence instead of memory.

## Context

The strategic reframe (2026-08-11 session, memory
`project-mill-bank-reality`): Mill's near-term product is the local,
offline, open-source substrate that makes M365 Copilot / local Ollama
usable at the bank. Bank ground truth, owner-stated: MCP is deny-all
(Zscaler blocks the port), there is no Confluence or Jira API access,
and clipboard capture of a full Confluence page loses structure (§5's
data point, now confirmed as the core daily pain). Content must come
from the **rendered DOM**.

§5/ADR-0003 already locked the *architecture* for a browser extension
(WXT + offscreen iframe onto the server-mode page). What it never
addressed — because the bank reality wasn't known then — is whether an
extension can be **loaded at all** on the bank machine, and what the
alternatives cost if it can't. The gating unknown only the owner can
resolve (§1.2's access boundary): enterprise browser policy on the
actual work machine.

Every factual claim below was researched against primary sources
(Chrome Enterprise policy docs, Chromium's own save-page architecture
doc, MDN, Chrome's Local Network Access blog) by a dedicated research
pass, 2026-08-11. Items the research could not fully confirm are
flagged inline rather than presented as settled.

## The four real capture paths

| | A. Browser extension (ADR-0003) | B. Bookmarklet | C. Save-page-then-parse | D. Hardened clipboard |
|---|---|---|---|---|
| **What it captures** | Live rendered DOM, any selector, continuous (DOM-event triggers) + per-tab identity | Live rendered DOM at click time | Full rendered DOM at ⌘S time (Chromium serializes each frame's DOM — its own `WebFrameSerializer` docs; "post-JS" is architecturally implied, not verbatim-quoted) | Only what the page's own copy path writes to `text/html` |
| **Markdown reliability** | Highest — Mill picks the exact content root, strips chrome | High — same DOM access, but fragile delivery | High — whole page incl. nav chrome; Mill must extract the content root from the saved file | Capped at the source: Confluence's own `copy` handler can replace/strip the HTML flavor entirely (confirmed mechanism: `clipboardData.setData` + `preventDefault`) — Mill cannot recover structure that was never written |
| **Write-back (§2.1 Apply into M365 chat)** | Yes — the only path that does both directions | No (capture-only in practice) | No — one-directional by nature | Paste-back only (already Mill's baseline) |
| **User gesture per capture** | None/hotkey (ambient) | One click | ⌘S + save dialog per capture | ⌘C |
| **Policy kill-switches** | `ExtensionInstallBlocklist "*"` (store installs); `ExtensionDeveloperModeSettings` / `DeveloperToolsAvailability` (unpacked loading — separately controlled) | Page CSP blocks `javascript:` bookmarks in practice (confirmed current Chrome behavior, despite the CSP spec's "should not interfere"); `URLBlocklist javascript://*` (Chrome 73+); plus Local Network Access permission gate on any page→localhost fetch (prompt launched ~Chrome 142) | `DownloadRestrictions=3` (blocks ALL downloads — rare, "not recommended" per Google's own doc) | None — zero policy exposure |
| **What IS&C must permit** | Allowlist one extension ID (`ExtensionInstallAllowlist` / `ExtensionSettings`), optionally self-hosted CRX via `ExtensionInstallSources`/`ExtensionInstallForcelist` — a standard, real enterprise mechanism, not an exotic ask. Edge mirrors all of these policies 1:1 | Nothing explicit — but two independent blockers can be on anyway, and CSP is the site's, not IS&C's, to waive | Nothing (unless downloads are hard-blocked) | Nothing |
| **Build cost given what Mill has** | `browser-extension/` package from scratch (architecture decided, zero code exists) | Small, but every piece is new + fragile | **Near zero** — `trigger-filesystem-watch` + `html-to-markdown` are both built; the new piece is a content-root extraction step | Small — but diagnosis first (below), since the likely root cause isn't Mill's to fix |

## Per-path notes

**A — Extension.** The only path that solves capture AND write-back AND
per-tab session identity — everything §2.1 and the multi-tab problem
need. Two distinct ways in, gated by different policies: (1) unpacked
"Load unpacked" via developer mode — gated by
`ExtensionDeveloperModeSettings` (a dedicated policy; whether
`ExtensionInstallBlocklist "*"` also blocks unpacked loading is
unconfirmed — the dedicated policy's existence suggests they're
separate code paths); (2) the enterprise-legit route — IS&C allowlists
Mill's extension ID, optionally force-installed from a self-hosted CRX,
no Chrome Web Store listing required. Route 2 is strengthened by Mill
being open-source: IS&C can review the exact code being allowlisted —
the same reasoning that makes git-clone the distribution mechanism.
Microsoft Edge (likely the bank's M365 browser) ships the identical
policy set.

**B — Bookmarklet.** Three independent failure modes, two of them
outside IS&C's gift: Confluence's own CSP (site-controlled), the
`URLBlocklist javascript://*` policy, and the Local Network Access
permission prompt on the `fetch()` to Mill's localhost port
(mixed-content rules exempt localhost as potentially-trustworthy, but
LNA is a separate, newer gate — enforcement status on the bank's exact
Chrome/Edge build needs a live check). Last resort; only worth
pursuing if A is denied AND C proves unusable.

**C — Save-page-then-parse.** The sleeper: buildable NOW, before any
IS&C answer, from pieces Mill already ships — a workflow whose trigger
is `trigger-filesystem-watch` on a "captures" folder, whose Process is
content-root extraction + the existing `html-to-markdown`, whose Apply
is a clipboard write. "Webpage, Complete" is the target format (plain
HTML for the existing parser); MHTML also serializes the live DOM but
needs MIME unpacking — not worth it while Complete-HTML works. The
per-capture ⌘S gesture is clunkier than a hotkey but it is a
**guaranteed-floor** path: worst realistic policy still lets a user
save a page. Remains useful as the fallback layer even if A lands
(§5's own fallback-order note: HTML → DOM-read → plain text).

**D — Hardened clipboard.** The research resolved §5's open (a)-vs-(b)
question in favor of (b) being the likely mechanism: no browser-level
rule makes large copies carry less structure than small ones — default
copy serializes the selection range to `text/html` regardless of size —
but a site's `copy` event handler can fully replace that payload, and a
rich editor like Confluence doing so differently for full-page vs.
in-editor selections is exactly the confirmed mechanism. Consequence:
"hardening" Mill's clipboard read cannot fix this. What Mill CAN do
cheaply is a **clipboard-inspector seeded workflow** (capture → report
exactly which flavors are present and how big) — the §1 thesis applied
to the clipboard itself, and the diagnostic the owner runs at the bank
to confirm (b) empirically in one paste.

## The owner's on-site checklist (the actual deliverable)

Run on the bank machine, in the browser actually used for Confluence:

1. **Which browser** — Chrome or Edge (policies mirror; the answer
   scopes which policy console IS&C would touch).
2. **`chrome://extensions` (or `edge://extensions`)** — is the
   Developer Mode toggle present and flippable? If yes, try Load
   unpacked with any trivial extension. → decides whether A works
   *today* without asking anyone.
3. **Ask IS&C the precise question** (precision is the point — vague
   asks get vague denials): "Can an internally-reviewed, open-source
   extension be added to `ExtensionInstallAllowlist` (or
   `ExtensionSettings` with `installation_mode: allowed`), self-hosted
   via `ExtensionInstallSources` if not store-listed?" → decides A's
   enterprise-legit route.
4. **Bookmarklet probe** — create a `javascript:alert(1)` bookmark, run
   it on a Confluence page; console shows a CSP refusal or policy
   block? → decides B in ten seconds.
5. **⌘S a Confluence page** ("Webpage, Complete") — allowed? Open the
   saved `.html`: is the page body's rendered content in it? → decides
   C, including the partially-confirmed live-DOM claim, empirically.
6. **`chrome://version`** — the build number, for LNA enforcement
   status (matters to B and to any future page→Mill relay).
7. **Copy a full Confluence page AND a small selection**, run each
   through Mill's clipboard-HTML capture (or the inspector workflow if
   built by then) — which flavors are actually present in each case? →
   confirms (b) and calibrates D's realistic ceiling.

## Consequences

- Path C is buildable immediately and independently of every checklist
  answer — a candidate next build regardless of the extension outcome,
  and the only path that ships bank-usable capture value before IS&C
  responds to anything.
- Path A stays the target end-state (ADR-0003's architecture is
  unchanged by this ADR); the checklist decides *when/whether* it's
  reachable, not *how* it's built.
- Path D's scope shrinks from "hardened capture" to "diagnostic +
  fallback flavor-ordering" — the root cause is the source's, not
  Mill's.
- Path B is explicitly last-resort; nothing gets built for it unless A
  is denied and C fails live.

## Lifecycle
- Owner: Ali (runs the checklist) + orchestrator session (wrote the
  matrix from the delegated research pass)
- Update triggers: any checklist answer landing; IS&C responding to
  the allowlist question; Chrome/Edge LNA enforcement changing
- Last reviewed: 2026-08-11
- Review interval: 30 days while `proposed`
