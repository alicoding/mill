# Mill — Living Spec

This document is the single source of truth for what Mill is. It is rendered
inside the Mill app itself (Spec view) so the doc and the app can't silently
drift apart. Edit this file, not a copy of it.

Status key: `LOCKED` (decided), `OPEN` (actively undecided), `PARKED` (named,
not yet worth deciding).

Where a section describes something with an actual UI, that same status key
covers whether the *decision* to build it is settled — not whether the
pixels are the intended design. A second, orthogonal tag covers that:
`UX: PROTOTYPE` (built to prove a capability/architecture works end-to-end;
functional, not a considered design — expect it to be redesigned, not
treated as the target) vs. `UX: FINAL` (the deliberate, intentional design
for that surface). Absence of a `UX:` tag on a section with a built UI
means it hasn't been classified yet — treat that as a gap to fill, not as
an implicit `FINAL`.

---

## 0. Origin

- Proven on the work laptop already: M365 Copilot (chat agent) driving
  Hammerspoon (macOS Lua automation) as the executor. The point being proven
  was that a chat agent can be made to solve these use cases at all — proven,
  done. `LOCKED`
- That proof-of-concept is not the foundation to build on. Repeatedly hit
  three failure modes trying to grow it: **inner-platform effect** (Hammerspoon
  config drifting into an ad-hoc bespoke platform instead of staying a
  scripting tool), **point solutions** (one-off scripts per use case instead of
  a general capability), and **NIH** (reaching for custom Lua glue where a
  real library/standard already existed). Mill-as-a-Wails-app is the
  do-over specifically to avoid those three, which is why §3–§8 lean so hard
  on citing existing tools/patterns (n8n, React Flow, native messaging,
  Claude Code's project scoping) instead of inventing fresh ones. `LOCKED`

## 1. Positioning

- **What "AI-friendly" actually means — the thesis, not a slogan: what you
  see is what I see.** `LOCKED` Everything Mill composes already exists and
  is already possible by hand. The gap isn't capability, it's that an AI
  acting on a system it can't verify has to *guess* at the actual state
  (what's really on the clipboard, what a command will really do, what a
  setting is really set to) — and the distance between the guess and reality
  is exactly where hallucination and silent failure live. Mill's job is to
  give an AI the same verified, structured view of state a human has, not a
  text blob to infer from. Every recurring pain point this spec addresses is
  a specific instance of this: heredoc failures (shell syntax generated
  blind, no structured view of the real quoting context), the Confluence
  clipboard ambiguity (nothing told either party whether HTML was actually
  present until it was made checkable), MCP's typed tool calls over freehand
  bash (a structured result instead of text to parse and hope), the
  guardrail preview itself (make sure the human's view and the AI's
  about-to-happen action are the same view, before it happens), and the
  original multi-tab session-identity problem (the human's view and the
  AI's context silently diverging with no shared state to reconcile them).
  This is the actual mechanism behind "compose, don't reinvent" below — not
  a separate preference, the same one.
- Mill is not novel. It composes existing primitives — a workflow
  authoring layer with guardrails, not a new category. `LOCKED`
- Reference points: **1Password** (generic capability across every site/app,
  not site-specific), **n8n** (generic workflow/automation composition).
  `LOCKED`
- Product posture: agentic, like M365 Copilot or claude.ai — not turn-by-turn
  operator mode like Claude Code's manual-gear review. The guardrail has to be
  ambient, not a tax on every step. `LOCKED`
- Hard constraint: the guardrailed path must not be harder than the baseline
  of what a person can already do natively (copy/paste, running a command
  themselves by hand). If it is, nobody adopts it. `LOCKED`
- **Scope filter, learned from the screenshot-to-clipboard tangent**: before
  any capability goes into Mill, check whether the OS (or an existing
  launcher like Alfred/Raycast) already does it simply and well. If yes,
  Mill's job is at most to surface/point at it (a Runbook tip, not a
  reimplementation) — reimplementing a solved OS capability is the §0
  inner-platform trap aimed at macOS instead of at Hammerspoon. Mill earns
  its keep specifically where there's no native answer at all: guardrailed
  command execution, structure-preserving capture across inconsistent
  sources, cross-session identity, workflow composition — genuine gaps, not
  a "screenshot but ours" competitor to what already works. `LOCKED`

### 1.1 Hard constraints & delivery model

- No `cargo`/Rust compilation anywhere in Mill's own build or dependency
  pipeline. Reason: at the bank, Zscaler intercepts/breaks cargo's network
  calls to crates.io, and Artifactory has no Rust feed to route around it —
  so anything that requires `cargo build`/`cargo install` from source will
  not build there, in CI or locally. This rules out e.g. Tauri as an
  alternative app shell (its build step compiles Rust). `LOCKED`
  Narrower than it first sounds: a **pre-built** Rust binary installed via
  Homebrew (a compiled bottle, no local cargo invocation) is not the same
  problem — brew already works there (it's how pueue got installed). So a
  Rust-authored local dev tool installed as a pre-built binary (e.g. `mise`
  via `brew install mise`) isn't automatically disqualified by this rule;
  only compiling Rust from source is. `LOCKED`
  Same reading applies to npm packages that ship prebuilt Rust binaries:
  checked directly (ADR-0003) that Vite 8's default bundler (Rolldown,
  used transitively by `frontend/`'s `vite` dependency) and its companion
  `lightningcss` both distribute as platform-specific prebuilt native
  binaries via npm's `optionalDependencies` mechanism — `npm install`
  never invokes `cargo`/`rustc`. Same shape as the Homebrew-bottle case,
  different package manager. `LOCKED`
- No AI API calls from Mill itself, and no phone-home telemetry of any kind.
  Mill is the substrate that mediates/guards actions initiated by other
  systems (an agent CLI, a chat client) — it is not itself an LLM client, and
  it must run fully offline/on-prem with zero outbound calls it didn't
  explicitly initiate on the user's own behalf via a user-configured
  connector. `LOCKED`
- Single binary, no separate CLI/backend split. Wails3 already satisfies
  this (one Go binary embeds the compiled frontend) — this reinforces the
  existing scaffold choice, no change needed. `LOCKED`
- Install story: `git clone` + a documented local build, runnable on any work
  machine that can install the app. No hosted-service dependency for the
  core loop. `LOCKED`
- CI/CD wired from day one, not bolted on later. `LOCKED`
- Command/bash execution is mediated through Mill's own process (that's the
  guardrail hook point), but the mechanism underneath should be standard OS
  primitives (`os/exec`, a normal shell invocation) rather than a
  custom-built sandboxing/process-isolation layer — compose what exists,
  don't reinvent it. `OPEN` — confirm this reading is correct before it
  drives design.
- Architecture discipline: SOLID, DRY, DDD — proper domain/class separation
  once real domain logic exists. Not retrofitted onto the current two-file
  scaffold prematurely; applies as soon as actual capabilities land. `LOCKED`

### 1.2 Working method

- Research → Plan → Implement (the workflow Boris Cherny has described for
  Claude Code) is the standing method for every capability added to Mill:
  research what already exists before assuming it doesn't — a claimed
  "nothing exists for X" must be backed by an actual search, not an
  assumption (this is also the NIH guardrail from §0) — then plan/lock the
  approach, then implement. `LOCKED`
- DBOS and pueue were surfaced as possible durable-execution/process-queue
  candidates from earlier M365-context research, and got conflated with each
  other in that discussion — they're not the same kind of thing (DBOS is a
  durable-execution library you embed and typically pairs with Postgres;
  pueue is a standalone CLI/daemon for queueing shell commands). Both have
  now been independently evaluated — see §7 and
  [`docs/adr/0004-execution-process-tracking.md`](adr/0004-execution-process-tracking.md).
  `LOCKED` (evaluation) — ADR-0004 itself is `proposed`, not yet `accepted`.
- Concrete failure mode already hit once, worth locking as a hard filter for
  §7's eventual candidate list: pueue was `brew install`ed on the work
  machine for the M365 prototype, which (a) is written in Rust — disqualified
  by §1.1 on its own — and (b) is a separately-installed daemon outside the
  single binary, meaning anyone who `git clone`s Mill would also need to
  install and keep it in sync via a package manager Mill doesn't control.
  Generalized rule: **any process/job-queue mechanism must be embeddable
  directly in the Go binary** (a library, not a separately-installed
  daemon/CLI) — it cannot require Homebrew or any other external package
  manager at install time. This doesn't pick a replacement yet (that's
  §7's job), it just eliminates a whole class of candidate. `LOCKED`
- Access boundary: the actual work laptop this is being built for is behind
  Zscaler at the bank and is not something the assistant helping design Mill
  has any live access to — no inspecting the real clipboard, no observing
  M365/Loop/Copilot behavior directly, no running commands against that
  machine's real session. Design and research proceed from the user's
  descriptions, not empirical testing against the real target environment,
  unless the user explicitly runs something themselves and reports back.
  `LOCKED`

### 1.3 Repo layout & CI/CD

Full rationale in [`docs/adr/0001-go-module-path-and-repo-layout.md`](adr/0001-go-module-path-and-repo-layout.md)
and [`docs/adr/0002-cicd-pipeline-phased-rollout.md`](adr/0002-cicd-pipeline-phased-rollout.md).

- Go module renamed from the scaffold default `changeme` to
  `github.com/alicoding/mill` (no git remote configured yet at the time of
  this decision; path chosen to match the intended future GitHub owner
  rather than deferring and repo-wide-renaming later). `LOCKED`
- Repo layout: flat root `*.go` files stay at root (`main.go` + thin
  Wails-binding `*service.go` files) — matches wailsapp/wails v3's own CLI
  repo convention, not golang-standards/project-layout (not an official Go
  standard per Russ Cox; aimed at multi-binary services Mill isn't).
  `internal/domain/runbook` (hand-written: the Capture→Process→Apply
  orchestration for Runbook actions) and `internal/adapters/{clipboard,
  markdown,hotkey}` (thin wrappers behind small interfaces around commodity
  libs: clipboard I/O, `html-to-markdown`, `golang.design/x/hotkey`) shipped
  per ADR-0001 Phase 2. Future domain packages (guardrail eval, capability
  composition, session identity) land the same way as they're built — no
  `cmd/`, `pkg/`, `api/`. `LOCKED`
- No generic `Capability`/`Action`/`Node` interface — §3 is still `OPEN` and
  only 2 concrete Runbook actions exist; the domain/adapter boundary above
  is stable regardless of what §3 decides, the capability schema itself is
  §3's call alone. `OPEN` (defer to §3)
- npm workspaces (`frontend/` + a future `browser-extension/`, §5) — not
  adopted yet, revisit when a real second JS package is scaffolded. `go.work`
  not applicable — single Go module is permanent per §1.1. `PARKED`
- **Frontend state management: Zustand adopted.** The PARKED trigger below
  fired — `ActivityView` (a second stateful view) needed the same
  `actions`/`activity` state `App.tsx` fetched, threaded down as props.
  `frontend/src/store.ts` holds `actions`/`activity` in one small store (no
  multi-slice split — an 8-file frontend doesn't need it yet); `App.tsx`
  keeps its two data-fetching effects but writes into the store instead of
  local `useState`, and `RunbookView`/`ActivityView` read the store
  directly instead of receiving props. Hotkey-recording UI state
  (`bindings`, `bindingErrors`, `recordingId` in `RunbookView.tsx`)
  deliberately stayed local `useState` — genuinely single-view state, not
  a candidate for the shared store. `LOCKED`
- **Frontend CSS: migrated to CSS Modules.** Primer React v38 (Mill is on
  38.35.0) dropped its `styled-components`/`sx`/`Box` dependency entirely
  and its own release notes say to "prefer to use CSS modules over
  styled-components and css variables over javascript theming"
  (github.com/primer/react discussion #7086) — not an outside opinion,
  the framework's own current direction, which Mill's single hand-rolled
  `public/style.css` predated. Genuinely global chrome (design tokens,
  `html`/`body` reset, the `.app-shell` flex root, the shared `.view-pane`
  scroll-clip class) moved to `frontend/src/index.css`, imported from
  `main.tsx` so it goes through Vite's own pipeline instead of a raw
  `<link>` tag that bypassed it. Per-view styling split into co-located
  `*.module.css` files (`RunbookView.module.css` shared by `RunbookView`
  and `ActivityView`, which already reused the same card/list visual
  language). `frontend/public/style.css` deleted. `LOCKED`
- CI: GitHub Actions, all four ADR-0002 phases shipped in
  `.github/workflows/ci.yml` + `.github/workflows/release.yml`.
  `golangci-lint` v2, ESLint flat config, Vitest, `go test -race -cover`,
  `go build`/`go vet` (macOS desktop + Linux server-mode), Playwright E2E,
  `govulncheck` (advisory only, still experimental upstream), all
  merge-blocking except govulncheck. Precedent: wailsapp/wails's own v3 CI
  (native-OS matrix, no GoReleaser — wailsapp/wails#747 closed wont-fix).
  `LOCKED`
- **Linux server-mode builds require `CGO_ENABLED=0` explicitly** — not
  optional, confirmed by actually building natively in a linux/amd64
  container, not assumed. Without it, Wails3's own
  `internal/operatingsystem`/`internal/assetserver/webview` packages pull
  in GTK4/webkitgtk-6.0 regardless of the `server` build tag. Matches
  `build/docker/Dockerfile.server`'s own default — that answer was already
  in the repo, just not applied to CI until this was caught. Applies to
  any future Linux build/test/lint step touching the root package. `LOCKED`
- `internal/adapters/hotkey` is split by build tag:
  `hotkey_desktop.go` (`!server`, the real `golang.design/x/hotkey`-backed
  implementation) and `hotkey_server.go` (`server`, a zero-dependency stub
  returning a clear error) — not just a build-fix, architecturally correct
  either way, since server mode has no native run loop to ever deliver a
  keypress through. `LOCKED`
- Lefthook (Go, MIT, Evil Martians) mirrors the same checks locally as a
  pre-commit hook (`lefthook.yml`) — go vet/build/test, golangci-lint,
  eslint, vitest, tsc — verified end-to-end (a deliberate lint violation
  was caught and blocked, a clean commit passed). Playwright E2E is
  deliberately NOT in the local hook (real server build + browser launch
  is meaningfully slower than everything else there; suited to CI, not
  every local commit). `task setup:hooks` installs it once per clone.
  `LOCKED`
- **Max 500 lines per hand-written `.go`/`.ts`/`.tsx` source file** —
  `scripts/check-loc.sh`, run by both Lefthook and CI's `file-loc-limit`
  job (one script, not two copies that can drift, same "mirrors CI"
  principle as Lefthook's own header comment). Generated Wails bindings
  and the vendored gomobile scaffold (`build/ios/`, `build/android/`) are
  exempt. Introduced once two files crossed it during the Configure-
  surface work (`internal/domain/composition/composition.go` at 944
  lines, `frontend/src/CompositionCanvas.tsx` at 623) — both split along
  real package/component seams (composition.go into `types.go`/
  `nodetypes.go`/`graph.go`/`integration.go`/`execute.go`/
  `capabilitymap.go`; CompositionCanvas.tsx into `CanvasNodeView.tsx`/
  `draftWorkflowSchema.ts`/`canvasConversion.ts`/`NodePalette.tsx`), zero
  behavior change, verified via the full check suite plus a real
  server-mode Playwright smoke pass before landing. `LOCKED`
  **Checked directly, not assumed, whether this hand-rolled script
  duplicates commodity tooling** (prompted by a direct question —
  CLAUDE.md's own "default to adopting, hand-roll only when no adopted
  option satisfies the constraint" rule applies to this too, not just to
  whole libraries): ESLint ships a real built-in `max-lines` rule
  (confirmed against its own docs) that could cover the `.ts`/`.tsx` half
  today with zero new dependency — Mill doesn't currently enable it.
  Go's side is different: confirmed directly against the actually-
  installed `golangci-lint v2.12.2`'s own linter list (`golangci-lint
  linters`) that no file-length linter ships in it — `funlen` limits a
  *function's* length, `lll` limits *line width*, neither is "lines per
  file." A third-party `filen` linter exists upstream
  (github.com/DanilXO/filen, golangci-lint PR #5081) but isn't merged
  into a released version yet. Splitting into "ESLint's `max-lines` for
  TS + something else for Go" was considered and rejected: it would
  reintroduce exactly the "two copies that can drift" problem this
  bullet's own one-script design already exists to avoid (a limit number,
  an exemption list, defined twice, in two config languages, checked by
  two different tools) — the actual constraint this script satisfies
  isn't "no line-count tool exists anywhere," it's "one identical rule
  enforced the same way across both languages Mill writes," which no
  single commodity tool covers. `LOCKED` (script stays; documented
  reasoning, not an unchecked assumption).
- **`.claude/rules/*.md` frontmatter is validated the same way — a
  second small script, same "one script, mirrored by Lefthook and CI"
  shape.** Prompted directly, after a real instance: a `globs:` vs
  `paths:` typo in `.claude/rules/frontend.md` (§9.1) shipped and sat
  silently broken — the rule's path-scoping just never worked, with
  nothing anywhere flagging it. Researched before hand-rolling a fix,
  not assumed: `cclint` (github.com/carlrannaberg/cclint, MIT, active)
  is a real, existing linter for Claude Code project files, checked
  directly against its own docs — but it validates agent/command
  frontmatter, `settings.json`, and `CLAUDE.md`, not `.claude/rules/*.md`
  specifically, and Mill has no agents or commands yet for it to apply
  to regardless (adopting it now would be tooling for a problem that
  doesn't exist yet, the exact thing this repo's own anti-proliferation
  instinct exists to catch). `scripts/check-rules-frontmatter.sh` is a
  small, zero-new-dependency bash script (no YAML parser needed — the
  real schema is one optional key, `paths`, a list of strings) that
  flags any other top-level frontmatter key, run by both Lefthook
  (`rules-frontmatter` job) and a new CI job of the same name. Verified
  it actually catches the bug it was written for, not just that it
  passes on already-correct files: reintroduced the original `globs:`
  typo temporarily, confirmed the script fails with a clear message
  naming the bad key, then restored the correct file and confirmed a
  clean pass. `LOCKED`
- **`frontend/src/` reorganized into enforced bounded-context folders,
  prompted by a direct ask: the Go side already has real bounded
  contexts (`internal/domain/*`/`internal/adapters/*`) and the
  43-file-flat frontend never got the equivalent.** Full research,
  decision, and folder map are in
  [`docs/adr/0012-frontend-bounded-context-folders.md`](adr/0012-frontend-bounded-context-folders.md).
  `eslint-plugin-boundaries` was tried first (ESLint-native, zero new
  pipeline) and abandoned after real, extensive debugging — its pattern
  matching never fired against this project's own files even when
  reproducing its own upstream test fixtures exactly, confirmed by
  instrumenting the plugin's compiled source directly, not assumed
  broken. **`dependency-cruiser`** (MIT, standalone CLI, TS-aware
  module-graph resolver) replaced it: worked correctly on the first
  real run, and correctly caught a deliberately-reintroduced violation
  on verification. Five folders — `app/` (shell only), `views/`
  (top-level pages), `composition/` (§3's canvas domain), `configure/`
  (§3.5's Configure domain), `shared/` (genuinely cross-cutting, 2+
  consumers) — with import direction enforced one-way
  (`shared ← configure ← composition ← views ← app`) via
  `frontend/.dependency-cruiser.cjs`, run as `npm run boundaries`,
  wired into both Lefthook and CI's `frontend` job alongside `npm run
  lint`. The tool caught a real design mistake mid-implementation, not
  just a hypothetical one: `store.ts`/`Tabs.tsx` were first placed in
  `app/` on the assumption that "global state" and "the app shell" were
  the same context — the first clean-tree `depcruise` run then flagged
  9 files across three other folders importing them, the actual
  definition of `shared/`; moved accordingly. Documented as a standing
  rule in `.claude/rules/frontend.md` (new files land in their
  bounded-context folder from creation, not flat-then-reorganized).
  `LOCKED`
- **Testing discipline formalized as a rule, prompted by a direct ask to
  stop "paying the tax" of re-discovering the same bugs manually.**
  Four real bugs in one session (a canvas node-drop collision, a
  duplicate-trigger-drop rejection, a disabled palette item's hover
  background, the node-type-swap feature) were each verified live —
  hovering an element, dragging a node, reading a computed style via a
  throwaway Playwright script — then the script was discarded once it
  confirmed the fix, leaving zero permanent coverage for any of the
  four. `.claude/rules/testing.md` (unscoped — applies regardless of
  language) encodes the actual discipline: a bug confirmed via manual
  reproduction isn't done until that reproduction becomes a committed
  test, since the reproduction already exists at the moment of
  confirmation and re-deriving it later costs real time. Applied
  retroactively to all four bugs this pass: `canvasLayout.test.ts`
  (Vitest, `findFreeDropPosition` — previously zero test coverage on a
  pure function that had a real, demonstrated bug) and four new
  `composition.spec.ts` Playwright cases covering the other three plus
  the collision fix end-to-end. Surfaced a small real coupling issue
  while adding the unit test: `canvasLayout.ts` imported
  `CANVAS_NODE_WIDTH`/`CANVAS_NODE_HEIGHT` from `CanvasNodeView.tsx` (a
  React component file with a CSS import chain Vitest's transform
  pipeline couldn't handle), breaking the new test outright — split
  into a zero-dependency `canvasConstants.ts` both files import from
  instead, the same "split along the seam a limit just surfaced"
  discipline the 500-line rule above already established, just found
  via test-writing instead of a line count. `LOCKED`
- `HotkeyService` cannot be exercised by headless/server-mode CI — no live
  macOS Cocoa run loop in that mode. Verification stays an explicit manual
  desktop-mode check (`.claude/skills/run-mill`), never a silent CI
  skip/fake-pass. Same reasoning extends to `internal/adapters/clipboard`'s
  real round-trip test (skipped specifically in CI, not just on non-macOS —
  GitHub's `macos-latest` runners are headless, no GUI/pasteboard session
  for `osascript` either) and to the Playwright E2E suite (asserts only
  what's environment-independent — page load, both actions listed, Spec
  content, the deterministic "no HTML on clipboard" path — never the
  clipboard-dependent success content). `LOCKED`
- Release pipeline (ADR-0002 Phase 4) ships **macOS only**, deliberately:
  Linux desktop needs GTK4/webkitgtk-6.0 system packages never installed
  or tested here; Windows needs a toolchain with zero local verification
  possible from this macOS-only dev environment. Shipping CI for platforms
  nobody's actually run it against is the exact mistake the CGO_ENABLED
  finding above already caught once — not repeated for a release artifact
  people would download. Windows/Linux desktop release builds `PARKED`,
  revisit when there's a way to actually verify them. Server-mode Docker
  image also not part of v1 release scope — no confirmed hosted-deployment
  use case. `LOCKED` (macOS-only scope) / `PARKED` (the rest)

### 1.4 Architecture at a glance

Two standard architecture views, rendered as real diagrams in the Spec
tab itself (`frontend/src/SpecView.tsx`, via the `mermaid` package —
MIT, pure JS/TS dependency tree, no native/Rust anywhere, verified
directly against its own `package.json` before adopting) rather than
left as prose alone — a layered system with this many pieces built is
harder to hold in your head as text than as a picture. Mermaid's own
`C4Context`/`C4Component` diagram types would match this pair's naming
even more closely, but Mermaid's own docs flag C4 diagrams as
experimental (syntax/properties still changing); using the standard,
stable `graph`/subgraph syntax instead gets the same two conceptual
views without that risk. Dashed nodes are planned, not built — same
distinction as everywhere else in this doc, never implied as done.
Real drag-to-pan/scroll-to-zoom with visible +/−/reset controls comes
from `svg-pan-zoom` (BSD-2-Clause, zero runtime deps) — Mermaid itself
has no pan/zoom capability at all, checked directly against its own
config schema before adopting a second library. `LOCKED`

The one non-obvious wiring detail worth recording here: `mermaid.run()`
matches elements by the same literal `mermaid` class the marked-renderer
override sets (`MERMAID_CLASS` constant in `SpecView.tsx`, not two
independently hardcoded strings), and the SVG needs an explicit
`viewBox` (synthesized from its own rendered width/height, since Mermaid
never sets one) plus `width/height: 100%` CSS on the SVG itself —
without the second part, `svg-pan-zoom` sizes its coordinate system off
the SVG's intrinsic (pre-scaled) dimensions rather than the actual
container, which pushes its control icons past the visible edge.

**System Context** — Mill, its user, and the systems it touches:

```mermaid
graph TB
    User(("User"))
    Mill["Mill (desktop app)"]
    macOS["macOS<br/>Accessibility &amp; Clipboard"]
    Agent["AI agent / chat client<br/>(via MCP)"]
    Conn["External APIs<br/>(Jira, Confluence, HTTP)"]
    Browser["Browser tab<br/>(via extension)"]

    User -->|presses hotkey, clicks Run| Mill
    Mill -->|reads/writes clipboard, requests permission| macOS
    Mill -.->|exposes guardrailed tools| Agent
    Mill -.->|calls, auth'd| Conn
    Browser -.->|DOM capture / relay| Mill

    classDef planned stroke-dasharray: 5 5,fill:transparent
    class Agent,Conn,Browser planned
```

**Logical / Component view** — Mill's own layered architecture:

```mermaid
graph TB
    subgraph Frontend["Frontend — React + TypeScript (Vite)"]
        Views["Views: Activity,<br/>Composition, Spec, ..."]
        Store["Zustand store"]
    end
    subgraph Bindings["Wails-bound services (root *service.go)"]
        TrigSvc["TriggerService"]
        CompSvc["CompositionService"]
        CapSvc["CapabilitiesService"]
        SpecSvc["SpecService"]
        ExecSvc["ExecutionService"]
    end
    subgraph Domain["internal/domain/* — core domain, hand-written"]
        TrigDom["trigger"]
        CompDom["composition"]
        CapDom["capabilities"]
    end
    subgraph Adapters["internal/adapters/* — ports/adapters, commodity"]
        Clipboard["clipboard"]
        Markdown["markdown"]
        Hotkey["hotkey"]
        Schedule["schedule"]
        Filewatch["filewatch"]
        Settings["settings"]
        ExecAdapter["execution"]
    end
    subgraph External["External libraries / OS"]
        OSA["osascript / macOS clipboard"]
        GDH["golang-design/hotkey"]
        NRC["netresearch/go-cron"]
        FSN["fsnotify/fsnotify"]
        H2M["html-to-markdown"]
        WailsRT["Wails3 runtime / KVStoreService"]
        DBOSExt["DBOS-Go + SQLite"]
    end

    Views --> Store
    Views -->|generated Wails bindings| TrigSvc
    Views -->|generated Wails bindings| CompSvc
    Views -->|generated Wails bindings| CapSvc
    Views -->|generated Wails bindings| SpecSvc
    Views -->|generated Wails bindings| ExecSvc

    TrigSvc --> TrigDom
    TrigSvc --> Hotkey
    TrigSvc --> Schedule
    TrigSvc --> Filewatch
    TrigSvc --> Clipboard
    TrigSvc --> Settings
    TrigSvc -->|RunWorkflow, RunKindTriggered| ExecSvc
    CompSvc --> CompDom
    CompSvc --> Settings
    CompSvc -.->|Sync after Create/Update/Delete| TrigSvc
    CapSvc --> CapDom
    ExecSvc -->|ExecuteWorkflowWithStepRunner| CompDom
    ExecSvc --> ExecAdapter

    CompDom --> Clipboard
    CompDom --> Markdown

    Clipboard --> OSA
    Markdown --> H2M
    Hotkey --> GDH
    Schedule --> NRC
    Filewatch --> FSN
    Settings --> WailsRT
    ExecAdapter --> DBOSExt
```

## 2. Core primitive: Capture → Process → Apply

- **Capture**: pull content from a source preserving structure (e.g. DOM copy
  keeps HTML structure, not just flattened text).
- **Process**: a workflow transforms the captured payload into
  whatever the target needs (markdown, plain text, a structured object).
- **Apply**: deliver the processed payload to a target location — e.g. paste
  at the cursor.
- This loop is meant to be generic: the same shape applies whether the
  "capture" is a DOM selection or an LLM tool-call request, and the "apply" is
  a paste or an actual command execution. `LOCKED` (as a shape) — the concrete
  node/connector model that implements it is `OPEN`.

### 2.1 First concrete milestone — the M365 Copilot chat bridge

The use case that should drive the first real build, not further
architecture discussion. M365 Copilot chat proposes a command in its
transcript; today the user manually reads it, runs it themselves, copies the
output, pastes it back into the chat box, and hits enter. Wanted workflow:

1. User reads the proposed command in the M365 Copilot chat (no live access
   for Mill's design process into this — see §1.2's access-boundary note;
   this all comes from the user's own machine at the time they use Mill).
2. User presses a configurable hotkey. **The hotkey press is the guardrail
   gesture** — a deliberate, human-initiated trigger, not a separate
   blocking approval popup. See the open question in §8 about whether that's
   sufficient or whether a lightweight preview still belongs in between.
3. Mill captures the command (from clipboard, or via the browser bridge
   reading the chat DOM directly — §5), executes it locally through Mill's
   own guardrailed process (§6/§7 govern cwd/shell/logging), and gets the
   result payload back.
4. Mill applies the payload back into the chat's input box (auto-paste).
5. Enter is either left to the user, or sent automatically by Mill — user
   explicitly wants the option to have Mill do it, closing the loop
   end-to-end with just the one hotkey press.

This is Capture → Process → Apply instantiated concretely: Capture = read
the proposed command from the chat, Process = execute it, Apply = paste the
result back and optionally submit. It requires §5 (browser bridge, to read
the chat DOM and write back into it), a global-hotkey mechanism (not yet
researched — needs a pure-Go, non-cargo library, per §1.1), and §6/§7 for
the execution itself. `OPEN` on the concrete implementation, `LOCKED` as the
first thing to build once the browser bridge and hotkey pieces are
researched.

### 2.2 Retired milestone — the Runbook page

`UX: PROTOTYPE`, now fully retired. Built to de-risk the two pieces of
§2.1 that didn't need live M365 access: a list of runnable actions
(click to run, no hotkey required) and per-action keyboard-shortcut
assignment (`HotkeyService`/`golang-design/hotkey`, `internal/domain/
runbook`, seeded with a **clipboard → Markdown** action via
`JohannesKaufmann/html-to-markdown`). It proved the concept end-to-end,
including a real bug worth remembering: a generic "copy every action's
result to clipboard" step in the old fire path clobbered actions (like
`load-sample-html`) that already wrote their own result to the
clipboard — fixed by moving the clipboard write into each action's own
Apply step and deleting the generic post-hoc copy, establishing the
"each action owns its own Apply" pattern Composition still follows.
**Superseded by Composition (§3):** the two seeded actions live on as
ordinary, fully-editable workflows (`composition.BuiltInWorkflows()`),
matching the industry pattern of an editable-not-protected template
(confirmed via Zapier's own docs). Hotkey binding, the one Runbook
capability Composition didn't initially have an equivalent for, is now
`TriggerService`'s job, keyed by workflow ID with real
one-combo-per-workflow exclusivity — see §3.4. `RunbookService`,
`internal/domain/runbook`, `RunbookView.tsx`, and the `runbook-page`
capability entry are all deleted, not hidden. `LOCKED`.

**Cross-cutting app-shell decisions that landed during this milestone
and are still current** (not Runbook-specific, so they outlived it):

- **Accessibility permission UX**: macOS's `x-apple.systempreferences:`
  deep-link scheme (the same mechanism Hammerspoon/Raycast/1Password
  use) opens straight to Privacy & Security → Accessibility — verified
  directly on-machine (macOS 26.5.2/25F84), not assumed. It's
  community-reverse-engineered,
  not an official Apple API, and has broken across past macOS System
  Settings rewrites, so re-verify if it stops landing correctly after a
  future OS update. Messaging distinguishes a self-serve grant from a
  managed/MDM machine where the user lacks the rights to change it (say
  what to ask IT for, don't imply a self-serve fix that isn't
  available). **Progressive enhancement, not a hard gate**: the
  zero-permission floor (browse/run by click) always works; Accessibility
  is additive convenience (hotkeys, simulated auto-paste/submit) on top
  — ungranted permission degrades features, never blocks the app. `LOCKED`.
- **Dev-build ad-hoc codesigning re-triggers the Accessibility grant on
  every rebuild** — `codesign --force --deep --sign -` changes the app's
  code identity each build, and TCC ties the grant to that identity, so
  every dev rebuild looks ungranted to macOS. Root cause `LOCKED`; a
  fix (e.g. a stable local signing identity) is `OPEN`, not attempted.
- **Hotkey fire path is logged end-to-end** (registered/fired/action
  succeeded-or-failed/clipboard-write succeeded-or-failed, via Wails3's
  own `application.DefaultLogger`) — a debuggability stopgap, not §7's
  real process-tracking mechanism (that's ADR-0004). Bindings persist
  across restarts via `internal/adapters/settings` (wraps Wails3's
  `KVStoreService`, JSON-file-backed at
  `~/Library/Application Support/mill/settings.json` on macOS),
  deliberately not exposed through Wails' Service lifecycle so the
  frontend can't bypass the owning service's own validation; restored
  on `events.Common.ApplicationStarted` since the native run loop isn't
  up yet during `ServiceStartup`. Verified end-to-end on a real rebuilt
  binary, not just unit-tested. `LOCKED` (now owned by `TriggerService`,
  §3.4, rather than the deleted `HotkeyService`).
- **Activity page**: rows expand to show a hotkey fire's full clipboard
  result, not just a byte count; broadened from hotkey-only to every
  run (Runbook/Composition Run clicks push directly, hotkey fires push
  via a Go→JS event) with client-side Source/Outcome filters over a
  session-only, in-memory 50-entry ring buffer — deliberately not
  persisted or date-ranged (distinct from workflow *definitions*
  persisting, closer to §7's still-open execution-history question).
  `LOCKED`.
- **Small `DEV` ribbon** (`App.tsx`, gated on `import.meta.env.DEV`,
  mount-time timestamp only — an HMR-self-subscription version was
  tried and reverted after React Fast Refresh left stray listeners).
  `LOCKED`.
- **Capability status index**: real Go data (`internal/domain/
  capabilities.List()`), not parsed markdown — deliberately not parsing
  this doc's own `LOCKED`/`OPEN`/`PARKED` tags out of prose (rejected as
  fragile; `spec-sync-checker`, §9.2, is the eventual place to close
  that drift risk). `CapabilitiesService.List()` drives the Spec tab's
  `CapabilityIndex` and, later, the sidebar (§3.5's restructuring
  superseded the index's original top-`UnderlineNav` presentation with
  a persistent sidebar once capability count overflowed Primer's "More"
  dropdown). A built capability's row links to its page; an unbuilt
  one opens a placeholder; one with an `EditorPath` (e.g. `docs/adr/
  0004-execution-process-tracking.md`) gets a dev-mode "Open in editor"
  action, verified to resolve to a file that exists today
  (`TestList_EditorPathsExist`), never an aspirational one. §5 (browser
  bridge) is deliberately excluded — a separate extension deliverable,
  not a Mill window page. `LOCKED`.
- **Window/scroll layout foundation**: `main.go`'s window sets
  `MinWidth: 640, MinHeight: 420` (Wails' own documented mechanism);
  in-page scrolling is the standard flexbox scrolling-pane pattern
  (`flex: 1 1 auto; min-height: 0; overflow-y: auto`), which needed a
  *bounded*-height flex root (`html { height: 100%; overflow: hidden }`,
  matching Wails' own overscroll-bounce guidance) and `App.tsx`
  rendering its own `.app-shell` flex-column root sized in `dvh` units,
  since Primer's `ThemeProvider`/`BaseStyles` inject plain `<div>`s
  between `#root` and Mill's content that would otherwise break the
  flex chain. The original `PageLayout.Sidebar` + collapse-to-icon-rail
  + light/dark/system theme switcher (via Primer's own `colorMode`/
  `useTheme()`, no custom theming layer) built here were themselves
  later superseded/extended by §3.5's own sidebar restructuring — this
  entry stays only for the still-true foundational CSS facts (the
  `.app-shell` root, the scrolling-pane pattern, `MinWidth`/`MinHeight`).
  `LOCKED`.
  **Update — a real, reported layout bug fixed, `.app-shell`'s own
  padding was the root cause, not `PageLayout` itself.** Prompted
  directly by screenshots: a visible gap between the window's left edge
  and the sidebar, and excessive dead padding around every page's
  content (including a cramped Composition canvas). Root cause was
  `.app-shell`'s own outer padding (golden-ratio tokens) wrapping the
  *entire* `PageLayout` — sidebar included — stacked on top of each
  page's own separate padding, applied twice. Compounding it: two
  ad-hoc CSS classes (`.page` 1400px, `.formPage` 960px, in
  `ListCard.module.css`) were hand-copied into 13 usages across 11 view
  files with no single owner, and `.page`'s own max-width was traced to
  a leftover
  760px *prose*-reading-width cap inherited wholesale when the class
  got reused for card/list/canvas UI it was never designed for.
  Researched before fixing (two passes, cross-checked against a direct
  fetch of Primer's own docs after the two disagreed on one claim):
  confirmed no adopted library exists for "fixed sidebar+content+footer
  shell with no page scroll" (the adjacent libraries —
  `react-resizable-panels`, `allotment`, `golden-layout` — all solve
  draggable/resizable panes, a different, heavier problem); confirmed
  Mill already uses Primer's `PageLayout` for this shell (adopted
  `a7fa116`) and Primer ships no separate app-shell primitive, so
  replacing it wasn't warranted — the three structural `:has()` hacks
  already in `App.module.css` are a sunk, working cost, not what was
  causing the reported bug; confirmed real design systems (Chakra, MUI)
  expose content-width capping as one shared `Container`-style
  component with a size variant, never a hand-copied class per page;
  and confirmed max-width capping is a prose-readability pattern real
  dashboard products don't apply to list/table/canvas UI. Fixed
  narrowly, without touching `PageLayout`: `.app-shell`'s own padding
  is now safe-area-insets only (sidebar/content/footer each already
  supply their own inset independently — Primer's `padding="condensed"`
  on the sidebar, `shared/PageContainer.tsx` on content, `.footer`'s own
  padding); `shared/PageContainer.tsx` (a `wide`/`narrow`/`full` variant
  prop) replaces `.page`/`.formPage` at all 13 call sites; `wide`
  (Workflows/Activity/every Configure list/the Runs panel — genuinely
  card/list-shaped) dropped its max-width entirely rather than move the
  same misapplied number; `narrow` (RequestForm/RequestSummary/
  SettingsView/ConfigureAttributes/the inline Lists/MCP-Servers create
  forms — genuinely single-column form UI, a legitimate width cap, not
  the same misapplication) kept 960px. `LOCKED`.

## 3. Capability composition — how nodes connect

- `OPEN`. Reference lineage: n8n (typed node inputs/outputs, credentials
  separated from node config, JSON workflow definition under the canvas) and
  React Flow / `@xyflow/react` (canvas engine; Vue Flow is the same team's Vue
  port — moot for us since Mill's frontend is already React).
- Not yet decided: node schema shape, how a "capability" is declared/
  registered, whether workflows are user-authored on a canvas or
  config-first with canvas as a later view.
- **Terminology, locked**: the composed artifact is a **workflow**, made
  of ordered **steps** — not "recipe," which this doc used
  inconsistently alongside "workflow" (the canvas/surface) for
  overlapping concepts. Both the reference decisioning platform (§3.2)
  and n8n (this section's other reference) call the composed thing a
  "workflow"; the reference platform's own language for what's inside
  one is "steps that is specific to the workflow" (relayed directly by
  the user, not paraphrased). Mill adopts that vocabulary everywhere —
  code, docs, UI — rather than maintaining two words for one concept.
  A **node type** stays the reusable, Mill-defined primitive a step is
  a configured instance of (unchanged naming — this only retires
  "recipe"). `LOCKED`
- **A concrete proposal for all three exists now, not yet accepted:**
  [`docs/adr/0005-capability-composition-node-schema.md`](adr/0005-capability-composition-node-schema.md).
  Drafted against a detailed feature breakdown of the same reference
  no-code decisioning platform named in §3.2 (kept generic there and
  here per the standing no-vendor-names rule) — its actual node taxonomy
  (Ruleset, Decision, Value Assignment, Integration, Code, Child
  Workflow, Parallel Steps, ML Model, Database Call) and its treatment
  of Form/JSON as a coequal authoring path alongside its canvas, not a
  fallback, directly informed the recommendation below. Also surfaced,
  not yet addressed anywhere in this doc: that reference platform has a
  draft/live versioning model with staged-traffic promotion that Mill
  has no equivalent of yet — real gap, deliberately left for a future
  decision once an actual Mill workflow exists to version.
  Recommendation (ADR-0005, `proposed`): two node families — MCP-tool
  nodes (schema inherited from the wrapped tool, per §3.1's already-
  locked MCP layer) plus a small, hand-written set of Mill-native
  control-flow nodes (Decision, Value Assignment, Parallel, Child
  Workflow) that stay Mill's own code per CLAUDE.md's core-domain rule;
  composed into a data-driven workflow (JSON), authored via a form/JSON
  side panel generalized from Runbook's current UI; React Flow deferred
  (not rejected) until 2+ real multi-step workflows exist to design a
  canvas against actual content instead of speculation. `OPEN` until
  accepted.
- **Composing a workflow is inseparable from configuring it — corrected
  by the user after the first prototype pass only showed a read-only
  preview.** A step is never a bare reference to a node type; it always
  carries that node type's configuration, resolved in full (explicit
  values or the node type's own declared defaults) the moment it's
  added to a workflow. There is no such thing as an unconfigured step —
  composing without configuring was named directly as "the most
  violation" of how workflow composition should work. `LOCKED` (the
  principle) — feeds directly into the prototype below.
- **`UX: PROTOTYPE` — a Capability Composition page tests ADR-0005's
  shape, and the compose-with-configure principle above, on real,
  working capabilities**, same "actually buildable now, de-risk before
  the full architecture is decided" discipline §2.2 used for the
  Runbook milestone. `internal/domain/composition` is a new, additive
  package (not a replacement for `internal/domain/runbook`, which stays
  exactly as-is, untouched, still the tested/tuned path) — its node
  primitives (`capture-clipboard-html`, `process-html-to-markdown`,
  `apply-clipboard-write-html`, `apply-clipboard-write-text`) call the
  *same* adapter functions Runbook's actions already call. One node
  type (`apply-clipboard-write-html`) now declares a real `ConfigField`
  (the HTML it writes, defaulting to the existing sample) instead of a
  hardcoded constant — the smallest real example of a configurable
  primitive, not a contrived one. The page lets a user **compose a new
  workflow**: pick node types, and each one's config fields appear
  inline the moment it's added — composing and configuring happen in
  one motion, never as separate passes. Built and user-composed
  workflows render as plain lists with their step chain as chips
  showing the actual configured values (not just the node type's
  label) — configuration stays visible as part of composition. Newly
  composed workflows **persist across restarts**, via
  `internal/adapters/settings` (the same JSON-file store
  `HotkeyService` already uses for hotkey bindings, reapplied verbatim,
  not a new mechanism) — deliberately scoped to persisting a workflow's
  authored *definition* only; persisting/resuming a *running* workflow's
  execution state stays §7's still-open question, untouched and not
  presupposed by this. What this prototype does *not* prove:
  `ExecuteWorkflow`'s errors are plain/technical, not Runbook's tuned
  soft-failure copy (deliberate simplification, not a regression — the
  careful UX still lives in `runbook.go`); node *types* stay Mill-
  defined, not user-authorable (a "define a new node kind" UI, the
  reference platform's separate Configure-surface-for-kinds idea, is a
  bigger, unproven feature, deliberately cut from this pass); and it
  says nothing about branching/parallel/typed-payload steps, still real
  future work per ADR-0005. §3 stays `OPEN`, ADR-0005 stays `proposed`
  — this is a testable prototype to react to, not a lock.
- **`CompositionCanvas.tsx` (React Flow / `@xyflow/react`) is the composition
  surface, adopted ahead of ADR-0005 B2's own stated deferral trigger ("2+
  real multi-step workflows exist to design against") by explicit decision
  — see ADR-0005's own Update section, not a silent resolution of §3's
  `OPEN` status.** Drag a node type from the palette onto the canvas,
  connect nodes by dragging between handles, click a node or edge to
  configure it in a right-side Inspector — composing and configuring
  happen in one motion. `Workflow.Nodes []Node` + `Workflow.Edges []Edge`
  (§3.3's schema) replaced the old `Workflow.Steps []Step`; the
  persisted-workflow settings key was versioned (`composition-workflows`
  → `composition-workflows-v2`) to orphan pre-canvas data harmlessly
  rather than migrate it. Companion libraries, picked from what real OSS
  React Flow projects (Langflow, Dify) pair with it: `zundo` (undo/redo,
  wrapping the canvas's own scoped zustand store, `canvasStore.ts`),
  `elkjs` (auto-layout, dynamically imported only when used — ~2.5MB in
  its own bundle chunk, dual-licensed EPL-2.0/GPL-3.0-or-later rather
  than MIT like the rest of Mill's tree, same shape as §3.1's MCP SDK
  license-transition note and worth the same compliance glance given
  the bank context), and `zod` (validates a draft workflow against the
  same shape `CreateWorkflow` receives, before Save). Graph validity is
  enforced at three points that must agree: `isValidConnection` at draw
  time (client), `ValidateGraph` (composition.go) at save/run time
  (server, since the client can't be trusted), and the zod schema at
  save time — a canvas can represent shapes the domain can't execute,
  unlike the old linear-list form. `UX: PROTOTYPE`.
- **A workflow opens into the canvas via "New workflow" or by editing an
  existing one, each in its own tab — `CompositionView.tsx`'s tab bar,
  built on `@primer/react/experimental`'s headless `Tabs` state/ARIA
  primitives via `shared/Tabs.tsx`'s thin markup wrappers (the package
  ships the hooks, not ready-made `Tab`/`TabList`/`TabPanel`
  components).** The Workflows list is a pinned, always-open tab;
  re-editing an already-open workflow reuses its tab instead of
  duplicating it. Every open tab's canvas stays independently mounted
  with its own state (Primer's `useTabPanel` hides inactive panels
  rather than unmounting them) — `canvasStore.ts` exposes a
  `createCanvasStore()` factory rather than a module-level singleton,
  so each mounted canvas tab gets its own store instance.
  `CompositionService.UpdateWorkflow` (Go) saves in place, same
  validation as create (`ResolveNodeDefaults`, non-empty label/nodes),
  keyed by the workflow's existing ID; built-in workflows aren't in the
  editable set (same disjoint-ID-space reasoning as Delete), so they're
  view- and Run-only with no Edit/Delete controls. The node-type
  palette lives in a collapsible "Add steps" panel (closed by default,
  toolbar-toggled) rather than an always-visible row. A brand-new
  workflow starts with one real node already placed
  (`capture-clipboard-html`) rather than a blank canvas or a fabricated
  stub — Mill deliberately has no Decision/Parallel/Child-Workflow stub
  node kinds (ADR-0005). `NodeInspector.tsx` holds the node-selected
  half of the Inspector (type swap, trigger-hotkey binding, the
  ConfigFields form, and `payloadNonce` — which forces fresh
  config-field defaults after a type swap or "Generate test payload"),
  split out of `CompositionCanvas.tsx` along the same seam
  `DecisionEdgeInspector.tsx` already established for the edge-selected
  half once the file crossed the 500-line limit (§1.3, at 538 lines);
  `CompositionCanvas.tsx` keys `NodeInspector`'s render by node id so
  switching the selected node remounts it cleanly, and
  `useHotkeyCapture` stays owned by the parent and is passed down as a
  prop rather than re-derived inside `NodeInspector`, since it's keyed
  by *workflow* id (not node id) and its live keydown-recording
  subscription must survive a node re-selection.
- **The "Add steps" palette groups `NodeType`s by Kind in a `TreeView`**
  (`NodePalette.tsx`, 13 types across 5 Kinds at the time — see §9.1
  for the process fix this prompted, checking the kit's collection/
  hierarchy components before hand-rolling one) rather than a flat list
  — the existing `draggable`/`onDragStart` drag-source mechanism
  (`CompositionCanvas.tsx`'s `onCanvasDrop` reads the dragged node type
  ID off the DOM event) carries over unchanged, since `TreeView.Item`
  spreads its remaining props onto the rendered `<li>`. Each leaf
  renders via `shortLabel()`, which strips the now-redundant
  `"<Kind>: "` prefix from `NodeType.Label` for display only (canvas
  node cards and saved-workflow step chips still use the full label),
  pairs it with a `title` tooltip carrying the full label, and styles
  it as a chip/card rather than plain nav-link text; the palette panel
  widened from 220px to 260px to fit. The e2e drag helper
  (`composition.spec.ts`) matches a stable `data-node-type-id`
  attribute rather than visible label text, since the display text is
  expected to keep changing independently of which node type it labels.
- **Dropping a node enforces the single-root rule and avoids overlap.**
  Every Trigger `NodeType` is structurally a graph root, so
  `NodePalette.tsx` disables every other Trigger entry once the canvas
  already has one (`onCanvasDrop` also rejects the drop client-side as
  a second layer, matching the draw-time/save-time-agree discipline
  §3.3's Decision work also follows) — `composition.go`'s `findRoot`
  already rejected a two-root graph at Save time, but nothing caught it
  earlier. `canvasLayout.ts`'s `findFreeDropPosition` nudges any
  dropped node along an outward spiral if it would overlap an existing
  node's fixed-size card, adapted from `@xyflow/react`'s own documented
  node-collision example (reactflow.dev/examples/layout/node-collisions).
- **A selected node can swap its `NodeType` in place, restricted to
  NodeTypes sharing its Kind** (`canvasStore.ts`'s
  `changeNodeType(id, nodeTypeID, label, config)` — same id/position/
  edges, no edge rewiring needed since `isValidConnection`'s per-kind
  rules and any already-drawn edges stay valid) — modeled on Zapier's
  own in-place trigger-event swap rather than n8n, which has no
  "replace node" feature (a standing, unresolved community request).
  Surfaced as a "Node type" `Select` in the Inspector, shown only when
  the selected node's Kind has more than one NodeType to choose from
  (most Kinds today have exactly one — Capture, Decision — where a
  single-option dropdown would be noise, not a control, same reasoning
  as §3.5's Configure recheck); the palette's disabled-Trigger tooltip
  points here directly rather than at delete-and-redrag.
- **Canvas-first layout: chrome collapses when unused rather than
  permanently reserving space**, matching the pattern's convergence
  across the workflow-builder space (n8n's inline-editable workflow
  name; React Flow's own `Panel`/`NodeToolbar` conditional-visibility
  primitives — the palette already did this via its own `paletteOpen`
  toggle). The workflow Label is a compact, always-visible input rather
  than a full-width form field; Description sits behind a disclosure
  toggle ("Add details"/"Hide details"), collapsed unless already set.
  The Inspector collapses to 0 width when nothing is selected and
  expands to 260px once a node or edge is. `UX: PROTOTYPE` still
  applies to Composition overall.

### 3.1 Raw material — root cause of the heredoc pain, not yet resolved

The actual heredoc frustration (see the mise/Taskfile discussion) isn't
about which task runner executes a shell string — it's that an LLM has to
freehand-generate shell syntax at all. Four related ideas surfaced together,
captured here before being lost, none yet resolved:

- **Bring-your-own-model chat bridge**: Mill could expose a Claude-Code-like
  agent loop where the user points it at any LLM (a local Ollama model, or
  any API key) and that model drives Mill's tools directly — Mill as "a
  bridge to your allowed folder," not itself an LLM client (consistent with
  §1.1's no-AI-API-from-Mill-itself rule — the model is always brought by the
  user/host, never bundled). Composability mechanism unclear — see below.
- **Declarative/no-code action definition**: reference pattern is a no-code
  decisioning platform style the user has worked with professionally —
  generic HTTP-connector nodes configured against external data
  vendors, with typed input/decision nodes wired into a workflow (see §3.2
  for the fuller pattern description — kept vendor-name-free deliberately,
  Mill's docs stay OSS-ready from day one, no citing specific commercial
  products by name). Applied to Mill: if a user has some CLI tool installed
  locally, expose it as a typed "action" (declared inputs/outputs) instead
  of the LLM freehand-generating a shell command to invoke it.
- **Diff preview**: frustration that a prior AI tool had no file-diff
  preview for a proposed change; floated IDE integration to get it. Likely
  not a separate feature — probably the same PreToolUse-style preview
  already planned in §8, just rendering a diff when the action is a
  file write instead of a raw command. Confirm this framing once §8 is
  worked.
- **Structured primitive tools with swappable backends**: instead of the LLM
  needing to remember shell invocations, Mill exposes stable primitives —
  `Read()`, `Write()`, `Find()` — whose implementation can be Mill's own
  default (e.g. `fd`/ripgrep-equivalent, or a RAG index) or something the
  user brings themselves.

**MCP verdict: good fit, adopt as the capability-exposure layer.** `LOCKED`
Researched and independently spot-checked (repo/release/go.mod/license all
confirmed directly, not taken on the research pass's word alone):

- **Go SDK**: [`modelcontextprotocol/go-sdk`](https://github.com/modelcontextprotocol/go-sdk)
  — official, "maintained in collaboration with Google," v1.7.0
  (2026-07-28). `go.mod` deps are 100% pure Go (`jsonschema-go`,
  `segmentio/encoding`, `golang-jwt`, `x/oauth2`, `x/time`, `x/tools`, etc.)
  — no cgo, no Rust, no Node/Python. Server *and* client roles both
  implemented. Clean fit with the single-binary constraint. License
  mid-transition MIT → Apache-2.0 (new code Apache-2.0; unrelicensed old
  contributions stay MIT) — confirmed directly against the repo's `LICENSE`
  file, worth a compliance glance given the bank context but not a blocker.
- **Bring-your-own-model is real, not assumed**: the spec is explicit that
  MCP "does not dictate how AI applications use LLMs" — the host owns the
  model choice, Ollama-or-any-key is genuinely in-scope, this isn't Mill
  inventing a workaround.
- **Wrapping a local CLI as a typed tool is the mainstream pattern**, not a
  novel use — see
  [github-mcp-server](https://github.com/github/github-mcp-server) (32k★,
  Go, single binary) as a real precedent.
- **No PreToolUse-equivalent exists in the MCP spec** — that stays entirely
  Mill's own responsibility, as expected. The Go SDK does expose a real seam
  for it though: `Server.AddReceivingMiddleware(...)` wraps `tools/call`
  before dispatch — the SDK's own examples only use it for response
  caching, not approve/deny, so Mill would be writing the actual guardrail
  logic, but the interception point already exists and doesn't need to be
  built from scratch.
- **No-code workflow canvas is confirmed out of scope for MCP** — its
  primitives are flat tools/resources/prompts with no chaining semantics.
  React Flow (§3's other reference) over MCP-exposed tools as nodes still
  stands as the composition layer on top.
- **Correction to the transport question**: local **stdio** transport is
  confirmed to be pure local IPC — "newline-delimited messages over the
  standard streams of a client-launched subprocess," zero network egress,
  never touches Zscaler or any network security stack. Remote transports
  (SSE, streamable HTTP) are the actual egress path and what enterprise
  MCP-security policy typically targets. Not verified against the bank's
  actual policy text — **worth asking IS&C directly** whether the block
  names remote/HTTP MCP specifically, since local stdio MCP may already be
  usable today regardless of the broader block.
- **Prior art worth reading before designing Mill's own version**:
  [mcphost](https://github.com/mark3labs/mcphost) (Go, Ollama-native, had
  hook-based tool approval) — archived April 2026, successor project
  "Kit." Closest existing thing to "Mill's idea #1," already attempted and
  abandoned once; worth understanding why before repeating its shape.
- **Alternatives checked, not just MCP confirmed in isolation**: Eino
  (ByteDance) and langchaingo are agent *frameworks*, not protocols —
  complementary at most, heavier than Mill needs, not competing options.
  MCP isn't overkill here; the alternative would be hand-rolling the same
  tool-schema contract worse.

**Open conflict this surfaces, needs a decision**: §1.1 locks "Mill is not
itself an LLM client — no AI API calls from Mill itself." Idea #1 above
(Mill running a chat/agent loop that drives a user-supplied Ollama model)
would make Mill an MCP **host**, which sits uneasily against that lock —
even though Mill wouldn't be calling a *paid* API or phoning home, it would
be the thing orchestrating a model's tool-calling loop, not just exposing
tools to be orchestrated. Mill as MCP **server only** (exposing guardrailed
tools, something else acts as host) fits §1.1 cleanly with zero tension.
`OPEN` — this determines whether idea #1 is in scope at all.

### 3.2 Composition pattern from professional experience — kept generic, no vendor names

Composition's shape borrows from a no-code decisioning platform (fintech
domain) the user has worked with professionally. Described here without
naming the product — Mill's docs stay citeable/OSS-ready, a standing rule
for this entry.

- **Three distinct surfaces, not two.** The reference platform separates
  **Settings** (global/app-level config — credentials, preferences, things
  that apply across the whole app) from **Configure** (where node *kinds* —
  input, decision, integration, and others — get defined: schema, required
  fields, auth for integrations) from the **workflow canvas** itself (where
  already-configured node *instances* get dragged in and wired together).
  Deliberately not collapsed into one screen just because both are
  nominally "configuration." Same type-vs-instance split n8n uses for its
  second half (node package defines the type; workflow canvas composes
  instances) — two independent references converging on the same shape.
  `LOCKED` (three-surface separation) — which settings live where, `OPEN`.
- **Cardinality differs by node kind.** Input nodes are 1:1 — configured for
  and used within a single workflow. Integration/vendor-connector nodes are
  reusable 1:* — one configured connector (e.g. one authenticated HTTP
  connector to a given vendor) can be wired into many different workflows.
  Decision node cardinality is unconfirmed — check before assuming either
  way when this gets designed.
- **Connector protocol/auth support should be incrementally extensible, not
  fixed upfront.** The reference platform started with plain HTTP and grew
  — driven by real, incoming vendor requirements — to also support
  XML/SOAP, OAuth and other auth schemes, and eventually mTLS. Lesson for
  Mill's own connector design (§4): build the generic HTTP connector
  first, but don't hardcode assumptions that would block adding SOAP/XML
  translation or new auth schemes later without a rearchitecture. Add real
  protocol/auth support when a real connector needs it, not speculatively.
- **A fuller UX/feature breakdown of the same platform** surfaced four more
  things, still kept generic:
  - **Left-nav surfaces beyond the three already locked**: Workflows
    (canvas) / Configure (node-type definition) / **AI Analytics** /
    **Review**. The latter two have no Mill equivalent — an
    analytics/observability view over past runs, and a case/queue-style
    review surface (statuses, visibility). Relevant to §7 (still `OPEN` on
    what a "history" view looks like) — Mill's Activity page is the
    closest thing to the analytics half.
  - **Per-record schema + single-record test harness.** The platform
    treats a workflow's record schema (metadata, mappings, attributes,
    JSON schema) as first-class, and lets you test one record via a Form
    or raw JSON before trusting a full run. Directly relevant to §3's
    node-schema question (ADR-0005 leans on this precedent) and to §8's
    requirement that a skip-condition rule be testable before going live.
    The Form half is built, via
    [ADR-0008](adr/0008-single-execution-path.md)'s test-input dialog
    (§3.4 has the full writeup) — an auto-filled, editable form per
    declared Attribute before a test Run. The raw-JSON half (paste a whole
    record instead of per-field inputs) stays unbuilt.
  - **Draft/live versioning with staged-traffic promotion — a real gap.**
    Edits create a new version; versions are tested/validated, saved as a
    draft, then promoted live with configurable traffic allocation (a
    canary/staged rollout, not an all-at-once cutover). Mill has no
    equivalent concept anywhere — no draft vs. live version, no rollout
    mechanism. `OPEN`: worth a real decision once an actual Mill workflow
    exists to version.
  - **Live + "shadow" events, filterable/exportable history.** The
    analytics surface shows live events plus "shadow" events (a
    draft/candidate version evaluated against real traffic without taking
    effect, for comparison) filterable by input/event type/date range,
    exportable. Relevant to §7's open analytics/history design, and
    precedent for §8's dry-run requirement — "shadow" is the same idea as
    a policy dry-run, applied to a whole workflow version instead of one
    rule.
  `OPEN` (all four — design input for §3/§7/§8, not decided here).
- **The reference platform's Integration/Connector surface, reviewed in
  depth via its create/view/edit/test flow.** Feeds §4.1's capability map
  and §10's open-questions log; nothing here is decided or built.
  - **Read/edit-mode split — the precedent [ADR-0014](adr/0014-configure-layout-inspect-vs-edit.md)
    later adopted for Mill's own Connector layout.** A saved integration
    opens read-only, in four tabs (Details — a flat key/value dump
    including masked secrets — Available attributes, Input parameters,
    Testing) plus explicit Delete/Duplicate/Edit; editing is a deliberate
    mode switch. The create/edit flow itself is one long single-column
    scroll, sectioned by plain headings (Name → Integration type →
    Connection → Request → Authentication → Additional headers → Input
    parameters → XML configuration → Output parameters → Caching) — no
    tabs while authoring. Opens as its own pinned tab in the platform's
    app-wide tab bar, the same tabbed-multi-editing shape Mill's
    `Tabs.tsx` already has. Takeaway: tabs belong on an already-saved
    record you're scanning, not on the act of authoring one.
  - **Connection mode — a connector-level, immutable-at-creation property
    with three options; ties into §3.4's open webhook-trigger row.**
    *Real-time* (call vendor, get a response instantly — Mill's only mode
    today, `integration-http`). *Send & wait* (call vendor, get the
    result later via webhook or polling — no Mill equivalent). *Receive
    only* (run workflow when an event is received — this **is** §3.4's
    own open "Webhook / incoming HTTP" trigger row, reframed as a
    connector property rather than a standalone Trigger kind). The
    reference platform locks this choice at creation — worth adopting as
    a design constraint regardless of implementation, since letting an
    already-wired workflow's execution shape change underneath it is a
    real correctness hazard. Send & wait plausibly maps onto DBOS's own
    durable-workflow signal/await primitives (already adopted, §7) rather
    than a hand-built correlation-ID mechanism — needs confirming against
    DBOS-Go's actual API before designing.
  - **Integration type (connector kind) — a real, closed list: Generic
    REST API (Mill's only kind today), BigQuery, Postgres, Redshift,
    Snowflake, Custom Python Function.** Concrete evidence for what
    future `HTTPRequest.Type` values would look like, matching this
    section's own "incrementally extensible, not fixed upfront"
    principle. "Custom Python Function" is a new idea — a connector
    backed by user-authored code rather than an external call — adjacent
    to but distinct from ADR-0005's deferred "Code" node.
  - **Auth is three independent, additive layers, not one dropdown.** A
    base Auth type (Mill's `none`/`apikey`/`bearer`, plus OAuth2 implied
    by observed "Auth token in header"/"Auth token in query" flags) plus
    two optional add-ons layered on top of any Auth type: **JOSE
    Encryption** (encrypts the outbound request, optionally decrypts the
    response via JWE) and **Mutual TLS** (client-certificate identity) —
    confirmed live by a real error message from a test run: "Invalid mTLS
    client certificate — verify P12 contents, alias and password." Neither
    existed anywhere in Mill's `AuthType` at the time (`none`/`apikey`/
    `bearer`). Adopt candidates: `crypto/tls.Config.Certificates` (stdlib)
    + `software.sslmate.com/src/go-pkcs12` (P12 decode, successor to the
    frozen `golang.org/x/crypto/pkcs12`) for mTLS; `github.com/go-jose/
    go-jose/v4` (JWE/JWS/JWT, RFC 7516/7515/7519) for JOSE.
  - **XML is a first-class, fully-parallel protocol mode, not a
    Content-Type footnote.** A real "Enable XML request and response"
    toggle, plus (from a saved integration's field dump)
    `xml preserve raw response`, `xml strip namespaces`,
    `xml response mode` (`"auto"`), `xml array force paths`,
    `unflatten response`, `content type value`. Mill's HTTP connector is
    JSON-only — exactly the gap this section's "started with plain HTTP
    and grew to also support XML/SOAP" principle anticipated. Adopt
    candidates: `github.com/clbanning/mxj` (XML↔`map[string]interface{}`,
    dynamic — fits Mill's runtime-configured, schema-less connectors
    better than stdlib `encoding/xml`'s struct-based model), or
    `github.com/basgys/goxml2json` for one-directional XML→JSON only.
  - **Schema authoring gets a "Paste sample" path** — infer the field list
    from a real example payload, for input and output independently.
    Distinct from Mill's then-existing three paths (paste raw OpenAPI,
    hand-author via Manual editor, CSV import): none inferred a schema
    from an example. Adopt candidate: `genson-js` (npm, MIT) — client-side
    JSON→JSON-Schema inference. Now built as a fourth `ManualSchemaEditor`
    accelerator, §4.1's table (ADR-0011's Update).
  - **Schema fields carried more than Mill's `Field` did at the time.**
    The output-schema editor's column set: Attribute*(name) / Type /
    Required / Alias / Default value / Description — Mill's
    `openapispec.Field` had no `Default`/`Description` (OpenAPI supports
    both; Mill's adapter just didn't surface them). Nine Types offered
    (Boolean, Number, Integer, String, Array, Object, Map, Date, Datetime)
    vs. Mill's original six; Object types recursively expandable (nested
    "Add field"); a String field could declare an Enum values list — the
    same idea as `ConfigField.FieldOptions`, one level down. Now built,
    §4.1's table (ADR-0011's Update).
  - **Output handling had three capabilities Mill had none of**:
    **Response extract path** — a document-level, JSONPath-like root
    extraction applied *before* per-field extraction (examples:
    `*`, `*.result`, `data.items[0]`, `$.data.result`) — complementary
    to, and more general than, Mill's per-field `x-mill-path` (ADR-0011),
    which only extracts one field at a time from an already-known
    response shape. Now built (narrower grammar, no bracket/`$.` syntax),
    §4.1's table. **Restructure response into nested fields** — a
    flattening/restructuring toggle whose exact semantics weren't legible
    from the review — flagged as genuinely uncertain, same as the
    deferred "primary key" concept (§4/ADR-0011). **Save a file from the
    response**, paired with **include a file with input fields** on the
    request side — file-bearing requests/responses are entirely
    unaddressed by Mill's connector model. Both `OPEN`, §4.1's table.
  - **Response caching — a real capability with zero Mill equivalent.**
    Stores and reuses API responses for identical requests within a cache
    window, matched by request content, headers, and record ID; a Cache
    duration (TTL, default 30 days) and a "Share cache across records"
    toggle. Valuable for a decisioning-style workload (avoid re-paying for
    an expensive external bureau lookup on identical input) but a real
    design surface of its own — cache key derivation, invalidation, where
    the cache actually lives (in-process vs. DBOS-backed vs.
    `internal/adapters/settings`). `OPEN`, §4.1's table — design question
    first, library pick after.
  - **The Testing tab, already built in Mill via ADR-0013, compared
    directly against a real equivalent** — two small gaps found, no
    fundamental redesign needed: the reference platform's test payload is
    one raw, colorized JSON blob (not Mill's per-field table), and its
    results are a collapsed table (Time sent / status icon) expandable
    per row, with a **"Copy error"** button. Both now built, §4.1's
    table.
  - **The Configure left-nav has more top-level entities than Mill's four
    Configure tabs.** Observed: Inputs, Attributes, Integrations,
    Decisions, ML Models, Jobs, Lists. New, unrecorded entities: a
    separate **Inputs** tab distinct from Attributes (scope/semantics
    unclear from the review), **ML Models** (already `OPEN`/deferred in
    ADR-0005's taxonomy discussion, §3.3), and **Jobs** (possibly Mill's
    Schedule-trigger concept, or a background-execution/queue view closer
    to §7's own execution-tracking machinery — genuinely unclear which).
    `OPEN`, real future research if any of these get prioritized.
- **A consolidated review, scoped to record only directly-observed
  behavior, resolved/corrected several items above and found real new
  surface area.** Kept generic; still `OPEN` throughout, nothing decided
  or built.
  - **Auth type is a 7-option catalogue, not the None/API-key/Bearer set
    Mill had.** Observed: None, Header, HMAC, a vendor-specific OAuth
    1.0a variant, OAuth 1.0 HMAC, OAuth 2.0, Query parameter. OAuth 2.0
    has real sub-configuration: grant type (`client_credentials`
    observed), token URL, client ID, client secret, OAuth scope,
    token-request content type. Now `LOCKED` and built — 5 of 7
    implemented, per §4.1's table ([ADR-0015](adr/0015-connector-auth-strategy.md)
    Phase 2).
  - **mTLS's full field set, now complete**: client certificate upload
    (`.p12`), keystore password, an optional certificate alias (defaults
    to the first key entry in the P12 if blank), an optional trusted CA
    bundle in PEM (defaults to the system trust store if blank), and a
    **"disable certificate validation"** toggle — flagged independently
    by the review as high-risk. Matches Mill's own fail-safe guardrail
    posture (§8) closely enough to adopt verbatim as a constraint if mTLS
    is ever built: never permit disabling certificate validation except
    through an explicit, governed non-production exception, not a plain
    checkbox. Implementation stays `OPEN`, §4.1's table (the extensibility
    seam itself is built, ADR-0015).
  - **SOAP/XML has a real templating layer, not just structural
    toggles.** A "SOAP version" field (`Standard XML` observed) and an
    "XML request template" supporting field substitution, conditionals,
    and iteration over arrays (a repeated-address-object example was
    observed). Go stdlib `text/template` (native conditionals/range) is
    the obvious first candidate to check against whatever the real
    expression grammar turns out to need — that grammar itself is **not**
    established even by this fuller review. `OPEN`.
  - **Response caching's match key is now fully resolved**: request body,
    headers, and record ID — record ID is part of the default cache key;
    "Share cache across records" removes only that record-ID boundary,
    identical requests still required otherwise. Confirms §4.1's design
    surface is real and specific, not vague — still `OPEN` overall.
  - **The QA/Testing surface, independently confirmed, closely matches
    what Mill already built (ADR-0013)**: one JSON record generated
    from/conforming to the input schema, Run/Test-again, Refresh,
    timestamped results, a success indicator, the parsed response —
    validates `ConnectorTestPanel.tsx`'s shape rather than surfacing a
    new gap. One caution worth carrying into Mill's own docs/UI copy: "a
    green transport result does not by itself prove the vendor returned a
    successful business outcome" — Mill's test log already separates
    transport status from a body's contents, satisfying this, but worth
    stating explicitly if the Test tab ever grows a pass/fail judgment
    beyond raw status.
  - **The Integration/node relationship is confirmed to already match how
    Mill is built, not a gap.** "An Integration is not itself a workflow
    node definition — it is a reusable typed capability configuration. A
    workflow node references the published Integration, maps workflow
    data into its typed input parameters, and exposes the typed output
    parameters to downstream steps." Exactly Connector (Configure-
    authored, reusable, §3.5) vs. `integration-http` (a workflow-scoped
    node referencing a `connectorId`, §3.3) — independent confirmation
    Mill's existing split is the right one.
  - **Ten reused UX/component patterns**, named as shared product
    primitives rather than per-surface implementations — the single most
    actionable finding for Mill's own frontend architecture, since it's a
    statement about *component reuse discipline*, the same concern
    `.claude/rules/frontend.md` already enforces one level down: a shared
    **resource-inventory table** (search, name-as-link, status badge,
    sort-by-updated, one primary create action, row-click opens without
    leaving the list — Mill's Connector/List/MCP-Server rows already look
    like this by convention, never formalized as one component); a shared
    **pinned work-tab shell** (Mill already built this for Composition,
    `Tabs.tsx` — the finding is that it should extend to Configure too);
    a shared **inspect-vs-edit split** (tab the read-only summary of a
    saved resource, use one full-width guided form for create/edit —
    never reuse inspect tabs as fragmented authoring steps); a shared
    **hierarchical schema-editor** (one component authoring Connector
    input schema, Connector output schema, Workflow Attributes, and any
    future fixture/test schema, differences expressed as configuration
    passed into one editor — Mill's `ManualSchemaEditor.tsx` is
    Connector-schema-specific only, not yet generalized this far); a
    shared **read-only typed-tree summary** (the same compact, searchable,
    type-badged tree for viewing a schema in Configure, a canvas node's
    config, a run's input/output, and a test fixture); a shared
    **secret-field pattern** (masked value + reveal control for a plain
    secret; upload-status + remove, never re-displaying contents, for
    certificate material — Mill's write-only secret design, §3.5, already
    gets the "never re-display" half right; formalizing certificate-shaped
    secrets the same way is new); a shared **progressive-disclosure form**
    (which fields appear is driven by prior choices — connection mode,
    auth type, JOSE/mTLS toggles, XML enablement — as one conditional-form
    framework, not a hand-coded flow per connector kind); a shared
    **test-and-evidence viewer** (one execution-result viewer reused by
    fixture testing, a real workflow run, and future Action/Playbook-
    shaped testing, distinguishing transport success / capability success
    / policy verdict / business result as four separate signals, not one
    conflated "green checkmark"); a shared **duplicate-and-edit action
    set** (consistent placement/confirmation/validation/dirty-state
    handling at both the resource level and the schema-row level — Mill's
    ADR-0013 Duplicate and `ManualSchemaEditor`'s row actions already do
    this independently, never checked against each other for
    consistency); and a shared **capability-reference-by-identifier
    pattern** (a workflow node configures a *binding* to a registry
    resource — Connector, List, MCP Server — referenced by immutable ID,
    never a copy of the resource's own definition — confirms Mill's
    existing `connectorId`/`listId`/`mcpServerId` `RefKind` picker design,
    ADR-0009, is already this pattern). None of these are being built now
    — a real, cited precedent for *if/when* Mill generalizes any one of
    its current per-surface implementations.
  - **A curated set of genuinely-still-unresolved questions**, even after
    this deeper pass — folded into §10 rather than reproduced here:
    Integration-level draft/publish/version/rollback lifecycle (distinct
    from the already-`OPEN` workflow-level draft/live versioning above);
    exact Send-&-wait/Receive-only webhook and polling field-level
    config, correlation contract, and inbound auth/signature
    verification; the full typed-field system beyond what's already
    listed (nullable semantics, files, unions); exact URL-path
    substitution syntax/escaping; non-2xx response handling; and the
    caching system's canonicalization/invalidation rules. Each is a "don't
    guess, research or ask before designing" flag for whichever of these
    Mill eventually prioritizes.

### 3.3 Capability map — designing the node/edge schema against the full known need, not just today's two workflows

Deciding the node/edge schema from today's two built-in, purely-linear
workflows risks locking in exactly the point-solution shape §0 already
names as a failure mode this project has been burned by once — a schema
that fits the narrow immediate case and has to be migrated (persisted
data and all) the moment a real branching/trigger use case surfaces.
The counter-discipline, applied here for the first time and worth
reusing whenever a schema/adopt-vs-build decision spans more than one
real future use: **list every known capability first, whether it's
something to adopt or something that must stay Mill's own, before
locking the schema** — not to build all of it now, but so the *shape*
of what's built now doesn't have to be undone later. See CLAUDE.md's
Plan step for this as a standing rule.

| Capability | What it needs to do | Adopt or build | Status / source |
|---|---|---|---|
| **Capture / Process / Apply** | Read structured state from a source, transform it, deliver it | Build (core domain) | `LOCKED`, §2 — built for clipboard/markdown |
| **Text injection** (a fixed hint/instruction pasted alongside a workflow's real output — e.g. telling an M365 Copilot chat what other tools are available) | Prepend or append configured static text to the payload | Build (core domain, `process-inject-text`, ADR-0006's self-registration pattern) — no templating engine; conditional injection composes for free with an upstream Decision node instead of adding branching logic to the node itself | `LOCKED`, built — `internal/domain/composition/processinjecttext.go`, e2e-verified (`composition-canvas-interactions.spec.ts`) end-to-end including via the generic ConfigField Inspector, no bespoke UI |
| **Trigger** | Entry-point node: listen for *any* event source (hotkey, clipboard change, a browser-bridge DOM event per §5, an incoming MCP `tools/call` per §3.1, a schedule) and emit its data as the workflow's starting input — not "the hotkey mechanism," a general category the hotkey is one instance of. A trigger's output *is* the workflow's input; these are one concept, not two. | Each concrete event source adopts its own library behind an adapter (hotkey/schedule/filesystem-watch do; clipboard-watch is a small build); the abstraction unifying them into one node kind, and `TriggerService`'s registry/exclusivity, are Mill's own | `LOCKED`, built (manual/hotkey/schedule/clipboard-watch/filesystem-watch) — see §3.4 for the fuller map. DOM-event and MCP-call triggers remain unbuilt, gated on §5/§3.1 |
| **Decision / branching** | Route execution down one of several named output edges based on a condition evaluated against the running payload | Node/graph semantics: build (core domain — composition rules). Expression evaluation underneath: adopt (`expr-lang/expr`, MIT, sandboxed/side-effect-free/loop-bounded by design — verified directly, not assumed) rather than hand-writing a condition parser | `LOCKED` (execution engine + authoring) — `internal/domain/composition`'s `ExecContext`/`ValidateGraph`/`nextNode` walk real Decision branches end-to-end; `KindDecision` + `decision-route` NodeType render and connect on the canvas. Conditions are authored visually via a `react-querybuilder` rule builder (`DecisionEdgeInspector.tsx`), translated to `expr-lang/expr` — see §3.5's Decision row |
| **Parallel Steps** | Fan out to multiple steps concurrently, then join | Graph/fan-in semantics: build. Concurrency execution: DBOS's `Queue`/`WithWorkerConcurrency` (§7) is a plausible real backing mechanism once designed, not hand-rolled goroutine management | ADR-0005 names it, deferred |
| **Child Workflow** | One workflow invokes another as a step | Graph/node semantics: build. Execution: **adopt** — DBOS (already adopted, §7) has real, native parent/child primitives (`RunWorkflow` called from inside a running workflow auto-tracks `ParentWorkflowID`; a workflow ID is DBOS's own idempotency key), corrected from ADR-0005's original "no library has an opinion" verdict | `LOCKED` — [ADR-0010](adr/0010-child-workflow.md), built |
| **Integration / Connector node** | Call an external HTTP API, auth'd | Wire protocol: adopt (stdlib `net/http`, via `internal/adapters/httpconnector`). Connector config/credential model: build (`internal/domain/connector`) + adopt (`zalando/go-keyring` via `internal/adapters/credential`) | `LOCKED` (execution) — `internal/domain/connector`'s `Connector{ID, Label, Type, BaseURL, AuthType, Headers}` + a new `integration-http` `NodeType` (`KindProcess`) execute real HTTP calls, resolving `AuthType`/secret into the right header (`X-Api-Key` or `Authorization: Bearer`) via `composition.SetConnectorLookup`'s injected seam (mirrors `TriggerService`'s `Syncer` pattern — the domain package doesn't own connector storage). §4 stays `OPEN` on the Configure-surface UI to author a Connector; see §3.5's own row |
| **List** (a reusable lookup/reference dataset) | Look up an Attributes value against a named, Configure-authored table, write the match back into Attributes | Build (core domain — no library has an opinion on Mill's own List model; the lookup itself is a plain map read) | `LOCKED` (execution) — `internal/domain/list.List{ID, Label, Entries}` + a new `list-lookup` `NodeType` (`KindProcess`) resolve a `listId` via `composition.SetListLookup` (same injected-seam pattern as Integration/Connector's `SetConnectorLookup`) and write the matched entry into `ExecContext.Attributes[outputKey]`. Not in ADR-0005's original taxonomy at all (a real gap flagged in §3.5) — added here as the first thing built against it. §3.5 stays `OPEN` on the Configure-surface UI to author a List |
| **MCP tool call** (§3.6's extension point — call a tool on a Configure-authored MCP server) | Call one tool on a locally-configured MCP server over stdio, replace the payload with its text result | Wire protocol: adopt (`modelcontextprotocol/go-sdk`'s client role, via `internal/adapters/mcpclient`). Server config/CRUD: build, same shape as Connector | `LOCKED` (execution + authoring, end-to-end) — `internal/domain/mcpserver.MCPServer{ID, Label, Command, Args}` + a new `mcp-tool-call` `NodeType` (`KindProcess`) resolve an `mcpServerId` via `composition.SetMCPServerLookup` and call `toolName` with `argumentsJSON`. Verified against a real spawned subprocess (an official MCP reference server via `npx`), not just unit tests — see §3.6 for the full writeup. This is the "add a new capability without a core code change" answer §3.6 set out to find |
| **Durable step execution / retry / resume** | Survive the process dying mid-workflow, checkpoint per step, retry transient failures | Adopt (DBOS-Go) | `LOCKED` — ADR-0004 `accepted`, `internal/adapters/execution` + `executionservice.go` built and e2e-verified; a real regression test (`TestResumeAfterFailure_DoesNotReExecuteCheckpointedStep`) proves a checkpointed step doesn't re-execute on resume against a real DBOS SQLite runtime. Since [ADR-0008](adr/0008-single-execution-path.md), this is the *only* execution path — every run is durable, not an opt-in alternative to a plain in-memory Run |
| **Replay / re-run from history** | Re-invoke a past run, ideally resuming rather than restarting | Mechanism: adopt (DBOS `ForkWorkflow`/workflow-ID resume). UI/policy: build | `LOCKED` — a workflow's own Runs tab's "Redrive from here" (`ExecutionService.RedriveRun`, `dbos.ForkWorkflow`) is exactly this, built and e2e-verified |
| **Draft/live versioning** | Edit a workflow without breaking the currently-live version | Build (no library owns Mill's own versioning semantics -- verified against installed DBOS v1.0.0: its `ApplicationVersion` versions the app binary, not definition data) | `LOCKED`, built -- [ADR-0021](adr/0021-workflow-lifecycle-and-versioning.md): head = draft, `Versions` = immutable snapshots, `PublishedVersion` = live (publish ≡ live), `Disabled` pauses triggers/child calls while test runs stay allowed (n8n's semantics); child-workflow version pinning; every run records its executed version. Shadow evaluation explicitly deferred (side-effectful nodes need §8's purity model first) |
| **Live + shadow events / execution history** | Filterable log of past runs; dry-run a candidate change against real traffic before trusting it | Data: adopt (DBOS `GetStatus`/`ListWorkflows`). UI: build | `LOCKED` (execution-history half) — §7's per-workflow Runs tab (`WorkflowRunsPanel.tsx`, `ListRunsForWorkflow`/`GetWorkflowSteps`) built and e2e-verified. Shadow-events (dry-run a draft version against real traffic) stays unbuilt — no draft/live versioning concept exists yet (§3.2's own draft/live versioning gap, still real) |
| **Guardrail preview / policy gate** | Approve/deny before a step actually runs | Build (core domain — no library has an opinion on Mill's guardrail semantics) | §8, `LOCKED` in shape, `OPEN` in detail |
| **Visual composition surface** | Author a DAG, not just a list | Adopt (React Flow / `@xyflow/react`) — built ahead of ADR-0005 B2's original deferral trigger, by explicit decision (see the ADR's Update section) | §3, `CompositionCanvas.tsx`, `UX: PROTOTYPE` |

**React Flow, checked directly against its actual source/docs (not
assumed) specifically to shape the schema now without adopting the
canvas yet**:
- MIT-licensed. Its own runtime dependencies are `@xyflow/system`
  (its own internal package), `classcat` (a tiny classname utility),
  and **`zustand`** — already an adopted Mill dependency for frontend
  state (§1.3) — one of React Flow's three dependencies is something
  Mill already vetted for an unrelated reason, not new surface.
- A React Flow node is `{id, type, data, position}` — `type` maps via
  a `nodeTypes` registry to a component, `data` is arbitrary. This is
  already close to `composition.Step{NodeTypeID, Config}` — adding
  `Position` (ignorable until a canvas exists) is the only real gap.
  Not a coincidence worth engineering around; a reason to shape Mill's
  own schema this way now, so adopting the canvas later is additive,
  not a migration.
- A node can expose multiple named `Handle`s, and edges reference a
  specific `sourceHandle` — this is exactly a Decision node's "yes"/
  "no" (or N-way) branching, natively, not something to hack around.

**Schema direction this map and the React Flow shape point to — now
built, not just captured as design input:**
`Node{ID, Kind, NodeTypeID, Config, Position}` +
`Edge{ID, Source, SourceHandle, Target}`, replacing the former flat
`Workflow.Steps []Step` (`internal/domain/composition/composition.go`).
`LOCKED` as the schema actually in use — ADR-0005 itself stays
`proposed` (not `accepted`), since the A2 control-flow-node question and
the versioning/replay gaps this map names are still real, unbuilt future
work; only the node/edge shape moved from proposed to shipped.

**Decision node execution and authoring are built, no dedicated ADR.**
A Decision node's outgoing edges are evaluated in order, first match
wins, with exactly one required `"otherwise"` edge as fallback.
`ValidateGraph` compiles every edge's `expr-lang/expr` condition
against the workflow's declared `Attributes` schema at *save* time (a
bad expression or a missing `otherwise` is rejected before Save
succeeds); `nextNode`/`ExecuteWorkflow` walk the same conditions at
*run* time. `ExecContext{Payload, Attributes}` is what a condition
evaluates against — `Attributes` seeds from the workflow's declared
schema at each field's zero value, overridable by a real Run value
(§3.4). `internal/adapters/expression` wraps `expr-lang/expr`
(`Compile`/`Eval`) behind Mill's own names. On the canvas,
`KindDecision` + a single `decision-route` NodeType (no
`ConfigFields` — its conditions live entirely on its edges) render
with a real icon (`GitBranchIcon`); `isValidConnection` exempts
Decision nodes from the single-outgoing-edge limit every other kind
still has, checked again client-side by the draft-workflow zod schema
and authoritatively by `ValidateGraph` server-side.

A condition is authored visually, not by hand-editing JSON:
`DecisionEdgeInspector.tsx` (opened via `onEdgeClick`, for any edge
whose source is a Decision node) hosts a **`react-querybuilder`**
(MIT, v8.x — its own `@reduxjs/toolkit`/`react-redux` runtime
dependency is an accepted, bounded cost) rule tree, translated to a
real `expr-lang` boolean expression by `frontend/src/ruleTranslate.ts`'s
`translateToExpr` (`==`, `!=`, `<`, `>`, `<=`, `>=`, `&&`, `||`, `!`,
`in [...]`, `contains`, `startsWith`, `endsWith` — locked by Vitest
cases and independently checked against the real Go `expr` package).
Fields offered to the builder come from the owning workflow's real,
Configure-authored `Attributes`. The condition is stored in React
Flow's own `edge.data.condition` (mirrored to `edge.label` for
on-canvas visibility) — not `edge.sourceHandle`, which carries a
distinct, React-Flow-specific meaning (which physical `<Handle id>`
an edge attaches to). **Deliberately one-way**: there is no parser
from an already-saved expression string back into the visual tree —
the builder always starts empty, shows the current saved condition as
read-only text alongside it, and a raw-text input is the power-user
fallback for editing an expression directly. Full design rationale in
[ADR-0018](adr/0018-decision-execution-and-rule-builder.md). `LOCKED`.

**Child Workflow is built** — see
[ADR-0010](adr/0010-child-workflow.md) for the full design (DBOS's
native parent/child execution via `dbos.RunWorkflow`, the
`trigger-callable` entry-point NodeType, the `workflow` `RefKind` on
the entity picker (ADR-0009), and `ExecContext.RunContext`'s opaque
per-run seam). **Not built, named explicitly**: a "show this run's
children" UI on a workflow's own Runs tab (`ParentWorkflowID` is
already tracked via DBOS, just not surfaced), cascading cancel/delete-with-children
exposed anywhere in Mill's own UI, and cyclic child-workflow detection
(A→B→A) — a real workflow hitting this is the trigger to revisit, not
speculative upfront. `LOCKED`.

**Typed input AND typed output across the parent/child boundary are
demonstrated by a seeded pair, with the two small engine gaps that
blocked it closed — `LOCKED`, built, prompted directly.**
`capture-attribute` (a new self-registered `KindCapture` NodeType, its
whole addition one new file per ADR-0006's pattern — deliberately also
serving as the freshest worked example of that extension point) reads
one of the workflow's declared Attributes into the payload, which is
how a callable child actually *uses* its typed input
(`process-inject-text` is deliberately literal-only). `child-workflow`
gained an optional `outputAttribute` config: the child's result still
becomes the parent's payload, and is *also* written into the named
parent Attribute, so downstream steps (a Decision condition, another
binding) can reference it as typed data. `BuiltInWorkflows()` seeds
"Example: Echo message (callable child)" (declares a `message`
Attribute, reads it, appends a visible marker) and "Example: Parent →
child call" (binds `{"message": "hello from the parent workflow"}`
in, stores the result into its own `childResult` Attribute). Proven
end-to-end twice, not assumed: a Go test runs the exact seeded pair
against a real DBOS runtime and asserts the exact typed round-trip
output plus the tracked parent/child relationship
(`TestSeededParentChildExample_TypedInputAndOutput_RunsEndToEnd`), and
the same run was driven live through the real UI on a fresh-seeded
instance. Reaches existing instances via top-up seeding (§2.2's Update below). Hover-preview of the child from the parent, and jump-to-
child-from-parent, are part of the recorded hover-preview design input
(§3.8) — not silently dropped, not bolted on ad hoc here.

**Lifecycle & versioning are built — [ADR-0021](adr/0021-workflow-lifecycle-and-versioning.md),
`accepted`, and the seeded pair now demonstrates them end to end (the
standing seeded-examples principle, below).** The canvas edits the
draft; **Publish** snapshots it and makes it live (publish ≡ live —
confirmed one concept with the user); triggers and child calls execute
only the published snapshot (`ResolveRunnable`, and
`TriggerService.Sync` arms listeners from the published snapshot, so a
draft's edited schedule never rewires a live listener); **Disabled**
pauses production while test runs keep working (n8n's exact
semantics); a child-workflow step can **pin** a specific child version.
The editor gains a **Versions** inner tab (publish / make-live /
load-into-draft / enable-disable, Primer DataTable); list rows badge
`vN live`/`draft`/`disabled`. Seeded proof: the callable child ships
with v1 published and a deliberately different draft; the parent pins
v1 — running it (Go test against real DBOS + a real-UI e2e) outputs
v1's marker, never the draft's. A third seed, "Example: Disabled
schedule," ships disabled with an every-minute schedule that
never arms until enabled. **Seeding is top-up now, by direct user
decision ("every feature we build needs proof with a seeded
example")**: restore appends any built-in whose ID is neither present
nor tombstoned (deleting a built-in records a tombstone, so §2.2's
fully-deletable principle survives), for Workflows and HTTPRequests
both — a newly shipped example reaches existing instances, not just
fresh installs. Explicitly deferred in ADR-0021, named not dropped:
shadow evaluation (needs a per-node purity/suppression model — §8),
staged-traffic promotion, and a visual version-diff UI.

### 3.4 Trigger primitives — capability map

§3.3's Trigger row was one line (`Kind: trigger`, `Source: "hotkey"`
(extensible)) — accurate as far as it went, but a real Trigger capability
has enough independent variety (delivery mechanism, config shape, adopt
target) that collapsing it into a single table row undersold it. Same
discipline as §3.3, applied one level deeper: list every known trigger
type before locking anything, researched against real precedent (n8n,
Zapier, Raycast — chosen because they're the platforms already anchoring
this design elsewhere in this doc) rather than invented from Mill's two
existing entry points (hotkey, manual click).

**Built** — `KindTrigger`, five `NodeType`s, `TriggerService`, typed
`ConfigField`s, hotkey exclusivity, and payload generation are all
real code; the design reasoning below is accurate as originally
written, not a later correction.

**Grouping is by delivery mechanism, not business domain** — this is the
axis that actually determines config shape and the adopt-vs-build call
(a webhook and an MCP tool call are both "push," even though one is
"an app event" and the other is "an agent action"; grouping by domain
would have hidden that the two need nearly identical plumbing). Directly
confirmed against n8n's own docs, not assumed: n8n's own app-specific
triggers are themselves classified as "polling (checks the service on a
regular interval) or webhook/real-time (service pushes events instantly)"
— the same split used here.

| Group | Shape | What differs in config |
|---|---|---|
| **A — Manual/UI-driven** | User directly fires it, synchronous, no listener process | Just "which workflow" |
| **B — Scheduled/polling** | Mill wakes up on an interval and checks something | Interval/cron expression, poll target |
| **C — Push/event-driven** | An external source notifies Mill immediately, no polling | Listener/endpoint config, varies per source |
| **D — System/meta** | Fired by Mill's own execution engine, not an external source | Which upstream event (run failed, workflow updated) |

| Trigger | Group | What it needs to do | Adopt or build | Status |
|---|---|---|---|---|
| **Manual (UI click)** | A | User clicks Run/Test on the workflow | Build (Mill's own UI) | `LOCKED`, built — `trigger-manual` NodeType, every workflow's default starter node; no listener process, purely on-demand |
| **Hotkey (global shortcut)** | A | OS-level combo fires headlessly, even when Mill isn't focused | Adopt (`golang.design/x/hotkey`, already adopted, §2.2) | `LOCKED`, built — `trigger-hotkey` NodeType, registered/exclusivity-checked through `TriggerService` (`triggerservice.go`), binding captured via `CompositionCanvas`'s Inspector (`hotkeyCapture.ts`, extracted from the now-retired RunbookView) |
| **Schedule / cron** | B | Fire on an interval or cron expression | Adopt — **not** `robfig/cron` (confirmed unmaintained since 2020, known panic/DST bugs, 50+ open PRs); `go-co-op/gocron` still wraps `robfig/cron/v3` underneath so it doesn't actually escape the problem. **`netresearch/go-cron`** (MIT) is a maintained, API-compatible fork that fixes exactly those bugs and tracks current Go | `LOCKED`, built — `trigger-schedule` NodeType, `internal/adapters/schedule` |
| **Clipboard change (watch)** | B | Detect clipboard content changing | Build — confirmed by reading `internal/adapters/clipboard` directly: it's `osascript`/`pbcopy`/`pbpaste` shell-outs with no "clipboard changed" event exposed anywhere in AppleScript; needs a small poll loop, same as every clipboard manager does this | `LOCKED`, built — `trigger-clipboard-watch` NodeType, `clipboard.WatchChanges` (polls the plain-text flavor, not HTML, since HTML is frequently absent) |
| **Filesystem watch** | C | Fire when a file/folder is added/changed/deleted | Adopt (`fsnotify/fsnotify` — BSD-3-Clause, actively maintained, wraps OS syscalls — kqueue on macOS/BSD — via `golang.org/x/sys`, no cgo, no daemon) | `LOCKED`, built — `trigger-filesystem-watch` NodeType, `internal/adapters/filewatch`; direct analog to n8n's Local File Trigger |
| **DOM event (browser bridge)** | C | Fire when a watched selector/element changes in a tab | Build (the relay itself is Mill's own §5 mechanism, already `LOCKED`) | `OPEN` — blocked on §5's still-open "reachable independent of native window" question |
| **Incoming MCP tool call** | C | An agent/chat client invokes one of Mill's exposed tools | Adopt (Go SDK's `Server.AddReceivingMiddleware`, already `LOCKED`, §3.1) | `OPEN` as a graph Trigger kind — validated as a real, established category (not a Mill invention) by n8n shipping its own dedicated MCP Server Trigger node |
| **Webhook / incoming HTTP** | C | External service POSTs an event to a Mill-owned endpoint | Not a library gap — Mill already runs an HTTP server in server-mode (Wails3 + stdlib `net/http`); the open question is purely whether Mill should run a public listener at all | `OPEN` — a scope/threat-model decision, not an adoption decision |
| **App/connector-specific** (e.g. email/IMAP) | B or C | Poll or push scoped to one external service | Depends on §4 Connectors | `PARKED` until §4 resolves — not a distinct Trigger *kind*, a connector-scoped instance of Group B/C |
| **System/meta** (run failed, workflow updated) | D | Fired by Mill's own execution engine | Build, depends on §7 | `PARKED` until §7's execution engine lands — direct analog to n8n's Error Trigger / Workflow Trigger |
| **Callable by another workflow** | D | Fired only when a Child Workflow node (docs/adr/0010) invokes this workflow — never a real external event | Build (composition rule; execution rides on DBOS's native parent/child call, already adopted §7) | `LOCKED`, built — `trigger-callable` NodeType, no listener process (same shape as `trigger-manual`); direct analog to n8n's Execute Workflow Trigger |

**Architecture conclusion: each trigger type is its own `NodeType` under
one new `NodeKind = "trigger"`, not one generic Trigger node with a
`Source` dropdown.** Confirmed against real precedent, not assumed: n8n
and Zapier both expose "Webhook Trigger," "Schedule Trigger," and
"Manual Trigger" as separate, distinctly-named, separately-configured
node types in their palettes — never one polymorphic node whose fields
change based on a picked value. This maps directly onto Mill's *existing*
`NodeType`/`NodeKind` split (`composition.go:51-76` — `NodeKind` is
already the coarse category, `NodeType` is the concrete, separately-
configured thing dragged onto the canvas, each with its own
`ConfigFields`) — additive, not a new mechanism: `trigger-hotkey`
(mods + key fields), `trigger-schedule` (a cron-string field),
`trigger-clipboard-watch` (no fields), `trigger-filesystem-watch`
(path + event-type fields), `trigger-mcp-call` (tool-name field), each
a normal new `NodeType` entry (`trigger-mcp-call` remains unbuilt, gated
on §3.1's own open MCP-host question). The canvas palette
(`CompositionCanvas.tsx`) needed zero new UI concept to support this --
confirmed, not just predicted: the existing palette/Inspector code
rendered all five new Trigger `NodeType`s correctly with no changes
beyond adding their entries to `NodeTypes()`. `LOCKED`, built.

**`ConfigField` needs a real type, modeled on n8n's own node-parameter
taxonomy rather than invented from scratch.** Confirmed directly against
n8n's docs: its parameter types are `string`, `number`, `boolean`,
`options` (single-select), `multiOptions`, plus more advanced ones
(`collection`, `fixedCollection`, `resourceLocator`) that map to Mill's
own not-yet-built Decision/Parallel nodes, not needed now. The subset
Mill actually needs today — `text` / `number` / `boolean` / `options`
(with an `Options []string`) — replaces `ConfigField`'s current
flat-string-only shape (`composition.go:63-68`, `Key/Label/Description/
Default string`, no type discriminator at all), which is what's
currently blocking a source-picker on the Capture node, a provider-
picker on the Process node, or a typed field on any trigger. `LOCKED`,
built -- `CompositionCanvas.tsx`'s Inspector switches on `field.Type`
(`text`→`TextInput`, `number`→`TextInput type="number"`,
`boolean`→`Checkbox`, `options`→`Select`); a Capture source-picker and
Process provider-picker aren't built yet themselves (no node type needs
one today), only the typing mechanism they'll use.

**Payload/example generation reuses zod, already adopted — no second
schema system needed.** The "intelligently generate a sample payload
from the input's typed schema" ask (matching the reference platform's
own per-record test harness, §3.2) doesn't need full JSON Schema, which
would be heavier than Mill's actual need and would require Go and TS to
each maintain their own library for a document-validation problem this
small. The frontend already has `zod` adopted (validates a draft
workflow before Save) — **`@anatine/zod-mock` turned out not to fit**:
checked directly at integration time, not just at research time, its
peer dependency is pinned to `zod: '^3.21.4'` only, and Mill's frontend
already pins zod v4. **`zod-schema-faker`** (MIT, also wraps
`@faker-js/faker`) is the one that actually supports what's installed
(`zod: '^3.25.0 || ^4.0.0'`, confirmed via npm) — same idea, correct
library. `frontend/src/configSchema.ts`'s `configFieldsToZodSchema`
builds an ad-hoc zod object schema from a node type's typed
`ConfigFields`, and a "Generate test payload" button (shown for a
selected Trigger node with `ConfigFields`, e.g. `trigger-schedule`/
`trigger-filesystem-watch`) runs `zod-schema-faker`'s `fake()` against
it, filling the Inspector's fields in place. `LOCKED`, built.

**A workflow's declared Attributes reuse the same sample-payload
mechanism.** `configFieldsToZodSchema`/`generateSamplePayload` are
generalized to a minimal `TypedField{Key, Type, Options?}` shape both
`ConfigField` and `AttributeDef` satisfy — no second schema-generation
function. Composition's Run button opens a `TestRunDialog` pre-filled
via `generateSamplePayload` whenever the target workflow declares one
or more Attributes (skipped entirely for a workflow with none — every
built-in today); submitted values flow through `ExecuteOptions.AttrValues`
(`executionservice.go`'s `runInput.Values`) into `attributesEnv`,
overriding the zero-value default a Decision condition would
otherwise evaluate against. See
[ADR-0008](adr/0008-single-execution-path.md) for how this attaches
to the single execution path. `LOCKED`.

**Hotkey exclusivity: one combo maps to at most one workflow, conflict
surfaced at capture time — not "fire every workflow listening on that
combo."** Modeled directly on Raycast's own real conflict UX, confirmed
by research rather than assumed: when recording a shortcut that
conflicts with an existing command, Raycast's recorder highlights red,
names the owning command, and offers two choices — pick a different
combo, or overwrite (steal it, and the other command loses its
binding). macOS System Settings does the same red/yellow-warning
treatment for its own built-in shortcuts, but has no visibility into
third-party apps' bindings — confirming this has to be Mill's own job,
not something the OS provides for free. "I want two things on one
keypress" is answered by workflow composition (Child Workflow, §3.3,
already named future work) once it exists, not by hotkey fan-out — keeps
the trigger primitive itself 1:1 and unambiguous. **Real gap confirmed
by reading the code, then fixed, not just described**: the old
`HotkeyService.Assign` never checked whether a `(mods, key)` combo was
already claimed by a *different* action before calling `hotkey.Bind`,
which registered unconditionally every time. `TriggerService.
AssignHotkey` (`triggerservice.go`) fixes this: `internal/domain/
trigger.CheckConflict` (a pure, independently-tested function) checks
every other workflow's persisted binding before registering, and rejects
with an error naming the conflicting workflow if one already holds that
exact combo (comparison is mod-order-independent — `cmd+shift+M` and
`shift+cmd+M` correctly collide as the same combo). `LOCKED`, built.

**Resolved — `HotkeyService`'s hardwiring to Runbook is gone, not just
repointed.** The old `HotkeyService` (actionID-keyed, hardwired to
`internal/domain/runbook.Run`) is deleted entirely, replaced by
`TriggerService` (`triggerservice.go`): workflow-ID-keyed persistence
(`triggerHotkeyBindingsKey`, superseding the old `hotkeyBindingsKey`),
`Sync(workflows)` reconciling every live listener (hotkey/schedule/
clipboard-watch/filesystem-watch) against the current workflow set from
scratch on every call (simpler than diffing, and cheap at Mill's scale),
and `AssignHotkey`/`UnassignHotkey`/`ListHotkeys` as the Wails-bound
entry points the frontend's `hotkeyCapture.ts` hook calls. This also
resolved the Runbook-retirement question §2.2 previously left open —
see §2.2's own Update note.

### 3.5 Configure surface — capability map

§3.2 already recorded "three distinct surfaces, not two" (Settings /
Configure / workflow canvas) after the reference-platform review, but
never built any of it — Mill's canvas today conflates Configure and
canvas entirely, since every `NodeType` is hardcoded Go and nothing is
user-authored. This section resolves that into a real map, prompted
directly by the user naming the actual gap: connectors belong under an
Integration category inside Configure, and several other node kinds
(Input, Attributes, Decision, List) need the same dedicated-surface
treatment "instead of inside the workflow," even though their *reuse*
cardinality differs from a connector's.

**Two orthogonal axes, not one — this is the clarification that actually
resolves the request, not just restates it.** "Lives in Configure" and
"reusable across workflows" sound like the same question but aren't:
Configure vs. inline-canvas is about *where a node kind's configuration
gets authored* (a dedicated screen with room for a real editor, vs. a
few fields in the canvas Inspector's narrow side panel); reuse
cardinality is about *how many workflows one configured instance can
serve*. A connector is Configure-authored **and** reusable (1:many). An
Input/Attributes definition is Configure-authored **but still scoped to
one workflow** (1:1) — exactly what "some of these can only be used in a
single workflow at once" was naming. Conflating the two axes would have
made every Configure-authored kind look reusable by default, which isn't
true and isn't what was asked for.

| Node kind | Authored where | Reuse cardinality | Status |
|---|---|---|---|
| Trigger config (cron expression, watch path, hotkey combo) | Inline canvas Inspector | 1:1 — inherently specific to the one workflow it triggers | `LOCKED`, built this way (§3.4) — no change; a trigger's config is never meaningfully shared |
| Capture/Process/Apply config (today's `html` field, etc.) | Inline canvas Inspector | 1:1 | `LOCKED`, built this way — genuinely simple fields, a dedicated screen would be overhead, not clarity |
| **Integration / Connector** (HTTP Connector, DB Connector, ...) | **Configure**, under a new Integration category | **1:many** — one configured connector (auth, base URL) referenced by ID from any workflow's Integration node | `LOCKED` end-to-end — `ConfigureView.tsx`'s Integration tab (`ConfigureIntegration.tsx`) is a real page: create/edit/delete a Connector, set its secret (write-only — the field clears after Save, never pre-fills on edit, matching `SetConnectorSecret`'s own no-`GetSecret` design). Reachable via the sidebar's "Configure" entry (`internal/domain/capabilities`' `capability-configure`, replacing the old flat "Connectors" placeholder row) |
| **Input / Attributes** | **Configure** | **1:1** — scoped to the one workflow that declares it, per §3.2's original cardinality note | `LOCKED` end-to-end — `ConfigureView.tsx`'s Attributes tab (`ConfigureAttributes.tsx`) picks a workflow and edits its declared schema (key/label/type rows, `FieldOptions` excluded — see §3.3's rule-builder Update note for why), calling `ConfigureService.UpdateWorkflowAttributes` |
| **Decision** | **Configure** (a rule/decision-table editor needs real room, not a narrow Inspector sidebar) | **1:1** recommended — §3.2 flagged this cardinality as genuinely unconfirmed ("check before assuming either way"); a workflow's decision logic is plausibly workflow-specific business logic, not shared, but this is a real open question, not decided here | `LOCKED` end-to-end — see §3.3's Decision Update note for the full rule-builder writeup (`react-querybuilder` + `ruleTranslate.ts`, one-way translation only, no expression round-trip parser) |
| **List** (a reusable lookup/reference dataset) | **Configure** | **1:many** recommended, same shape as Integration — a shared lookup table is the kind of thing multiple workflows would plausibly reference | `LOCKED` end-to-end — `ConfigureView.tsx`'s Lists tab (`ConfigureLists.tsx`) is a real page: create/edit/delete a List and its key/value entries, calling `ConfigureService`'s `Lists`/`CreateList`/`UpdateList`/`DeleteList` |

**What Configure is *not*: a plugin system for user-defined node kinds.**
Worth being explicit about, since "define a dedicated thing in Configure"
could be misread as "let users invent brand-new node kinds from
scratch." That's not what the reference platform actually does (its own
Configure surface defines *instances* of its own fixed kind taxonomy —
schema/auth for a specific Integration, not a mechanism for inventing a
new kind of node) and it would contradict CLAUDE.md's core-domain rule
directly: "the action/capability model and its composition rules" stays
Mill's own hand-written code, never delegated to a library or a
user-authoring mechanism. Configure is Mill offering a *better authoring
surface* for node kinds Mill itself still defines (Integration, Input,
Decision, List) — not a way to add kinds Mill doesn't know about.

**Credential storage — §4's own still-open question, now built.**
`github.com/zalando/go-keyring` (MIT), checked directly: no cgo on any
platform, and its macOS backend shells out to `/usr/bin/security` — the
exact same shape as Mill's existing `internal/adapters/clipboard`
(`osascript`/`pbcopy`), not a new kind of dependency. This resolves §4's
"1Password-style vault local to Mill vs. delegating to an existing
secrets manager" framing directly: it's neither exactly — it delegates
to the OS's *own* already-present keychain (Keychain on macOS,
Credential Manager on Windows, Secret Service on Linux) rather than
either hand-rolling a vault or depending on a separate app like
1Password being installed. `internal/adapters/credential` wraps it
behind `Set`/`Get`/`Delete(connectorID, secret)`, namespaced under one
keychain "service" name (`mill-connector`) so every connector's secret
groups under one recognizable Keychain entry. Unit-tested via
`keyring.MockInit()` (the library ships its own in-memory mock, unlike
`internal/adapters/clipboard`'s real-desktop-only testability) — a real
round-trip is CI-testable, not just a skip-in-CI placeholder. A real
Connector value never carries its own secret in memory/at rest outside
the keychain — `internal/domain/connector.Connector` has no secret
field at all; `composition.go`'s `integration-http` node resolves the
secret only at the moment of an actual call, via the injected
`ResolvedConnector`. `LOCKED` (library pick + adapter, integrated) —
still `OPEN`: a Configure-surface UI to write a secret (write-only, no
`GetSecret` binding — see the Configure-surface bullet below) doesn't
exist yet.

**Sidebar restructuring — `LOCKED` and built, all four bullets below.**
- **Composition and Configure lead the nav, in that order** —
  `internal/domain/capabilities.List()`'s own array order is the
  sidebar's order (`App.tsx` renders capabilities in-order, no separate
  sort), reordered to put the two real, working destinations first;
  Composition is already the app's default landing `view` (§2.2's Update
  note), Configure is its natural neighbor now that it exists.
- **Activity moved down**, right after Composition/Configure — a
  monitoring surface, not a primary destination, the same "present but
  not top-billed" position n8n's own Executions occupies relative to its
  Workflows/Credentials.
- **The old flat "Connectors" placeholder row is gone, replaced by
  Configure** — same capability ID slot repurposed (`capability-configure`
  now points at `ViewConfigure`, a real page, not `ViewPlaceholder`),
  confirmed against n8n's own left nav (Credentials is a real top-level
  item there, separate from Workflows — the precedent for Configure
  deserving the same top-level billing).
- **Settings is pulled out of the `NavList` entirely**, into a
  bottom-anchored sidebar footer slot (`.sidebarFooter`, a plain
  `IconButton` — confirmed against real precedent before building, not
  assumed: Notion anchors workspace settings at the bottom of its
  sidebar behind the workspace name, Slack gates it behind the profile
  menu, neither treats Settings as a flat item alongside content pages).
  Not a `capability` — no build status or SPEC section of its own, same
  reasoning that already makes the Spec entry fixed rather than
  data-driven. `SettingsView.tsx` now hosts the theme `SegmentedControl`,
  moved out of the app's bottom bar (which previously shared it with the
  version/clock/docs link) — the bottom bar keeps only those.
  Persisting the choice and mirroring it onto `<html>` stays in
  `App.tsx` (global app-shell behavior that must run regardless of
  whether the Settings page is even mounted), read via Primer's own
  shared `useTheme()` context rather than duplicated. Verified
  end-to-end on the real server-mode app: Composition/Configure/Activity
  render in the new order, the gear icon opens Settings, switching to
  dark theme there applies across the whole app (sidebar, content,
  footer) exactly as it did from the old footer location.

`LOCKED` and built: Integration/Connector, List, Attributes, and
Decision authoring (the `ConfigureView.tsx` page + `ConfigureService`),
and the sidebar restructuring this implied. `OPEN`: whether any *other*
node kind belongs in Configure — see the recheck immediately below,
which found none do, today — and the extension-points question in §3.6.

**Connector layout is inspect-vs-edit, one-scroll authoring, its own
pinned tab** — see
[ADR-0014](adr/0014-configure-layout-inspect-vs-edit.md) for the full
design. A saved connector opens read-only (`ConnectorSummary.tsx`:
Details/Available attributes/Input parameters/Testing tabs, plus
Delete/Duplicate/Edit); create/edit (`ConnectorForm.tsx`) is one
continuous guided scroll (General → Auth → Headers → Schema → Test),
no Primer Tabs. Both open as their own pinned tab in
`ConfigureIntegration.tsx`, via the same `EditorTab`/`tabs`/
`activeTab` mechanism Composition already uses (`shared/Tabs.tsx`).
`LOCKED`.

**Recheck against the two-axis test, applied to every current
`NodeType`, not just the ones already promoted to Configure.** Prompted
directly by the question "do we need Configure-level primitives for
things like the markdown converter" — the honest way to answer that is
to check every current node type against the same test that decided
Connector/List/Attributes/Decision, not guess. Verdict: **none of the
other eight need to move.**

| NodeType(s) | Configure-authored for room? | 1:many reusable? | Verdict |
|---|---|---|---|
| `trigger-manual`, `trigger-clipboard-watch` | No — zero config fields | No — 1:1, starts the one workflow it's on | Correctly inline (nothing to author) |
| `trigger-hotkey` | No — the binding itself lives in `TriggerService`, not `Node.Config` at all | No — 1:1 | Correctly inline |
| `trigger-schedule`, `trigger-filesystem-watch` | No — one field (`cron`/`path`), fits a narrow Inspector fine | No — 1:1 | Correctly inline |
| `capture-clipboard-html` | No — zero config, and there is exactly one clipboard backend (`internal/adapters/clipboard`, `osascript`) — no "which provider" decision exists to author | No — 1:1 | Correctly inline |
| `process-html-to-markdown` | No — zero config, and there is exactly one conversion library (`html-to-markdown`) wired in — same "no real choice" reasoning as capture | No — 1:1 | Correctly inline |
| `apply-clipboard-write-text` | No — zero config | No — 1:1 | Correctly inline |
| `apply-clipboard-write-html` | No — one field (`html`), a literal value, not a reusable resource | No — 1:1, the HTML is specific to this one step | Correctly inline |
| `decision-route` | N/A — it has no `ConfigFields` of its own; its conditions live on edges, authored via the rule builder | N/A | Correctly has nothing to promote |
| `integration-http`, `list-lookup` | **Already Configure-authored**, correctly — they reference a Connector/List by ID rather than embedding config | **Already 1:many**, correctly | Already right, no change |

The pattern worth naming: **a node only becomes a Configure candidate
once it has a real "which instance of a reusable *thing*" decision** —
which connector, which list, which MCP server (§3.6). A single-
implementation adapter with no alternative to choose between (today's
clipboard I/O, today's one markdown library) has nothing to configure
regardless of how "primitive" it sounds — promoting it would be config
surface for a decision that doesn't exist, the same premature-
abstraction trap `AuthType`'s OAuth2 gap and `AttributeDef`'s missing
`Options` list both deliberately avoided. The trigger to revisit any one
of these rows is concrete, not speculative: the day a second markdown
strategy or a second clipboard backend actually exists. `LOCKED`
(the recheck and its verdict) — revisit per-row only when a real second
implementation shows up.

**Connector/List/MCP-Server references are a live picker with inline
quick-create, not a paste-an-ID text box** — see
[ADR-0009](adr/0009-configure-entity-picker.md) for the full design.
`connectorId`/`listId`/`mcpServerId` stay `FieldText` on the wire but
carry a `RefKind` (`"connector"`/`"list"`/`"mcpserver"`) the canvas
Inspector reads to render a live `Select` of real Configure-authored
entities, plus an inline "+ Create new…" `Dialog` (a minimal subset
of each `ConfigureXxx.tsx` page's own create form — Configure itself
stays canonical for the fuller edit afterward). One generic
`EntityRefField.tsx` component, keyed by `RefKind`. `LOCKED`, built.

### 3.6 Extension points — adding a new primitive capability without a core code change

Two genuinely different problems live under this heading, kept separate
per the same discipline that already avoided conflating DBOS and pueue
into one research question (§1.2): **(1)** Mill's own hand-written node
types getting harder to add cleanly — a Mill code change still happens
per capability, self-registration only makes it *isolated* rather than
*eliminated* — and **(2)** whether a whole class of future Integration-
shaped capabilities could require *no* Mill code change at all, via the
MCP layer §3.1 already adopted as "the capability-exposure layer" (which
only worked out Mill as MCP *server*, leaving Mill as MCP *host* in real
tension with §1.1's "not an LLM client" rule — a third role, *client*,
turns out to solve this without touching that dispute).

- **Mill as MCP client — `LOCKED`, built.** The extension point for
  problem 2, and it doesn't reopen §3.1's disputed host/server tension:
  a workflow author picks one specific tool at Configure time, the same
  way an Integration node references one specific Connector — Mill is a
  protocol client making one deterministic call per step, structurally
  identical to `integration-http` being an HTTP client, never an agent
  deciding what to call, so §1.1's "not an LLM client" rule is
  untouched. `internal/adapters/mcpclient` wraps
  `modelcontextprotocol/go-sdk`'s client role (`mcp.NewClient` +
  `&mcp.CommandTransport`) behind Mill's own `Tool`/`ListTools`/
  `CallTool` names. An **MCP Server** Configure entity
  (`internal/domain/mcpserver.MCPServer{ID, Label, Command, Args}` — no
  `AuthType`, stdio is local-process trust) is 1:many reusable, CRUD'd
  through `ConfigureService`/`ConfigureMCPServers.tsx` (a fourth
  Configure tab). A new `mcp-tool-call` `NodeType` (`KindProcess`)
  resolves `mcpServerId` via a `composition.SetMCPServerLookup` seam
  (mirrors `SetConnectorLookup`) and calls `toolName` with a raw
  `argumentsJSON` object — same no-templating simplicity
  `integration-http`'s `bodyTemplate` has. Discoverability: each MCP
  Server card in Configure has a **"List tools"** button
  (`ConfigureService.ListMCPServerTools`) that connects, lists every
  tool with its real `InputSchema`, and renders it inline; `toolName`
  stays plain text (no closed set to pick from without calling the
  server), `mcpServerId` itself is a live picker
  ([ADR-0009](adr/0009-configure-entity-picker.md)). Core
  `listTools`/`callTool` functions are unit-tested via
  `mcp.NewInMemoryTransports()` fixtures, and verified against a real
  spawned subprocess too: pointed an MCP Server entity at `npx -y
  @modelcontextprotocol/server-everything` (an official MCP reference
  server), listed its six real tools, and ran a workflow's
  `mcp-tool-call` node against its `echo` tool
  (`{"message": "hello from mill"}` → `"Echo: hello from mill"`)
  through the full production path (`ConfigureService` →
  `composition.SetMCPServerLookup` → `nodeExec["mcp-tool-call"]` →
  `mcpclient.CallTool` → `CommandTransport` → subprocess → real MCP
  protocol). This isn't a mechanism for *end users* to invent new Mill
  node *kinds* (§3.5's "What Configure is *not*" bullet still holds) —
  `mcp-tool-call` is one more Mill-defined `NodeType`; what varies per
  configured server is which *tools* are callable through it, the same
  way what varies per Connector is which *API* `integration-http`
  calls.
- **Whether Mill needs its own MCP-server-authoring SDK — researched,
  declined.** Checked the other side of the relationship: someone
  writing a new MCP server to extend Mill. The ecosystem already has a
  WXT-shaped low-boilerplate layer per language (`mark3labs/mcp-go` for
  Go, FastMCP for Python and TypeScript) — building a Mill-owned SDK on
  top of an already-solved problem would be the inner-platform trap §0
  exists to name. `LOCKED` (don't build) — pointing to these from a
  future "how to extend Mill" doc (a natural fit for §9.2's
  `connector-scaffolder` candidate) stays real, small, `OPEN` future
  work.
- **Node type / Trigger type self-registration — `LOCKED`,
  [ADR-0006](adr/0006-extension-point-registration.md) `accepted`,
  built.** Problem 1's fix: Go's `database/sql` driver idiom
  (`Register`+`init()`+blank import — the same shape `image.
  RegisterFormat` uses) replaces the old central `nodetypes.go`'s
  `NodeTypes()` slice / `execute.go`'s `nodeExec` map edit every new
  `NodeType` needed (three additions in one session — `decision-route`,
  `integration-http`, `list-lookup` — all needed both files) and the
  equivalent switch in `triggerservice.go`'s `start()`. Composition
  `NodeType`s self-register cleanly. Trigger registration needed a real
  correction ADR-0006 documents in full: trigger *schemas* live in
  `internal/domain/composition/triggers.go` (one file, all five) since
  `composition`'s own `BuiltInWorkflows()` fixture needs
  `"trigger-manual"` registered when tested standalone, while trigger
  *dispatch* stays in `package main`'s five per-type files
  (`TriggerService.start()`'s cases close over real `*TriggerService`
  state) — two files per trigger type, not one, the correct dependency
  direction even though less cohesive than originally planned.
  ADR-0006 deliberately scoped self-registration to NodeType + Trigger
  type only, not every extension point — the full audit below is why
  the rest didn't get the same treatment.

  | Extension point | Central-file cost (before self-registration) | Status |
  |---|---|---|
  | Composition `NodeType` | `nodetypes.go` + `execute.go` | `LOCKED`, self-registers (ADR-0006) |
  | Trigger type | Same 2, plus `triggerservice.go`'s `start()` switch | `LOCKED`, self-registers (ADR-0006) — schema/dispatch split across two files, see above |
  | Connector `AuthType` | `connector.go` + `composition/integration.go` (2 files) | Stays a plain switch — accepted as a small, bounded, infrequently-paid cost, same "no UI for a decision that doesn't exist yet" discipline as §3.5's Configure recheck |
  | Configure entity *kind* | `ConfigureService` struct + constructor (~3-4 lines) | Stays a plain struct field, same reasoning |
  | Capabilities index entry | `capabilities.go`'s `List()` (1 line) | Already cheap, no change needed |
  | MCP-tool-shaped capability | Zero Go changes | Already zero-cost — Mill as MCP client, above |

- **Registry duplicate-key behavior is inconsistent across the three
  registries this pattern produced, undocumented until found —
  `OPEN`.** `RegisterNodeType`/`RegisterTrigger` panic on a duplicate ID
  (deliberate fail-fast, per their own doc comments); `RegisterAuthStrategy`
  (ADR-0015) is a bare map assignment with no duplicate check — it
  silently overwrites. Neither was a decision, just what each
  registry's underlying data structure happened to do; none of the
  three support *intentional* substitution either way. Documented
  directly on all three functions (`registry.go`, `triggerregistry.go`,
  `integration.go`) so it isn't rediscovered by surprise. Worth a real
  decision (pick one semantics, or add explicit substitution support)
  the day a real use case needs it, not before — no dedicated ADR
  needed unless that day comes.
- **Mill as MCP server — `LOCKED`, built.** Closes the third MCP role
  named in §3.1 (server/client/host) but left unbuilt until now — no
  agent loop runs inside Mill, an external agent's own host connects
  and reads, structurally identical to `httpconnector` being an HTTP
  client for outbound calls. `MillMCPService` (`millmcpservice.go`, via
  `internal/adapters/mcpserving`, wrapping `modelcontextprotocol/
  go-sdk`'s server role + its `StreamableHTTPHandler` transport)
  exposes Mill's workflows and Configure-authored entities
  (HTTPRequests, Lists, MCP Servers) as read-only MCP **Resources**.
  Each entity type gets an index URI (`mill://workflows`,
  `mill://requests`, `mill://lists`, `mill://mcpservers`) and a
  `ResourceTemplate` (`mill://workflows/{id}`, etc.) reusing the
  existing `Export*` methods (`ExportWorkflow`/`ExportHTTPRequest`/
  `ExportList`/`ExportMCPServer`) as the read-model — secrets stay
  excluded by the same construction those methods already guarantee
  (§4's write-only design,
  [ADR-0007](adr/0007-connector-schema-and-secret-guardrail.md)),
  independently re-verified through this path too (a real client sets
  a secret on a real HTTPRequest, reads it back via
  `mill://requests/{id}`, confirms it's absent from the wire response).
  Binds `127.0.0.1:8090` by default (`MILL_MCP_ADDR` overrides),
  loopback-only — a new, unauthenticated local listener, conservative
  until a real access-control need is named. Runs in both desktop and
  server-mode builds (no build tag); a bind failure is logged, not
  fatal.
  **The write side is now built, behind ADR-0017 Option B's coarse
  gate — prompted by an explicit user request for MCP-side management
  of Mill's data.** Eight MCP Tools (`millmcpservice_tools.go`) over
  the same export/import model the UI's own buttons use:
  `export_workflow`/`export_request`/`export_list`/`export_mcpserver`
  (read-only, ungated — the Resources' data reshaped as callable
  tools) and `import_*` equivalents (always mint a new ID, never
  overwrite, never touch a secret), the latter all gated by a
  **default-off Settings toggle** ("Allow MCP clients to import data",
  read fresh per call so it applies immediately). Proven against a
  real MCP client over real HTTP: import is rejected with a
  clear go-enable-it-in-Settings error while off, writes nothing, and
  succeeds minting a new ID once a human flips the toggle.
  [ADR-0017](adr/0017-mcp-write-tools-guardrail-scope.md) `accepted`
  for this scope; its per-write synchronous-approval half (and the two
  host-behavior sub-questions) stays open, deliberately — the toggle
  is per-instance opt-in, not a resolution of §8.

### 3.7 Global app settings

`SettingsService` (`settingsservice.go`) owns Mill's global settings
surface — distinct from both Configure (§3.5, node-*kind* authoring)
and a Trigger's own per-workflow config (§3.4, e.g. one workflow's
hotkey binding): settings that apply to Mill itself, independent of
any specific workflow. Alongside the pre-existing theme
`SegmentedControl` and sidebar-collapse preference (both cosmetic,
`localStorage`-persisted, unchanged by this section), it now owns six
built mechanisms plus one researched-and-declined storage question.
Full research (a Raycast/Alfred/1Password Quick Access/Rectangle/
Homerow/PowerToys/ulauncher survey, and the per-mechanism Wails3 API
findings) and the build rationale are in
[`docs/adr/0020-global-app-settings.md`](adr/0020-global-app-settings.md).

**Built, `LOCKED`:**

- **Launch at login** — `internal/adapters/launchatlogin`, split
  `!server`/`server` like `internal/adapters/hotkey` (no login-item
  concept in server mode). Ports Wails v2's own `osascript`/System
  Events approach — Wails v3 itself has no first-party mechanism.
  `GetLaunchAtLogin` queries live OS state rather than a cached
  preference, so it can't drift from a manual removal via System
  Settings. A bare dev binary (not a real `.app` bundle) returns a
  named `ErrNotAppBundle`, surfaced in `SettingsView.tsx` as a plain
  note rather than a raw error.
- **Global summon hotkey** — `golang.design/x/hotkey` (already adopted,
  §2.2) for registration, `*application.WebviewWindow`'s
  `Show()`/`Restore()`/`Focus()` for the callback. Persisted via the
  same `internal/adapters/settings` store `TriggerService` uses.
  Bidirectional conflict detection with per-workflow hotkeys:
  `TriggerService.ClaimedCombos()`/`SetReservedCombo` (an
  injected-function seam, same shape as
  `SetConnectorLookup`/`SetListLookup`) so a workflow hotkey can't
  collide with the summon hotkey or vice versa.
- **Auto-update** — `app.Updater` (Wails3's own first-party,
  zero-new-dependency `v3/pkg/updater`) is `Init`'d in `main.go` with a
  GitHub Releases provider pointed at `alicoding/mill`;
  `SettingsService.CheckForUpdates()` exposes a manual check via
  `SettingsView.tsx`'s "Check for updates" button. **Inert today**: no
  tagged release exists yet (`millVersion` in `main.go` is a
  placeholder `"0.1.0"`, zero GitHub releases published) and no
  `PublicKey` is configured — a release carrying only a content digest
  still installs, one carrying a signature would be rejected once a
  key exists. Tied to ADR-0002's release pipeline (§1.3), real future
  work.
- **Tray icon** — a persistent menu-bar icon via Wails3's own
  `SystemTray` API (`app.SystemTray.New()`, zero new dependency),
  coexisting with the dock icon rather than replacing it
  (`ApplicationShouldTerminateAfterLastWindowClosed` stays `true`).
  Click calls `SettingsService.ShowWindow()` (shared with the summon
  hotkey's own show/restore/focus sequence); right-click offers "Show
  Mill"/"Quit". Uses `build/appicon.png` via `SetIcon`, not
  `SetTemplateIcon` — macOS's monochrome-template-icon convention needs
  a dedicated alpha-only asset Mill doesn't have yet, a named minor
  polish gap. Not independently verified on a real rendered macOS menu
  bar (no screen access in the session that built it).
- **Per-view hotkeys** — Cmd+1 through Cmd+4 jump to a top-level view
  (Composition/Configure/Activity/Spec, matching the sidebar order,
  down from an original five once Runs stopped being a top-level view —
  §7's Update), via a plain `keydown` listener in `App.tsx` calling
  `useAppStore`'s existing `setView`. Deliberately **not** a real
  OS-level hotkey — in-window-only, so it doesn't need
  `TriggerService`'s claimed-combo conflict check the summon hotkey
  goes through. Active regardless of focus (Cmd+digit isn't a combo
  real typing produces, matching browsers'/Slack's own Cmd+1-9
  precedent).
- **Window/tab/filter state persistence** — window position/size/
  maximized state is Go-side (`settingsservice.go`'s
  `LoadWindowGeometry`/`WatchWindowGeometry`, persisted via
  `internal/adapters/settings`, since only the backend has
  `Position()`/`Size()`); active view, open Composition/Configure tabs,
  and Activity's own filters are `localStorage` via zustand's own
  `persist` middleware plus a shared `shared/persistedTabs.ts` helper.
  `WebviewWindowOptions` needs `InitialPosition: WindowXY` set
  explicitly or persisted `X`/`Y` are silently ignored (its zero value
  is `WindowCentered`). Move/resize/maximize events are debounced
  (500ms). An off-screen guard rejects a persisted position outside
  plausible display bounds (a stale save from a since-disconnected
  monitor) — Wails3, like Wails v2, has no monitor-identity API
  (`wailsapp/wails#2739`), a known, accepted limitation, not a full
  multi-monitor fix. **Fullscreen state is deliberately not tracked** —
  reapplying persisted X/Y/Width/Height to a window last in fullscreen
  would be meaningless, and macOS fullscreen's own multi-monitor
  semantics are unresolved; a named future gap. Restored tabs skip
  anything pointing at a since-deleted entity; Configure only restores
  `'view'` tabs, never `'edit'` (an in-progress, unsaved edit form
  shouldn't look "still open").

**Researched, not built:**

- **Settings/storage multi-tenancy seam** — `internal/adapters/settings`
  stays one flat, unscoped JSON store; no `Scope`/tenant concept added.
  Single-user-forever is the honest current assumption — researched and
  declined (four independent angles: hexagonal-architecture literature,
  local-first-software research, real precedent from apps that added
  team tiers later, YAGNI), not silently unaddressed. Full reasoning in
  ADR-0020. The existing `Store` interface boundary is the seam a
  future scoping change would go through, if one is ever needed.
- **Wails3's own MCP verification server** (`-tags mcp`) was spiked as
  a desktop-only agent-driven testing tool against this work — confirms
  window/tray state is agent-drivable (`window_control`/`dom_query`/
  `call_bound_method`) but not hotkey-delivery specifically
  (`keyboard_press` only dispatches a DOM-scoped `KeyboardEvent`,
  confirmed empirically against a real bound hotkey). Full verdict in
  `.claude/skills/run-mill/SKILL.md`, not duplicated here — a one-off
  spike, not adopted into the standing workflow.
- **Isolated-data indicator** — `SettingsService.IsIsolatedData()`
  reports whether this instance is reading/writing a non-default
  settings/execution-db path (`MILL_SETTINGS_PATH` set — every e2e run
  already does this). `App.tsx` shows a "TEST DATA" badge when true, so
  it's never ambiguous whether you're looking at real desktop-app data
  or an isolated instance — prompted directly by a real need: a
  server-mode instance kept running in the background (a LaunchAgent,
  reachable over Tailscale from another device — see `run-mill`'s own
  skill doc for the full setup) must not share the real
  settings.json/execution.db with the desktop app, since two live
  processes writing the same files risks corruption, and both
  independently running the same schedule/clipboard-watch/filesystem-
  watch triggers risks a scheduled workflow double-firing.
- **Build-identity footer** — `SettingsService.GetBuildInfo()`
  (`settingsservice_buildinfo.go`) reads Go's own `runtime/debug.ReadBuildInfo()`
  (`vcs.revision`/`vcs.modified`, embedded automatically by `go build`
  in a git checkout, `-buildvcs=true` by default) and the footer shows
  the short commit hash plus a `*` if the tree was dirty at build time
  — unconditional on any build tag, unlike Wails3's own identical
  `BuildInfo`/`BuildSettings` (`application_debug.go`), which is gated
  `!production` and never exposed to the frontend regardless. Real gap
  this closes, caught directly: a desktop app process stayed running
  across an entire session's worth of commits with nothing anywhere
  flagging it stale — the existing `isDevBuild` ribbon only fires for a
  live `vite serve` dev server, never for any `go build` output
  (desktop or server mode, dev or not), so it couldn't have caught this
  either.

**Still `OPEN`, real named gaps:** a menu-bar/dock presence toggle and
trigger-fire notifications (Wails3 ships first-party `dock`/
`notifications` services for both, zero new dependency, but neither has
a settled concrete design yet — what a dock toggle would control given
Mill has no menu-bar-only mode, and what event a notification should
fire on); appearance settings beyond light/dark; a default working
directory/scope (blocked on §6); fullscreen window-state tracking
(named above).

## 4. Connectors

- **`HTTPRequest` — the generic HTTP connector — `LOCKED` and built.**
  `internal/domain/httprequest.HTTPRequest{ID, Label, BaseURL, AuthType,
  Headers, OpenAPISpec, Description, BuiltIn, JOSE}` (renamed from
  `Connector` by [ADR-0016](adr/0016-http-request-entity-and-open-method.md)
  Phase A — `Type`/`TypeHTTP` dropped entirely, redundant once the entity
  name itself says HTTP) + `internal/adapters/httpconnector` (stdlib
  `net/http` via `hashicorp/go-retryablehttp`, 30s timeout, no auth/
  credential knowledge of its own) + `internal/adapters/credential`
  (`zalando/go-keyring`-backed, write-only — no `GetSecret` binding exists
  anywhere). `AuthType` is a 9-value, registered-`AuthStrategy` catalogue
  (`none`/`apikey`/`bearer`/`hmac`/`oauth1`/`oauth1vendor`/`oauth2`/
  `queryparam`/`mtls`) — see §4.1's table for which are fully implemented
  vs. real registered stubs.
- **Retries + fail-safe status handling — `LOCKED`, no dedicated ADR.**
  Every call runs through `go-retryablehttp`
  (`RetryMax=3`/`RetryWaitMin=1s`/`RetryWaitMax=10s`, retries 429/5xx
  except 501 plus transport errors); a retried status that never recovers
  surfaces as a Go error with no `Response`, same as a transport failure.
  `integration-http` rejects any `StatusCode >= 400` as a node failure
  instead of flowing an error body through as workflow output — matches
  n8n's own HTTP Request node default and Mill's fail-safe guardrail
  philosophy (§8). `Response` carries a `Headers` map (not yet surfaced in
  any UI — groundwork for future execution-visibility work, §3.2/§7). A
  circuit breaker and persisted per-run response visibility (the latter
  sequenced with the DBOS integration, §7) remain unbuilt, named future
  work, not silently dropped.
- **Input/output schema — `LOCKED`, [ADR-0007](adr/0007-connector-schema-and-secret-guardrail.md), fully built (Phases 1–3).**
  `HTTPRequest.OpenAPISpec` (optional; absent behaves exactly as before it
  existed) is parsed via `internal/adapters/openapispec` (wraps
  `getkin/kin-openapi`): `Parse`/`Operations()`/`Operation(path, method)`
  return input fields (from `Parameters`+`RequestBody`) and output fields
  (from the first 2xx JSON response), each with an `IsSecret` flag.
  "List operations" (`ConfigureService.ListRequestOperations`) surfaces
  every declared operation in Configure. Once a workflow node's
  `path`/`method` match a declared operation, the canvas Inspector renders
  `IntegrationBindingsEditor.tsx` — input fields bind to a literal or an
  `attr:<name>`, output fields write into a named Attribute or are
  discarded (`internal/domain/composition/attributebinding.go` resolves
  each per its declared `In` placement). `ValidateGraph` rejects a save
  that maps an `IsSecret` output field into an Attribute — Mill's own
  secret guardrail, enforced at save time, not just documented policy.
- **Sectioned Configure form + Manual/CSV schema authoring — `LOCKED`,
  [ADR-0011](adr/0011-connector-schema-authoring-modes.md).**
  `RequestForm.tsx`'s create/edit form is sectioned into
  General/Auth/Headers/Schema (Postman/n8n precedent). The Schema tab
  offers Paste-OpenAPI or a Manual editor (`ManualSchemaEditor.tsx`,
  operations with input/output field tables — inputs further split into
  "Parameters" (path/query/header) vs. "Request body," so protocol- and
  payload-level fields aren't presented as one kind of thing); both modes
  converge on the same `OpenAPISpec` string
  (`frontend/src/openapiSynth.ts`). CSV import (PapaParse) bulk-fills the
  same table as an accelerator, not a fourth mode. `openapispec.Field`
  carries `Alias`/`Path` (nested-response-JSON extraction, via
  `x-mill-alias`/`x-mill-path`), `Default`/`Description`, an `EnumValues`
  list, and 9 types (adds `map`/`date`/`datetime`);
  `Operation.ResponseExtractPath` (`x-mill-response-extract-path`) does a
  document-level extraction before per-field paths apply. The Configure
  page also has a per-operation "Show schema" action and a Headers
  key/value row editor (both were real, user-caught gaps — `Headers` used
  to silently save as `nil`). A "primary key" concept for a schema field
  is named but deliberately deferred — no concrete consumer identified
  yet (see §10).
- **Connector draft testing + Duplicate — `LOCKED`,
  [ADR-0013](adr/0013-connector-draft-testing.md).** `RequestForm.tsx`'s
  Test tab (`RequestTestPanel.tsx`) picks a declared operation, generates
  example input values (`zod`+`zod-schema-faker`), and runs a real HTTP
  call server-side via `ConfigureService.TestConnectorOperation` (avoids
  CORS, resolves the keychain secret) — a request-scoped `Secret` is used
  once and falls back to the stored keychain secret only when blank and
  editing an existing request; testing never calls `credential.Set`, so a
  tested-then-abandoned draft leaves no keychain trace. The
  request/response log is session-local (capped at 20 entries, not
  persisted). Duplicate pre-fills a new create form from an existing
  request's fields; the secret is never copied (it was never readable
  back through Mill in the first place).
- **Seeded example `HTTPRequest`s — `LOCKED`, no dedicated ADR.**
  `httprequest.BuiltIn()` returns seven examples, one per real
  implemented `AuthType` (`none`/`apikey`/`bearer`/`hmac`/`oauth1`/
  `oauth2`/`queryparam` — `oauth1vendor`/`mtls` excluded, both are stub
  strategies that always fail). Each targets a real, independently
  `curl`-verified-live public service (`httpbin.org`, `postman-echo.com`)
  — Mill's real OAuth 1.0a signing was independently confirmed against
  `postman-echo.com/oauth1`. The OAuth2 example is deliberately
  incomplete (a real token URL, no Client ID/Secret — Mill's repo will
  never carry a real client secret; the user brings their own app).
  Seeded lazily on first fresh install only (same pattern
  `CompositionService.restore()` already uses for built-in workflows) —
  editable, deletable, and cloneable via Duplicate like any other entity.
  **Two seeds carry a real typed schema, verified live** — prompted
  directly ("I want to see ... an actual typed request and response in
  action in the Test feature"): the No-auth example declares a typed
  query parameter (`q`) plus typed response fields (`url`, `origin`,
  and `echoedQ` extracted from the nested `args.q` via `x-mill-path` —
  ADR-0011's nested extraction demonstrated on real data), and the
  Bearer example types `authenticated: boolean`/`token: string` to
  match httpbin's real validated response 1:1. Confirmed end-to-end
  against the live service, not assumed: Generate-sample-payload filled
  `q`, a real GET returned 200, and the response echoed the exact value
  back. Seeding is now **top-up** (below), so new examples reach existing
  instances too; an already-present example is never overwritten (it
  may carry user edits), and a deliberately deleted one stays deleted
  via a tombstone. `LOCKED`.
- The operation picker (Testing/Available-attributes/Input-parameters)
  auto-selects instead of showing a dropdown when a request declares
  exactly one operation — `LOCKED`, no dedicated ADR.
- **Configure's Integration tab presents one "New integration" entry
  point with a typed menu, not a bare "New request" button — `LOCKED`,
  by direct user decision, no dedicated ADR.** The integration *kind*
  is the first authoring decision (§4.1's connector-kind row: Generic
  REST API today, DB/other kinds later), so the create action is an
  `ActionMenu` whose items are the available kinds — future kinds land
  as menu items, not new pages. Deliberately a single-item menu today:
  unlike §3.5's single-option-`Select`-is-noise cases, the menu itself
  is the extension point the reference platform's own "Integration
  type" list (§3.2) anticipates. The pinned list tab/heading say
  "Integrations" (the umbrella noun); the underlying entity stays
  `HTTPRequest` (ADR-0016's rename is code-level, unaffected).
- **Method + URL are peers on the request form, the schema is
  payload-only, and one request = one operation — `LOCKED`, ADR-0016
  Phase B's entity half, decided directly with the user.**
  `HTTPRequest.Method` (open text with datalist suggestions including
  `QUERY`; empty means GET, covering every request saved before the
  field existed) now lives on the entity, the export/import wire shape,
  the seeded examples, and the read-only Details summary.
  `integration-http`'s own `method` config becomes an optional
  per-step override — blank inherits the request's method (existing
  persisted nodes carrying the old explicit `"GET"` default behave
  identically; regression-tested through the real execution path). The
  Schema section never shows a Method control for a single-operation
  request: its operation's method *is* the request's (clamped to
  OpenAPI's eight expressible methods at synthesis time only —
  execution always sends the real method). "Add operation" is gone
  from authoring entirely: a request is 1:1 with its operation
  ("people clone to create another" — Duplicate covers the multi-call
  case); a previously-stored multi-operation spec still renders fully
  (nothing silently dropped) and can be pared down, never grown.
- **One schema-intake block replaces the Paste-OpenAPI/Manual mode
  switch, the embedded CSV block, and the per-section Paste-sample
  toggles — `LOCKED`.** All three previous accelerators confused the
  live authoring flow (reported directly from real use). `SchemaIntake.tsx`
  accepts pasted text or a dropped `.json`/`.csv` file (drop-zone via
  `react-dropzone`, MIT, pure-JS deps — adopted rather than
  hand-rolling HTML5 drag events), detects the content by shape — an
  `openapi`/`swagger` key means a spec; any other JSON is a sample
  payload inferred via the existing genson-js path, with a
  request-body/response target select; anything else is tried as
  CSV — and lands the result in the always-visible manual editor for
  review. The raw OpenAPI document stays reachable behind a "View raw
  OpenAPI" disclosure; a schema the user never touched saves
  byte-verbatim, so ADR-0011's deliberately-bounded parse can never
  silently rewrite a stored vendor spec on an unrelated edit.
- **Amendments from continued live review, all by direct user
  decision — `LOCKED`:** (1) **Method renders as a real `Select`, not
  free text** ("METHOD should not be free form text; same for all
  fields that is typed") — applies to the request form's Method and to
  any `ConfigField` with `Suggestions` in the canvas Inspector; the
  wire stays an open string (a persisted custom verb renders as an
  extra option rather than breaking), only the authoring UI is typed —
  amends ADR-0016's input+datalist presentation, not its open-wire
  decision. (2) **The schema editor's sections are framed as Input —
  request schema (parameters + body) and Output — response schema**,
  the user's own framing of what a schema declares. (3) **Each schema
  field is one compact line** (name + type inline, badges for whatever
  else is set) **with everything else edited in a popup `Dialog`** —
  the previous two-line rows of eight inline inputs rendered visibly
  broken. (4) **Every list/table row has a direct Edit action** — no
  forced detour through the read-only summary first.
- **The `integration-http` node no longer authors transport or body —
  `LOCKED`, by direct user decision ("form fields that should not be
  done at the workflow level").** The node's only config is *which*
  integration to call (the ADR-0009 picker) plus data bindings; method
  comes from the request's own Method, the endpoint path from its
  single declared operation (the 1:1 model makes that the normal
  case), and the body from a new request-level `Body` field (raw,
  sent-as-is fallback under schema-bound body fields — ADR-0016 Phase
  B's body half in minimal form; the typed body-type picker stays
  named future work). Legacy nodes persisted with their own
  `path`/`method`/`bodyTemplate` config keep working — those keys
  still win when present, they're just no longer authorable
  (regression-tested through the real execution path:
  `TestExecuteWorkflow_IntegrationHTTP_TransportComesFromTheRequest`
  plus the existing method-precedence cases). The bindings editor
  resolves the integration's operation itself now (first in stable
  order for a legacy multi-operation spec), with no node-level
  path/method to match against.
- **`Connector` → `HTTPRequest` rename + open Method field — `LOCKED`,
  [ADR-0016](adr/0016-http-request-entity-and-open-method.md), Phases A–C
  fully built.** Researched against Postman/Bruno/RFC 10008 before
  changing anything: Method is never a closed enum, and Params/Body/Auth
  are peers on one request object. "Connector" is retired for the HTTP
  case and reserved as this section's own umbrella term for future
  connector kinds (§4.1); today's entity is `HTTPRequest`, matching
  Postman/Bruno's own top-level noun. Phase A: package/RPC/frontend-file
  rename throughout (`internal/domain/httprequest`; every
  `ConfigureService` RPC; `SetConnectorLookup`/`ResolvedConnector` →
  `SetHTTPRequestLookup`/`ResolvedHTTPRequest`; `connectorId` config key →
  `requestId`; `RefKind: "connector"` → `"request"`;
  `RequestForm.tsx`/`RequestSummary.tsx`/`RequestTestPanel.tsx`/
  `ConfigureRequests.tsx`/`requestHeaders.ts`), with a real forward
  migration of persisted data (`configure-connectors` →
  `configure-requests`, not a silent drop — real data existed on a real
  machine). The OS keychain namespace (`mill-connector`) is deliberately
  left unchanged (internal, never user-visible). Phases B (method half)
  + C: `ConfigField` gained `Suggestions []string` (non-restrictive
  hints); `integration-http`'s `method` is now `FieldText` offering
  `GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS/QUERY` as datalist hints, not a
  closed `Select`. RFC 10008 `QUERY` (safe + idempotent like `GET`, but
  carries a body like `POST`) is proven end-to-end through real tests and
  a real e2e round trip, not assumed — no execution-code change was
  needed, since `net/http`/`retryablehttp` don't special-case method when
  attaching a body. The separate Manual Schema Editor's own Method field
  (used when declaring an OpenAPI-backed operation) stays a closed,
  8-method enum with no `QUERY` — OpenAPI 3.x's `PathItem` has no field
  for it — distinct from `integration-http`'s own unconstrained field.
  **Still `OPEN`, tracked in the ADR**: a Params tab (query/path
  key-value rows, replacing the raw `path` string) and a Body-type
  picker (raw+format/form-data/x-www-form-urlencoded/binary/GraphQL,
  replacing the literal `bodyTemplate` string) as the default authoring
  UI — Phase B's own bigger, separate design surface.
- Jira/Confluence as a first-class example: still `OPEN`, unbuilt — the
  generic request type is real, but no named-vendor preset exists yet.
- Whether connectors are built-in or a plugin surface: still `OPEN`.
- **Backend CRUD + Configure UI — `LOCKED` and built, end-to-end.**
  `ConfigureService` (`configureservice.go`) is the Wails-bound service —
  list/create/update/delete plus write-only secret set/delete RPCs — with
  `composition.SetHTTPRequestLookup`/`SetListLookup` wired to its own
  resolver methods, so a real `integration-http` or List node resolves
  against Configure-authored data end-to-end. `ConfigureView.tsx`
  (sidebar-reachable) makes this reachable without calling bound methods
  directly.

### 4.1 Connector capability map — from the reference-platform review (§3.2)

Same discipline as §3.3's own capability map, applied to the new surface
area §3.2's Update (and its own follow-up Update, from a fuller
consolidated review) captured: list every observed capability before
building any of it, so the next connector-maturity pass has a real map
to work from instead of picking items ad hoc. None of these are
scheduled — this is Research, not a build plan; `OPEN` throughout.

**Terminology note (ADR-0016):** this table and its surrounding prose
predate the `Connector` → `HTTPRequest` rename and are left as written
— "connector"/"Connector" below refers to today's `HTTPRequest` entity,
not the (still-`OPEN`) future umbrella concept the name was freed up
for. Same "historical narrative stays as written, new content follows
new terminology" practice §9.1 already established.

| Capability | Mill today | Adopt or build | Status |
|---|---|---|---|
| Connection mode (real-time / send-and-wait / receive-only) | Real-time only (`integration-http`), immutable-by-nature since nothing else exists | Graph/execution semantics: build. Send-and-wait's async-resume shape: adopt, likely DBOS's own signal/await primitives (already adopted, §7) rather than a hand-built correlation ID | `OPEN` — receive-only is the same thing as §3.4's already-`OPEN` webhook trigger row, not a second decision. Exact webhook/polling field config and the correlation contract are still genuinely unresolved even after the fuller review — real research needed before design, not guessed at |
| Connector kind (DB/Python-function types) | `TypeHTTP` only | Wire protocol per kind: adopt (a DB driver per kind, e.g. `lib/pq`/`pgx` for Postgres). Kind dispatch/config: build, same shape `AuthType`'s switch already has | `OPEN`, real precedent now exists (§3.2) for what the next `Type` values should be |
| Auth type catalogue (HMAC, OAuth 1.0a/RFC 5849, OAuth 2.0 client_credentials, query-param placement, extensibility seam) | 9-value `AuthType` (`none`/`apikey`/`bearer`/`hmac`/`oauth1`/`oauth1vendor`/`oauth2`/`queryparam`/`mtls`), dispatched via a registered `AuthStrategy` per type (`internal/domain/composition/auth*.go`), not a switch | Built — HMAC-SHA256 (Mill's own stated default, no universal convention exists), RFC 5849 HMAC-SHA1 OAuth1, `golang.org/x/oauth2/clientcredentials` (via a new `internal/adapters/oauth2client` adapter) for OAuth2, query-param placement | `LOCKED` (Phase 2, ADR-0015) — 5 of 7 fully implemented; the vendor-specific OAuth 1.0a variant's exact quirk was never confirmed even after the fuller review, so `oauth1vendor` is a real, registered `AuthType` whose strategy returns a clear "not yet implemented" error rather than a guess |
| mTLS (client cert auth) | A real, registered `AuthType`/stub strategy (`authmtls.go`) proving the registry accepts it as a pure addition — no cert-handling logic | Deliberately out of scope for implementation (decided directly with the user, Phase 2's plan) — when built: adopt `crypto/tls.Config.Certificates` (stdlib) + `software.sslmate.com/src/go-pkcs12` (P12 decode). Field set now fully known: cert upload, keystore password, optional alias (defaults to first key entry), optional CA bundle (defaults to system trust store), a disable-validation toggle | `LOCKED` (the extensibility proof) / `OPEN` (the real implementation) — if built, the disable-validation toggle must be gated behind an explicit governed exception, never a plain checkbox, per the fuller review's own flagged warning matching Mill's §8 fail-safe posture |
| JOSE/JWE (request/response encryption) | `Connector.JOSE *JOSEConfig` (Enabled/Algorithm/ContentEncryption/RecipientPublicKeyPEM/DecryptResponse), independent of AuthType, wired into `integration-http`'s request/response pipeline | Adopted — `github.com/go-jose/go-jose/v4` (`internal/domain/composition/jose.go`: `ApplyJOSEEncryption`/`DecryptJOSEResponse`) | `LOCKED` (Phase 3, ADR-0015) — RSA-OAEP-256 + A256GCM is Mill's stated default (both confirmed real, supported go-jose/v4 algorithm identifiers); Mill's own private key (needed only for `DecryptResponse`) lives in a second, JOSE-specific OS-keychain entry distinct from the connector's AuthType secret |
| XML request/response, including a SOAP request-template layer (substitution/conditionals/iteration) | JSON only | Structural XML↔JSON: adopt — `github.com/clbanning/mxj` (map/JSON-shaped, dynamic — fits Mill's runtime-configured connectors better than stdlib `encoding/xml`'s struct-based model). Template engine: Go stdlib `text/template` is the first candidate to check (native conditionals/range) — the real expression grammar needed is still unresolved, don't assume `text/template` is sufficient without checking against it | `OPEN` |
| Schema-from-example ("Paste sample") | `genson-js`, a fourth `ManualSchemaEditor` accelerator alongside Paste-OpenAPI/Manual/CSV, body fields only | Adopted — `genson-js` (npm) | `LOCKED`, built (Phase 1, ADR-0011's Update) |
| Field `Default` / `Description` | On `openapispec.Field`, read from OpenAPI's own `default`/`description` keywords | Built | `LOCKED` (Phase 1, ADR-0011's Update) |
| Field types `Map`/`Date`/`Datetime` | 9 types total now (string/number/integer/boolean/object/array/map/date/datetime) | Built | `LOCKED` (Phase 1, ADR-0011's Update) |
| Enum values on a String field | `Field.EnumValues`, authored via a comma-separated text field (not Primer's `TextInputWithTokens`, found deprecated in the installed version when checked directly) | Built | `LOCKED` (Phase 1, ADR-0011's Update) |
| Response extract path (document-level, pre-field) | `Operation.ResponseExtractPath` (`x-mill-response-extract-path`), resolved before per-field `x-mill-path`. Deliberately narrower grammar than the reference platform's own (no bracket/`$.` syntax, still genuinely unresolved) — reuses the existing dot-path extractor | Built | `LOCKED` (Phase 1, ADR-0011's Update) |
| Restructure response / file-bearing requests+responses | Not built | Uncertain scope — needs more research before an adopt-vs-build call, not guessed at even after the fuller review, which flags its own transformation semantics as unresolved too | `OPEN`, genuinely under-specified |
| Response caching (TTL, record-scoped sharing) | Not built | Design question first — match key now confirmed as request body + headers + record ID, "share across records" removes only the record-ID boundary. Storage location (DBOS-backed vs. in-process vs. `internal/adapters/settings`) still undecided, library pick after that | `OPEN` |
| Test-log "Copy error" | `ConnectorTestPanel.tsx` log entries, `navigator.clipboard.writeText` (no existing frontend clipboard-write primitive to reuse — confirmed, Mill's clipboard code is all server-side) | Built | `LOCKED` (Phase 1, ADR-0011's Update) |
| Raw-JSON test-payload mode | Additive alongside the per-field table; `TestConnectorRequest.Values` on the wire unchanged | Built | `LOCKED` (Phase 1, ADR-0011's Update) |
| Read-only summary view + explicit Edit mode for a saved connector | `ConnectorSummary.tsx` (Details/Available attributes/Input parameters/Testing tabs) + a restructured one-scroll `ConnectorForm.tsx`, both opened as their own pinned tab | Built | `LOCKED` (Phase 0, ADR-0014) |
| Shared hierarchical schema-editor / typed-tree component (one editor for Connector input, Connector output, Workflow Attributes, future fixtures) | Four-plus separate, not-fully-consistent implementations (`ManualSchemaEditor.tsx` is Connector-only; `ConfigureAttributes.tsx` is its own thing) | Build — a real component-consolidation effort, not a library pick; named directly by the fuller review as one of ten reused product primitives (§3.2's Update) | `OPEN`, a frontend-architecture decision, not urgent |
| Integration-level draft/publish/version/rollback lifecycle | Not built (distinct from the already-`OPEN` workflow-level draft/live versioning, §3.2) | Build, once real | `OPEN`, genuinely unresolved even after the fuller review — real future research |

See §3.2 for the node-type-vs-instance composition pattern and the
incremental-extensibility principle for connector protocol/auth support.

## 5. Browser bridge

Full rationale in [`docs/adr/0003-browser-bridge-architecture.md`](adr/0003-browser-bridge-architecture.md).

- Needed to get page title/DOM payload and per-tab session identity out of
  a live browser tab into the native Mill app.
- **Not native messaging** — the traditional pattern (1Password, Bitwarden)
  was reconsidered and rejected under a strict rule: no hand-rolled
  protocol code, and no adequate Go native-messaging library exists
  (checked directly: the two candidates are archived since 2015, or a
  stale 2020 sample repo — neither real). `LOCKED` (rejected)
- **WXT** (extension framework, MIT, actively maintained, Vite-based) +
  a **Chrome offscreen document** (`IFRAME_SCRIPTING` reason, no forced
  timeout unlike `AUDIO_PLAYBACK`) hosting a same-origin iframe onto
  Mill's existing server-mode page. Every existing generated binding
  (`RunbookService`, etc.) works unmodified inside that iframe — zero new
  protocol, zero new Go code. The extension itself has no business logic:
  content script captures DOM, `chrome.runtime.sendMessage` relays it,
  done. `LOCKED` (architecture) — see ADR-0003 for the full options
  considered.
- This is also the mechanism that would resolve the multi-tab identity
  problem (which agent session a given tab belongs to), since the extension
  runs inside the tab and knows which one it is.
- **Open, not resolved by ADR-0003**: the iframe needs Mill's HTTP
  interface reachable whenever the browser needs it, independent of
  whether the native desktop window is open — today server mode and
  desktop mode are separate build tags that don't run concurrently.
  Intersects with §7 (a "session" already needs to span tab + agent run +
  process). `OPEN`
- **Data point, not yet confirmed**: user reports that copying an entire
  Confluence page (as opposed to a smaller in-page selection) loses
  structure on paste — comes out plain text only. Two different root causes
  are possible: (a) Confluence puts real HTML on the clipboard for a
  full-page copy but something downstream mishandles it, or (b) Confluence's
  full-page copy degrades to plain-text-only at the source, in which case
  there's nothing on the clipboard for any converter to work with. Testing
  with §2.2's Runbook action (reuses the same clipboard-HTML-read path) to
  find out which. If it's (b), that's a concrete case where clipboard-based
  capture is fundamentally insufficient and DOM-read via the browser bridge
  is the only reliable path — not just a nice-to-have for the M365 milestone,
  a requirement for at least this source. Also noted in passing: image paste
  from clipboard already works reliably in most chat apps (image clipboard
  flavors are consistent across sources) — the inconsistency is specific to
  rich-text/HTML flavors, worth keeping in mind when designing the capture
  layer's fallback order (try HTML → try DOM-read → fall back to plain
  text/image, not just clipboard-HTML-or-bust). `OPEN`, pending the test.

## 6. Execution environment & determinism

- `OPEN`. Must not blindly execute anywhere — command execution needs a
  pinned working directory (reference: Claude Code's `~/.claude/projects`
  scoping) and an explicit shell (zsh/sh/etc.) rather than an inherited,
  ambiguous one.
- Not yet decided: how env vars are scoped per project/workflow, whether
  a workflow declares its required shell/interpreter or Mill infers it.

## 7. Process & session tracking

- **Mechanism resolved: `github.com/dbos-inc/dbos-transact-golang` with its
  pure-Go SQLite backend.** Full research, alternatives considered, and a
  hands-on spike (not just docs) are in
  [`docs/adr/0004-execution-process-tracking.md`](adr/0004-execution-process-tracking.md).
  Satisfies the embeddable-in-binary hard filter below (no Postgres, no
  separate daemon) and, empirically verified via a real
  kill-the-process-mid-workflow spike, satisfies the sharpened requirement
  two bullets down: a completed step's result survives the launching
  process being killed before it's reported, without the step re-running.
  `LOCKED` (library choice).
- **Execution: one Mill workflow *run* = one DBOS workflow instance, one
  graph *node* execution = one DBOS step, keyed by the node's own ID —
  `LOCKED`, [ADR-0004](adr/0004-execution-process-tracking.md)
  `accepted`.** `internal/adapters/execution` wraps DBOS;
  `executionservice.go`'s `RunWorkflow` (renamed from
  `RunWorkflowDurable`) is the single durable entrypoint, backed by
  `ListRuns`/`GetRun`/`RedriveRun`. Per [ADR-0008](adr/0008-single-execution-path.md)
  (`accepted`), it's also the *only* execution path in the app — a
  workflow's own list-row Run button and `TriggerService`'s headless
  listeners (hotkey/schedule/clipboard-watch/filesystem-watch) all go
  through it; `CompositionService.RunWorkflow` (a separate, plain
  in-memory path) is deleted. `composition.ExecuteWorkflow`/
  `executeWorkflow` remains the underlying DBOS-free graph-walking
  engine (called with a `StepRunner`), still used directly by
  `internal/domain/composition`'s own unit tests, no longer by any
  Wails-bound service. Every run carries a `RunKind` (`test`/`triggered`).
  Per-step checkpoint overhead is ~281µs (~1.1ms for a 4-step run against
  real DBOS/SQLite) — negligible against interactive latency.
- **Durable-run visibility lives on the workflow it belongs to, not a
  standalone page — `LOCKED`, built.** Originally a top-level "Runs"
  sidebar destination (a `process-tracking` capability, a workflow-
  picker dropdown, a global run list across every workflow); replaced
  after real precedent research (n8n, Retool, Airflow all scope this to
  the individual workflow's own page — a tab or embedded panel next to
  its editor, never a global page reached via a picker) and a direct
  ask to stop making the user "go find" a run somewhere else. Opening a
  saved workflow (Composition's own Edit) now shows a Canvas/Runs inner
  tab switch (`CompositionView.tsx`'s `WorkflowEditorTab`); the Runs tab
  (`WorkflowRunsPanel.tsx`) lists that workflow's own runs
  (`ExecutionService.ListRunsForWorkflow`, filtered post-decode against
  DBOS's `runInput.WorkflowID` — DBOS itself has no native filter on an
  arbitrary field inside the generically-serialized Input) with real
  DBOS status; opening one shows its per-node step breakdown
  (status/output/error) plus **Redrive from here** on any failed step
  (`dbos.ForkWorkflow` from that step's ID) — the "fix forward from the
  failed step" pattern named in §3.2. A brand-new, not-yet-saved
  workflow has no Runs tab at all (nothing to show history for yet).
  The `process-tracking` capability entry and its `Runs` sidebar/Cmd+4
  hotkey are removed, not merely hidden — it was never a separate
  top-level surface once its only UI is a tab inside Workflows.
  `ExecutionService.ListRuns()` (unfiltered, every workflow) still
  exists as the data behind Activity's own cross-workflow feed and any
  future need for it, just not exposed as its own page. Not built: live
  streaming of an in-progress run (this shows a completed/failed run's
  history, not a progress bar), editing a run's original input before
  redrive (`ForkWorkflowInput` has no such field), §3.2's "shadow
  events" half (dry-running a draft workflow version against real
  traffic), and the Runs tab's own Kind filter persisting across a
  reload (deliberately simplified to local component state — a global
  localStorage key made sense for one page, not per-workflow).
- **Concrete failure mode hit at work, sharpening the requirement above**:
  in the Hammerspoon-based setup, when M365 Copilot proposes a command whose
  execution edits Mill's/Hammerspoon's own Lua config file, Hammerspoon's
  file-watcher fires an async hot-reload of that config — which tears down
  and restarts the very process that was about to report the command's
  result back. The result isn't delivered late; it's silently lost, because
  the reporting channel was tied to a process lifetime that didn't survive
  the command's own side effect. This means "persist results independently
  of the launching process" (above) isn't quite sufficient on its own — the
  mechanism specifically has to survive the launching process being killed
  *by the command it ran*, not just normal exit. Rules out any design where
  a result is only held in an in-memory channel/callback scoped to one
  process's lifetime. `LOCKED` (the failure mode and this sharpened
  requirement) — the mechanism satisfying it is still `OPEN`.
- Ties into #5: a "session" spans a browser tab, an agent run, and possibly a
  background process, and Mill needs one identity that threads all three
  together so the user always knows which is which.
- Hard filter on any candidate mechanism (queue, durable-execution engine,
  job runner): must be embeddable directly in the Go binary — no
  separately-installed daemon/CLI, no dependency on a package manager
  (Homebrew etc.) at install time. See §1.2 for the pueue incident this came
  from. Resolved above — DBOS's SQLite backend needs no standalone Postgres
  server, confirmed directly rather than assumed.

## 8. Guardrails / policy

- `OPEN` in detail, `LOCKED` in shape: modeled on Anthropic's Hooks structure
  — a PreToolUse-equivalent preview of the action about to run, checked
  against policy, shown to the user before execution, with sync/async waiting
  around the check and the eventual result.
- **Resolved (§2.1's tension)**: default is a preview/approval popup —
  fail-safe, not fail-open. It is *skipped* only when the action matches an
  explicit, user-configured condition/policy rule saying it's safe to
  auto-run. So friction is the default and speed is the opt-in, not the
  other way around — you only get interrupted "when it needs your
  attention." The hotkey from §2.1 triggers the check, not a bypass of it;
  whether a given hotkey-triggered command shows a popup or runs straight
  through depends on whether it matches a skip rule. `LOCKED` (as the
  default-safe/explicit-skip shape)
- **Skip-condition rules must be testable/validated, not just declared.**
  Whatever authors a "safe to auto-run" rule needs a way to verify the rule
  actually matches what the author thinks it matches (a dry-run / test
  mode against sample actions) before it's trusted live — a policy rule
  that's silently broader than intended is exactly how a guardrail fails
  quietly. Mechanism `OPEN`, requirement `LOCKED`.
- Where rules are authored/stored and how they scope is now designed
  (see the Rule scoping & precedence bullet below, ADR-0019) — not yet
  implemented. Still genuinely open: exactly what a rule can express
  beyond scope (allowlist commands? path scoping?), and how
  pass/fail/pending/skipped states are communicated in the UI.

- **Rule scoping & precedence — `LOCKED` (design), `OPEN`
  (implementation): [ADR-0019](adr/0019-guardrail-rule-scoping-and-precedence.md)
  (`proposed`).** Three scopes, matching cardinalities Mill's Configure/
  canvas split already established (§3.5): node-kind (1:many, even
  broader than Connector reuse — e.g. "no `list-lookup` node ever needs
  approval"), Connector-scoped (1:many, e.g. "any call through Connector
  X with method GET"), and workflow/node-instance-scoped (1:1, e.g.
  "this exact step in this exact workflow"). Node-kind/Connector rules
  belong in a future Configure tab; workflow-level rules stay inline in
  the canvas Inspector. Deny/require-approval always wins over
  allow/skip regardless of which layer set it (Claude Code's
  deny-first precedence, not Kong's specificity-wins). OPA/Rego was
  evaluated and rejected — reuse `expr-lang/expr` (already adopted for
  Decision-edge conditions, §3.3) for any skip-condition expression
  instead of a second policy-evaluation engine. Full reasoning in the
  ADR. Still genuinely open: how Claude Code's third `ask` state maps
  onto Mill's own pass/fail/pending/skipped UI states, and
  `internal/domain/guardrail` itself remains unbuilt.
- **MCP write-tools guardrail scope —
  [ADR-0017](adr/0017-mcp-write-tools-guardrail-scope.md)
  (`proposed`).** §8's three-layer scoping above governs *running* an
  already-authored workflow, not *authoring* one via an external MCP
  channel — writing Mill's own workflow/Configure definitions via MCP
  needs a fourth, orthogonal "authoring-capability scope" gate, not
  covered by ADR-0019. Recommends a default-off toggle plus synchronous
  human approval per write, pending two open sub-questions (whether a
  real MCP host tolerates a long-blocking tool call awaiting approval,
  and what UI renders that approval). No MCP write Tools exist in the
  codebase — `millmcpservice.go` registers only Resources.

## 9. Repo AI workflow (CLAUDE.md / SKILL.md / agent profiles)

Methodology below is `LOCKED` (researched against current Anthropic docs and
cross-checked against other agent frameworks). Which specific skills/agents
actually get built is `OPEN` — the list below is candidates, not commitments.

### 9.1 Conventions — `LOCKED`

- **CLAUDE.md** is instructions-you-write, loaded in full every session —
  keep it under ~200 lines (longer files measurably reduce instruction
  adherence), concrete and verifiable ("run `task build`" not "build the
  app"), structured with headers/bullets, and free of anything Claude can
  derive itself from the codebase (directory layout, dependency lists).
  Multi-step procedures or anything that only matters for part of the repo
  belongs in a skill or a path-scoped rule (`.claude/rules/*.md`), not in
  CLAUDE.md. `docs/SPEC.md` stays the living concept/architecture doc;
  CLAUDE.md only points at it plus encodes standing process (Research →
  Plan → Implement, the hard constraints) — the two must not duplicate
  content, since duplication is exactly how they drift.
- **SKILL.md** files use YAML frontmatter (only `description` is really
  required) + a markdown body that loads on demand rather than every
  session — this progressive disclosure is the entire point: put the
  common-case instructions in the body, push large reference material
  (specs, examples) into supporting files the skill only reads when needed.
  The `description` is a trigger for auto-invocation: lead with the concrete
  use case ("Use when adding a new connector type..." not "Helps with
  connectors"), since Claude matches intent against this text. Skills follow
  the open Agent Skills standard (agentskills.io), which is also what
  Claude.ai and the Skills API consume — sticking to the standard fields
  keeps a skill portable instead of Claude-Code-only.
- **Agent/subagent profiles** are markdown + YAML frontmatter under
  `.claude/agents/`: `name` and `description` are required, `description` is
  the delegation trigger (same discipline as skill descriptions — lead with
  when to use it, not what it is), `tools` is an explicit allowlist (omit to
  inherit everything, which is the wrong default for anything narrow-purpose
  like a read-only reviewer), and the markdown body is the subagent's entire
  system prompt (it does not inherit the parent's). Two agent descriptions
  should never overlap enough to make delegation ambiguous.
- **Cross-framework check**: OpenAI's Agents SDK (instructions + tools +
  explicit handoff list per agent), LangGraph (typed state passed between
  named nodes, explicit edges), and CrewAI (role + goal + explicit tool list
  per agent) all converge on the same shape Anthropic uses here — a scoped
  system prompt, an explicit tool allowlist, and a natural-language
  trigger/role description for routing. Nothing in this repo's setup is
  Anthropic-idiosyncratic; adopting it isn't a lock-in risk.
- **Path-scoped rules are for just-in-time checks, not CLAUDE.md — proven
  against a real miss, not just asserted.** Caught live: `NodePalette.tsx`
  (§3) was built as a flat, hand-rolled `.map()` over node types with no
  grouping, despite CLAUDE.md's existing "use Primer, don't hand-roll"
  rule — the individual pieces (a `Stack`, a styled `<div>`) genuinely
  were Primer, so the miss wasn't a rule-compliance failure, it needed
  semantic judgment about the *collection's shape* that a rule read once
  at session start didn't surface at the moment it mattered. Researched
  whether tooling could catch this class of miss instead of relying on
  memory, rather than assuming either way: PreToolUse hooks can only
  allow/block/inject context, not run semantic code analysis — they can
  enforce "don't run `git reset --hard`" but not "a grouped-list
  component already existed for this shape"; ESLint's
  `no-restricted-imports` catches importing the wrong low-level
  primitive, not choosing the wrong JSX structure — neither tool is
  shaped for this class of check. Anthropic's own context-engineering
  guidance names the actual fix directly: just-in-time retrieval (a
  lightweight pointer surfaced at the point of need) beats upfront,
  always-loaded instructions competing for attention deep into a long
  session — which is exactly what the path-scoped-rule mechanism above
  is for, and it went unused until this. `.claude/rules/frontend.md`
  (scoped to `frontend/src/**`) now carries the actual "check the kit's
  list/group/hierarchy family before hand-rolling a collection UI"
  check; CLAUDE.md's own Primer bullet stays a short pointer rather than
  duplicating it, per this section's own anti-duplication rule. `LOCKED`
- **Doc-scope split — `LOCKED`.** `docs/SPEC.md` is product decisions
  (what Mill is, and why); CLAUDE.md is standing process
  (Research→Plan→Implement, commit discipline) plus genuinely
  product-level hard constraints (no Rust, no AI API, single binary,
  git-clone install, CI/CD day one, SPEC.md-tracks-everything);
  `.claude/rules/*.md` is reusable coding convention (how to write
  code), split by scope: `frontend.md` (path-scoped, the Primer/UI
  rule plus the collection-shape check above), `backend.md`
  (path-scoped to `**/*.go`, domain-package purity), `architecture.md`
  (unscoped — SOLID/DRY/DDD, adopt-over-hand-roll, the 500-line limit,
  since these are cross-language). The three docs must not duplicate
  content, since duplication is exactly how they drift. A rule file
  with no `paths` frontmatter loads at launch with the same priority
  as CLAUDE.md, confirmed directly against Claude Code's current docs
  (`code.claude.com/docs/en/memory.md`) — `paths:` is the correct,
  current frontmatter key; `.claude/rules/frontend.md`'s earlier
  `globs:` (sourced from a third-party report, not the primary docs)
  was fixed to match.
- Sources: Claude Code docs — memory (`/docs/en/memory`), skills
  (`/docs/en/skills`), subagents (`/docs/en/sub-agents`), all at
  `code.claude.com`; agentskills.io (Agent Skills open standard); OpenAI
  Agents SDK, LangGraph, and CrewAI framework docs for the cross-check;
  Anthropic's ["Effective context engineering for AI
  agents"](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  for the just-in-time-retrieval reasoning above.

### 9.2 Candidate skills/agents — `OPEN` (names + one-line justification only; none scaffolded yet)

- **ddd-modeling-helper** (skill) — guides entity/value-object/aggregate
  boundary decisions when domain logic starts landing (§1.1 SOLID/DRY/DDD
  discipline), so the split isn't ad hoc per contributor.
- **adr-writer** (skill) — turns an `OPEN` item in this doc into a proper
  decision record once it's resolved, keeping §10's open-questions log
  honest about what's actually been decided vs. still open.
- **go-wails-conventions** (skill, path-scoped to `*.go` / `frontend/**`) —
  house style for Go service structs, Wails3 binding patterns, and
  React/TS conventions once there's enough surface area to standardize.
- **spec-sync-checker** (skill or hook) — flags when code changes touch an
  area `docs/SPEC.md` marks `OPEN`/`LOCKED` without a corresponding doc
  update, so the living-spec promise in the doc's header doesn't silently
  lapse.
- **connector-scaffolder** (agent) — once §4's connector model is `LOCKED`,
  generates the boilerplate for a new connector against the settled schema —
  useful specifically to avoid point-solution drift per-connector (§0).
- **guardrail-policy-reviewer** (agent) — once §8's policy model is
  `LOCKED`, reviews a proposed guardrail/policy change for gaps before it's
  trusted to gate real command execution.

None of the above should be built before the section of the spec it depends
on (§3, §4, §8, etc.) moves off `OPEN` — building the helper before the
domain concept it encodes is settled is the inner-platform-effect failure
mode from §0 repeating itself one level up.

### 3.8 Cross-cutting UI mechanisms from the live-review pass

All prompted directly during live use; each either built (`LOCKED`) or
recorded as a real design input (`OPEN`), never silently dropped.

- **Cards/table view switch on every data-inventory page — `LOCKED`,
  built.** `shared/ViewModeToggle.tsx` + `shared/viewMode.ts`
  (per-page localStorage persistence); the table half is Primer's own
  `DataTable` (adopted per `.claude/rules/frontend.md`'s component
  reference, not hand-rolled) on Workflows
  (`composition/WorkflowsTable.tsx` / `WorkflowsCards.tsx`, split out
  of `CompositionView.tsx` at the 500-line limit), Integrations,
  Lists, and MCP Servers; Activity already renders as a `DataTable`
  natively and additionally gained a free-text search over what ran
  and its result. The per-workflow Runs tab keeps its structured list
  (a run's step breakdown isn't row-shaped) — deliberate, not a gap.
- **User-facing "Composition" naming retired** — Activity's source
  chip says "Manual run" and its copy says "a direct Run click on a
  workflow"; the sidebar already said Workflows. Code-level
  `composition`/`CompositionService` names are unaffected (ADR-0016's
  own code-vs-UI naming split, applied again).
- **Child-workflow authoring copy rewritten in plain language** — the
  node is "Run another workflow"; the DBOS idempotency key is
  presented as "Skip duplicate runs (optional)" with a
  what-it-actually-does caption ("idempotency" was flagged as too
  technical to lead with — mechanism unchanged, ADR-0010); the
  callable-workflow picker's empty state now names the exact next step
  (create a workflow whose trigger is "callable by another workflow")
  instead of a dead-end empty dropdown.
- **Native macOS titlebar strip reserved explicitly — `LOCKED`,
  built.** The desktop window uses `MacTitleBarHiddenInset` (main.go),
  so the traffic lights float over the content's top-left;
  `env(safe-area-inset-*)` is always 0 on desktop and covers none of
  it (a real regression the padding cleanup shipped, caught from a
  screenshot). `App.tsx` adds `.app-shell--native-titlebar`
  (38px top padding) only inside the Wails webview (`window._wails`
  present) — a browser tab on the server-mode interface reserves
  nothing.
- **Source-first analytics on Activity — now `LOCKED`, built** (the
  reference pattern asked for directly: select the input source, see
  its activity, columns from the source's own attributes, search over
  attribute values). Picking a specific workflow on Activity swaps the
  session-only live feed for that workflow's **durable** run history
  (`ExecutionService.ListRunsForWorkflow`, DBOS-backed —
  `ActivityRunsExplorer.tsx`, Primer DataTable): one column per
  declared Attribute, its cell showing what each run was invoked with
  (`RunSummary` now exposes `Values` and the executed `Version`,
  ADR-0021's per-run stamp rendered as `vN`/`draft`), plus Kind/Status
  and a search across attribute values and output. "All workflows"
  keeps the live cross-workflow feed unchanged. Proven on the seeded
  pair end-to-end: running the parent produces a child run whose typed
  `message` value appears as a real column cell, search hit, and `v1`
  stamp under the child's own history. Still future: date-range
  filters and export (§3.2 names both), and shadow events (§7). Also from the
  same review: **hover-preview for workflow references — now `LOCKED`,
  built** (n8n/Oscilar's own pattern). `WorkflowHoverPreview.tsx`
  composes only already-adopted pieces: Primer's `AnchoredOverlay` for
  the popup, React Flow itself (the same engine the real canvas uses)
  rendering the referenced workflow's *actual layout* read-only, and a
  new store-level `openWorkflowRequest` seam for the jump (requester
  and editor-tab owner live in different view trees, so a store field
  beats a six-level callback prop). Anchored on the child-workflow
  step's Inspector hint and on a dedicated peek icon per Activity row
  — deliberately *not* the row label itself: a first cut wrapped the
  label and silently broke its expand-the-result click, caught by the
  existing activity e2e, exactly what that committed test existed for.
  "Open" jumps straight into the referenced workflow's editor tab.
  Proven on the seeded parent→child pair end-to-end (the seed IS the
  proof): hover shows the child's real 3-node layout, Open lands in
  its editor.
- **Dev-staleness root cause found and fixed — `LOCKED`.** Two
  compounding causes made "my app looks stale" recur: (1) every
  wails-built desktop binary passed `-buildvcs=false` (dev *and*
  production, `build/*/Taskfile.yml`), so §3.7's build-identity footer
  — built precisely to make staleness visible — was permanently blank
  in the desktop app (it only ever worked for raw `go build` server
  binaries); the flag is removed from all first-party build branches
  (the vendored ios/android scaffolds keep theirs). (2) `wails3 dev`
  restarts can orphan a previous app instance whose window stays open
  — two Mill windows, one stale, both sharing the real settings.json
  (§3.7's own dual-process hazard); with the footer now showing the
  commit hash in every build shape, a stale window identifies itself.

## 10. Open questions log

- Enterprise/regulated deployment readiness (§11, new) — researched
  (OSS public/enterprise split precedent across six real projects, and
  what Mill's actual hexagonal architecture supports today vs. doesn't),
  nothing decided or built. Two of three named example gaps (credential
  storage, execution/audit backend) turned out already fixable as
  independently-justified adapter work, done this session; the
  build-tag-vs-runtime-injection question itself stays `OPEN` pending a
  real requirement.
- Node/canvas composition model (§3) — Decision/Integration/List
  execution + authoring, and now Child Workflow (§3.3/ADR-0010), are
  built; Parallel Steps and draft/live versioning remain the open parts
- **Workflow lifecycle + versioning — `LOCKED`, built:
  [ADR-0021](adr/0021-workflow-lifecycle-and-versioning.md)** (see
  §3.3's Update for the full shape). Researched first as the user
  asked: DBOS's `ApplicationVersion` versions the app binary, not
  definition data (verified against the installed v1.0.0 source), so
  the definition lifecycle is Mill's own. Still open from that pass,
  deliberately: shadow evaluation (blocked on a per-node purity model,
  §8), staged-traffic promotion, version diffing.
- Browser extension ↔ native app protocol details (§5)
- Env/shell determinism rules (§6)
- Session identity model spanning tab + agent run + process (§7)
- Policy authoring format and storage (§8) — scoping/precedence design
  now has its own ADR, [ADR-0019](adr/0019-guardrail-rule-scoping-and-precedence.md)
  (`proposed`: three layers node-kind/Connector/workflow, deny-always-
  wins precedence, OPA/Rego evaluated and rejected in favor of reusing
  `expr-lang/expr`) but still needs implementation; the
  pass/fail/pending/skipped UI-states question is untouched by this
- Global app settings (§3.7/[ADR-0020](adr/0020-global-app-settings.md))
  — launch-at-login, a global summon hotkey, auto-update wiring, a tray
  icon, per-view hotkeys, and window/tab/filter state persistence are
  all `LOCKED` and built. Still `OPEN`: menu-bar/dock toggle,
  trigger-fire notifications (no settled design yet), the multi-tenant-
  seam question (researched, recorded as deliberately declined),
  fullscreen window-state tracking (deliberately not built, named gap)
- Connector input/output schema mechanism (§3.3/§3.5/§4/ADR-0007) —
  `LOCKED` and fully built (Phase 1+2+3): `internal/adapters/openapispec`,
  `Connector.OpenAPISpec`, Configure UI + "List operations", the
  `integration-http` Attribute-binding editor
  (`IntegrationBindingsEditor.tsx`), and `ValidateGraph`'s secret
  guardrail. ADR-0007 closed.
- Bash-execution-through-our-process-but-nothing-is-ours reading (§1.1) —
  confirm with the user
- Single execution path (§7/ADR-0008) — `LOCKED` and built: every
  workflow run (a workflow's own list-row Run button, a headless trigger
  fire) goes through one durable `ExecutionService.RunWorkflow`
  entrypoint now, tagged `RunKind` (`test`/`triggered`); the plain
  in-memory `CompositionService.RunWorkflow` path is deleted.
- Live picker + inline quick-create for Connector/List/MCP Server/
  Workflow references (§3.5/§3.6/ADR-0009, extended by ADR-0010) —
  `LOCKED` and built: `connectorId`/`listId`/`mcpServerId`/`workflowId`
  all render as a live `Select` (`EntityRefField.tsx`) instead of a
  paste-an-ID text box; the first three get an inline quick-create
  dialog, `workflowId` deliberately doesn't (creating a workflow is
  Composition's own "New workflow" flow).
- Sectioned Connector configuration + Manual/CSV schema authoring (§4/
  ADR-0011) — `LOCKED` and built: `ConnectorForm.tsx`'s General/Auth/
  Headers/Schema tabs, `ManualSchemaEditor.tsx`, CSV import (PapaParse),
  `Field.Alias`/`Path` via OpenAPI `x-*` extensions, nested-path output
  extraction. **Still `OPEN`, deliberately deferred**: a "primary key"
  concept for a schema field — raised by the user, but their own answer
  surfaced genuine uncertainty about what it should mean and no
  concrete consumer was identified (possibly conflating connector-
  schema authoring with a separate, real question: cross-workflow data
  access, closer to this section's own still-open session-identity
  model than to connector schemas). Revisit once a real use names what
  should actually consume it, not speculatively.
- Connector draft testing + duplicate (§4/ADR-0013) — `LOCKED` and
  built: `ConnectorTestPanel.tsx`'s Test tab (real HTTP call via
  `ConfigureService.TestConnectorOperation`, example-value generation,
  a session-local request/response log) and Duplicate. ADR-0013 closed.
- Configure layout: inspect-vs-edit + one-scroll authoring + own pinned
  tab (§3.5's Update, ADR-0014) — `LOCKED` and built: `ConnectorSummary.tsx`
  (read-only, tabbed) + a restructured `ConnectorForm.tsx` (one
  continuous scroll, no more Primer Tabs), both opened as their own
  pinned tab in `ConfigureIntegration.tsx` via the same mechanism
  Composition already uses. Phase 0 of the connector-capability-maturity
  goal (§3.2/§4.1's Update) — ADR-0014 closed.
- Schema-authoring maturity (§4.1, ADR-0011's Update) — `LOCKED` and
  built: paste-sample field inference (`genson-js`), `Field.Default`/
  `Description`/`EnumValues`, the `map`/`date`/`datetime` type
  additions, a document-level `Operation.ResponseExtractPath`, and the
  Test tab's Copy-error button + raw-JSON payload mode. Phase 1 of the
  connector-capability-maturity goal.
- Auth-type catalogue + extensibility seam (§4.1, ADR-0015) — `LOCKED`
  and built: a registered `AuthStrategy` per `AuthType` replaces the
  old single-header switch; HMAC-SHA256, RFC 5849 OAuth 1.0a
  (HMAC-SHA1), OAuth 2.0 `client_credentials` (via a new
  `internal/adapters/oauth2client` adapter), and query-param placement
  are real; `oauth1vendor`/`mtls` are real, registered stubs proving
  the seam accepts a new `AuthType` as a pure addition. `configureservice.go`
  split into `configureservice_connectorauth.go` as part of the same
  change. Phase 2 of the connector-capability-maturity goal.
- JOSE/JWE request/response encryption (§4.1, ADR-0015's Phase 3
  Update) — `LOCKED` and built: `go-jose/go-jose/v4`
  (RSA-OAEP-256/A256GCM, Mill's own stated default), independent of
  AuthType, wired into `integration-http`'s pipeline before/after
  `ApplyAuth` and the HTTP call respectively. Mill's own private key
  (only needed for optional response decryption) lives in a second,
  JOSE-specific OS-keychain entry, distinct from whatever AuthType
  secret the same connector uses. `configureservice_test.go` split into
  `configureservice_connectorauth_test.go` in the same change (crossed
  500 lines). Phase 3 of the connector-capability-maturity goal — this
  closes all four planned phases (Configure layout, schema-authoring
  maturity, auth-type catalogue, JOSE/JWE).
- Seeded example connectors (§4's Update) — `LOCKED` and built: seven
  built-in Connectors, one per real implemented `AuthType`, extending
  Workflows' existing seeded-example practice to Connectors. Each
  targets an independently-verified-live public service (Postman
  Echo's real OAuth1 signature validation, httpbin.org's real Bearer
  check, or an honest self-consistency-echo where no third party
  validates the scheme); the OAuth2 example ships with a real token URL
  and no credentials, since Mill's repo will never carry a real client
  secret. `Connector` gained `Description`/`BuiltIn` fields.
- Connector/Integration surface — reference-platform-informed capability
  map (§3.2's Update, §4.1) — `OPEN`, nothing built or scheduled yet.
  Real, researched gaps: connection mode (real-time/send-and-wait/
  receive-only — the latter is §3.4's own webhook-trigger row, not a
  separate question), DB/Python-function connector kinds, mTLS, JOSE/
  JWE, XML request/response, schema-from-example authoring, richer
  Field shape (Default/Description/Map/Date/Datetime/Enum), a
  document-level response-extract-path, response caching, and a
  read-only-summary/explicit-Edit-mode UX pattern for a saved
  connector. The last one is a direct, still-open answer to whether
  Configure should keep tabbing its create/edit forms the way
  Composition's canvas Inspector does (the evidence points toward: tab
  the saved-record summary, not the act of authoring) — surfaced for
  the user, not resolved here. §4.1's table has the full adopt-vs-build
  breakdown per item. A fuller consolidated review (§3.2's own
  follow-up) resolved several items and added real new ones: the full
  7-option auth-type catalogue, mTLS's complete field
  set (plus a governance flag on its disable-validation toggle), a
  SOAP request-template layer, and the caching match-key (request body
  + headers + record ID) are now known specifics, not vague gaps; ten
  reused UX/component patterns were named as a real precedent for
  Mill's own frontend component-reuse discipline (one shared schema-
  editor, one typed-tree viewer, one work-tab shell, etc.) — no
  component consolidation done yet, captured for when any one surface
  gets generalized. Genuinely still unresolved even after this pass,
  not guessed at: Send-&-wait/Receive-only's exact webhook/polling
  config and correlation contract, the XML template's real expression
  grammar, "restructure response"'s exact transformation, and
  Integration-level draft/publish/version/rollback lifecycle.
- **Connector → HTTPRequest rename + open Method field, [ADR-0016](adr/0016-http-request-entity-and-open-method.md)**
  — Phase A (`LOCKED`, built): the entity renamed end-to-end
  (`internal/domain/httprequest.HTTPRequest`, every `ConfigureService`
  RPC, the frontend's `RequestForm.tsx`/`RequestSummary.tsx`/
  `RequestTestPanel.tsx`/`ConfigureRequests.tsx`), with a real
  persisted-data migration (`configure-connectors` → `configure-requests`)
  for already-existing real data, not a silent drop. "Connector" is now
  free as this section's own umbrella term for future connector kinds.
  Method-opening (Phase B's method half) + Phase C are also `LOCKED`,
  built: `integration-http`'s Method is now an open `FieldText` +
  `Suggestions` (datalist hints including RFC 10008's `QUERY`), proven
  through the real execution path and a real e2e round trip, not just
  unit-tested. **Still `OPEN`, real future work**: the Params tab
  (query/path key-value rows, replacing the raw `path` string) and the
  Body-type picker (raw+format/form-data/x-www-form-urlencoded/binary/
  GraphQL, replacing the literal `bodyTemplate` string) as the default
  authoring UI — Phase B's own bigger, genuinely separate design
  surface, tracked in the ADR, not silently folded into what shipped.

## 11. Enterprise / regulated deployment readiness

`OPEN` throughout — this section is Research only. Nothing here is
decided, locked, or built; no code changed as a result of it beyond
what's already independently justified and recorded elsewhere (the
credential-store interface, §3.5's Configure section, and the execution
DSN parameterization, §7). Prompted directly: the user wants to run Mill
at a bank eventually, wants to keep a public OSS edition too, and asked
what the industry pattern is for that split and whether Mill's current
hexagonal architecture (Go domain/adapters + Wails3 single-binary shell
+ React frontend) could support it. Two research passes, kept separate
per this doc's own standing discipline (§1.2's DBOS/pueue precedent —
don't conflate two different questions just because they're related):
one surveying real OSS precedent for a public/enterprise split, one
reading Mill's actual code to check what the architecture supports
today versus what it doesn't.

### 11.1 OSS public/enterprise split precedent

Six real projects checked against primary sources (actual license
files, actual build tags/CI config, actual repo structure via `gh api`
— not blog-post summaries):

| Project | Split point | Enterprise code in public repo? | Gate mechanism |
|---|---|---|---|
| HashiCorp Vault | Build-time (`-tags enterprise`) | **No** — only inert `!enterprise` stubs (e.g. `enterprise_token_lookup_ce.go`) | Compiled from a separate, non-public source tree |
| GitLab CE/EE | Runtime | **Yes** — `ee/` directory, same repo | `License.feature_available?` checks |
| Grafana OSS/Enterprise | Build-time, CI-merged | **No** — separate private `grafana-enterprise` repo | A real Dagger function, `InitializeEnterprise(grafana, enterprise)`, merges two directory inputs + a license key |
| Sentry self-hosted/SaaS | Neither — single license (FSL), not a feature-gate model | Mostly yes; a few named AI/hardware features carved out | N/A — this precedent stopped being current in Nov 2023; the historical `getsentry`-private-overlay pattern this section was originally asked to check no longer exists |
| n8n | Runtime | **Yes** — `.ee.`-marked files/directories, same repo | A license-key check at startup (`LICENSE_EE.md`) |
| Coder | Build-time-inclusive by default (enterprise code always compiles into the standard binary), runtime-gated | **Yes** — `enterprise/` directory, same repo | An offline-verified, ed25519-signed JWT license token (`golang-jwt/jwt/v4`) — no phone-home to validate |

Real convergence, not asserted: **the moment a project keeps everything
in one buildable repo (GitLab, n8n, Coder), the code is physically
present and the gate is a runtime license/feature check. The moment
code must stay genuinely confidential (Vault's real enterprise
internals, Grafana's enterprise features), it lives in a separate,
privately-built repo, merged only at CI time by the vendor's own
infrastructure — never by an end user's `git clone`.**

One fact none of the six precedents had to deal with, because none use
this exact repo shape: **Go's compiler enforces that packages under
`internal/` cannot be imported by code outside the same module**
(confirmed empirically, not just cited — a throwaway module with a
`replace` directive pointing at this repo failed with `use of internal
package github.com/alicoding/mill/internal/domain/httprequest not
allowed`). This means Grafana's exact mechanism — a wholly separate
private repo importing the public repo's swappable pieces, merged at
build time — **is not directly reachable for Mill as structured today**.
A bank-side private repo cannot `import
"github.com/alicoding/mill/internal/adapters/credential"` at all.

**Recommendation (research-stage, not adopted): Coder's shape, minus
its license-key half.** One repo, enterprise/regulated-specific adapters
compiled in by default (or behind a Go build tag) rather than gated by
a commercial license key — because Mill's actual stated problem is
"different backing infrastructure for a regulated deployment," not
"unlock a paid tier." A license-key/entitlement layer (Coder's JWT half,
GitLab's `feature_available?`, n8n's Enterprise License check) is
mechanically reachable offline (an ed25519-signed local file needs no
phone-home, satisfying §1.1) but explicitly **not** recommended for now
— it would be config surface for a decision that doesn't exist yet, the
same trap this doc already names repeatedly elsewhere (single-option
`Select`s, the Configure-surface recheck, §3.5).

### 11.2 What Mill's current architecture actually supports

Read directly against the real code (file/line citations below), not
reasoned about in the abstract. The honest finding: **the three
capabilities named as examples (credential storage, audit/execution
backend, connector auth) turned out to need three different answers,
not one.**

- **`internal/adapters/settings.Store` already works as a real port.**
  Every consumer (`ConfigureService`, `CompositionService`,
  `TriggerService`) depends on the `Store` interface (`Get`/`Set`), not
  the concrete `*kvstore.KVStoreService` type. A bank-mandated backing
  store swaps in cleanly, zero domain-code changes. Confirmed working,
  not a gap.
- **`internal/adapters/execution` (DBOS) doesn't need an adapter swap at
  all.** DBOS itself already accepts Postgres/CockroachDB DSNs
  (confirmed by reading `dbos.Config`'s own doc comment) — Mill was
  just hardcoding `"sqlite:" + dbPath` in one line
  (`internal/adapters/execution/execution.go`). Fixed independently this
  session (task #4, §7 already reflects the mechanism): a regulated
  deployment's audit database is now a config decision
  (`MILL_EXECUTION_DATABASE_URL`), not an architecture change.
- **`internal/adapters/credential` was the one genuine adapter-shape
  gap** — 12 direct package-function call sites (`credential.Set/Get/
  Delete`), no interface, no injection, unlike `settings.Store`. Fixed
  independently this session (task #3): `credential.Store` now mirrors
  `settings.Store`'s exact shape. Justified on its own merits
  (testability) regardless of whether an enterprise edition ever ships.
- **Connector auth (`RegisterAuthStrategy`, ADR-0015) already supports
  pure addition** — a new `AuthType` strategy registers without
  touching existing code. The friction is smaller and elsewhere: a
  closed `Validate` switch in `internal/domain/httprequest/
  httprequest.go` and a hand-maintained frontend label map, both
  fixable in place, neither a structural blocker.
- **Build tags don't generalize to a third variant cleanly.** Mill's
  only tag today is `server`/`!server`; `!server` is a negation, so a
  third tag (e.g. `enterprise`) makes every existing `//go:build
  !server` file ambiguous (compiles into an enterprise desktop build
  too, silently, unless every such file is re-audited to add `&&
  !enterprise`). Compounding this: CI's `golangci-lint`/`go test` only
  ever run with `-tags server` — desktop-tagged code (`hotkey_desktop.go`
  etc.) is already unverified in CI today, a pre-existing gap a third
  variant would inherit and multiply, not fix.
- **`internal/domain/composition`'s registries (`RegisterNodeType`,
  `RegisterTrigger`) support addition, not substitution** — both panic
  on a duplicate ID (§3.6/ADR-0006's own documented fail-fast choice,
  now cross-referenced from the registries' own doc comments per task
  #6 this session). An enterprise variant wanting to *replace*
  `integration-http` with an audited version can't register over it.
  `RegisterAuthStrategy` diverges further (silently overwrites instead
  of panicking) — also now documented, not a decision, just a
  previously-invisible inconsistency made visible.
- **`internal/domain/composition` imports concrete adapters directly**
  (clipboard, openapispec, httpconnector, expression, mcpclient,
  oauth2client, markdown) rather than through an injected seam for
  everything — `integration.go`'s `httpconnector.Execute` call is the
  concrete example. A domain-layer file, not a service-layer one, so an
  enterprise-only HTTP client requirement (mandatory audit log per call,
  a forced proxy) would touch domain code today. Not urgent — no stated
  requirement needs this yet — but a real, named gap, not glossed over.

**Recommendation (research-stage, not adopted): favor runtime
configuration over compile-time build variants wherever the existing
seam already supports it** (settings, execution DSN, auth strategies —
three of four already do, two fixed this session), and treat build
tags as reserved for genuine platform mutual-exclusivity (the existing
`hotkey`/`launchatlogin` desktop-vs-server split), not a product-edition
axis layered on top of it. This is a *stronger* fit for §1.1's locked
single-binary constraint than a compiled variant would be, not a
compromise against it.

### 11.3 What this forecloses, and what doesn't need deciding yet

Choosing "runtime injection over build variants" (if it's ever chosen —
nothing here commits to it) would foreclose compile-time exclusion of
code from the public binary — if a bank's real requirement ever turns
out to be "the proprietary logic must not be in the shipped public
artifact," runtime injection can't satisfy that; only build tags or a
genuinely separate module could, and §11.1 already establishes that a
separate-module approach needs `internal/` → `pkg/` plus extracting the
seven root `*service.go` files out of `package main`, a repo-wide
restructuring that directly contradicts ADR-0001's locked flat-root
layout. Not evaluated further here since no concrete requirement has
named it yet — the trigger to revisit is a real requirement phrased as
that sentence, not speculation.

Nothing in §11.1 or §11.2 requires a decision now. The two adapter
fixes this session (credential interface, execution DSN) were justified
independently of this question and would have been worth doing either
way. Everything else — which of §11.1's mechanisms to adopt, if any;
whether registries should support substitution; whether
`composition`'s direct adapter imports need an injected seam — stays
`OPEN` until a real regulated-deployment requirement exists to design
against, per this doc's own standing rule (§0, CLAUDE.md's Plan step):
list the capability map before locking a schema, don't design from a
hypothetical.
