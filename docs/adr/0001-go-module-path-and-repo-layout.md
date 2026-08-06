# ADR-0001: Go module path and repo layout (internal/domain + internal/adapters)

## Status
accepted — Phase 1 (module rename) and Phase 2 (internal/domain +
internal/adapters split) both shipped 2026-08-06

## Context
Mill's Go side is currently `module changeme` (unchanged wails3-scaffold
default) with five flat root-level `*.go` files, no `internal/` packages at
all. CLAUDE.md already locks a rule this repo isn't following yet: commodity
concerns (parsing, wire protocols, OS plumbing) may be bought via vetted
libraries, but they must sit behind a clean interface at the domain boundary
so swapping the library later never touches domain logic — and Mill's actual
core domain (guardrail evaluation, Capture→Process→Apply orchestration, the
capability/action composition model, session-identity resolution) must stay
hand-written and never delegated to a library. Reading the five files
directly: `runbookservice.go` already contains a real, live instance of
Capture→Process→Apply (osascript clipboard read → `html-to-markdown` convert
→ osascript clipboard write) with zero interface seam around either
commodity call, and `hotkeyservice.go` wraps `golang.design/x/hotkey`
directly the same way. There's also a live duplication: `runbookservice.go`
writes the clipboard via `osascript` (`writeClipboardHTML`) and
`hotkeyservice.go` writes it via a second, independent `pbcopy` invocation
(`copyToClipboard`) — two unrelated clipboard-write adapters for the same
concern.

At the same time, SPEC.md §3 (capability/node composition model — how
"actions" get declared, typed, and composed) is explicitly `OPEN`, and the
user has stated the core tension directly: the full set of capability
primitives Mill will need isn't known yet. Any repo-layout decision made now
must not quietly pre-decide §3 by shape (e.g. inventing a generic
`Capability` interface off the back of the two Runbook actions that happen
to exist today).

## Decision drivers
- CLAUDE.md's ports/adapters rule for commodity deps is already unmet in the
  current code — this is closing an existing gap, not adding new scope.
- SPEC.md §3 is `OPEN`; CLAUDE.md requires surfacing `OPEN` items, not
  silently resolving them by implementation.
- wailsapp/wails v3's own CLI repo (`cmd/wails3` + flat `internal/*`, no
  `pkg/`, no `api/`) is the concrete precedent already researched (Q4);
  golang-standards/project-layout is explicitly not an official Go
  convention (Russ Cox, github.com/golang-standards/project-layout#117) and
  targets multi-binary services, not this app's shape.
- Wails3's binding generator expects Wails-facing service structs to be
  discoverable the way they are today — whatever changes, `main.go`'s
  `application.NewService(...)` wiring and the `*service.go` files it
  references must keep working without generator-specific rework.
- CLAUDE.md: "the current scaffold is intentionally trivial; do not
  over-engineer it prematurely, but do not bolt unrelated concerns onto it
  either once real capabilities start landing." Two of the five files
  (`greetservice.go`, `specservice.go`) have no real domain logic to
  protect; forcing a split there would be over-engineering, not discipline.

## Options

### A. Leave everything flat at root (status quo)
- Pros: zero migration risk; matches "don't over-engineer the trivial
  scaffold" literally; nothing to review.
- Cons: leaves the CLAUDE.md ports/adapters rule unmet on code that already
  exists (`html-to-markdown`, `golang.design/x/hotkey`, two independent
  clipboard-write paths, inlined with no seam); the duplication between
  `writeClipboardHTML` and `copyToClipboard` persists and will only grow as
  more Runbook actions land before any structure discourages it; every
  future Runbook action keeps landing directly in a growing `runbookservice.go`
  with no separation between "the actual Capture→Process→Apply logic" and
  "the OS/library plumbing under it."
- Reversibility: cheap to defer, but scaffold debt historically doesn't get
  paid down on its own — that's the inner-platform-drift pattern §0 already
  names once.

### B. Introduce `internal/domain/` + `internal/adapters/` now, selectively (recommended)
Move only what's already identifiably commodity-plumbing vs.
already-identifiably-domain, based on what's actually in the five files
today. Introduce **no** generic capability/node interface — the concrete
`Action` struct and switch-based `Run` dispatch in `RunbookService` stay
exactly as concrete as they are now.

File-by-file:
- **`main.go`** — stays at root, unchanged in shape (Wails wiring: service
  registration, window options, asset embed). Only touched to reflect the
  module rename (see below).
- **`greetservice.go`** — scaffold demo, zero real logic (`"Hello " + name`).
  Not a layout question at all; flag for deletion as dead weight independent
  of this ADR (single defensible answer, not architectural — noted here so
  it doesn't get silently carried forward, not decided by this ADR).
- **`specservice.go`** — `go:embed` of `docs/SPEC.md` + one getter. No
  domain logic exists to protect. Stays at root, unextracted — pulling an
  8-line file into `internal/adapters/docs` for a single `//go:embed` would
  be layering for its own sake.
- **`runbookservice.go`** — split:
  - `internal/adapters/clipboard` (new): `ReadHTML() (string, error)`,
    `WriteHTML(string) error`, `WriteText(string) error` — the osascript
    HTML read/write plus a `WriteText` that subsumes `hotkeyservice.go`'s
    separate `pbcopy` path, fixing the duplication found above.
  - `internal/adapters/markdown` (new): `ToMarkdown(html string) (string,
    error)` — wraps `html-to-markdown` behind Mill's own name, so swapping
    the library later (per CLAUDE.md) never touches call sites.
  - `internal/domain/runbook` (new): the `Action` struct, the actual
    Capture→Process→Apply call sequences (`runLoadSampleHTML`,
    `runClipboardHTMLToMarkdown`), calling the two adapters above. This is
    the hand-written orchestration CLAUDE.md says must never be delegated —
    today it's two cases in a switch, and it stays exactly that shape.
  - `RunbookService` (root, thin): keeps `List()`/`Run(id)` as the
    Wails-facing shim delegating to `internal/domain/runbook`. No behavior
    change from the frontend's perspective.
- **`hotkeyservice.go`** — split:
  - `internal/adapters/hotkey` (new): the `golang.design/x/hotkey`
    specifics — key/modifier name maps, `Register`/`Unregister`/`Keydown`
    calls — behind a small interface Mill defines (e.g. `Bind(mods []string,
    key string) (unbind func(), events <-chan struct{}, err error)`).
  - `HotkeyService` (root, thin): keeps the binding-ID↔label map and the
    Wails-facing `Assign`/`Unassign`/`List` methods, now calling
    `internal/adapters/hotkey` and `internal/adapters/clipboard.WriteText`
    (removing the second clipboard implementation).
- Pros: closes the existing CLAUDE.md gap; matches the wails3-v3 precedent;
  the domain/adapter boundary is stable **regardless of what §3 decides** —
  no matter what shape the eventual capability/node schema takes, "hand-
  written orchestration in one package, commodity wrappers behind a small
  interface in another" doesn't get invalidated by that decision, so this
  isn't work that has to be redone when §3 resolves; fixes the found
  clipboard-write duplication as a direct byproduct.
- Cons: touches three of five files in one logical change (splittable into
  three small commits — one per file — to stay inside CLAUDE.md's
  "small, reviewable steps" rule); some judgment calls on exactly how thin
  an adapter interface should be for a single-function wrap (kept minimal
  here deliberately — one function per concern, no elaborate interface
  hierarchies).
- Reversibility: high — moving code between packages in the same module is
  mechanical, not a wire-format or schema commitment.

### C. Also introduce a generic `internal/domain/capability` interface now
Same as B, plus a `Capability` (or `Action`/`Node`) interface that
`RunbookService`'s two actions would conform to, anticipating §3.
- Pros: might save a rewrite if §3 later converges on something similar.
- Cons: directly violates the explicit instruction — both this task's and
  CLAUDE.md's — not to silently resolve an `OPEN` item by implementing one
  option. Two concrete actions and a switch statement is nowhere near
  enough evidence to infer cardinality, typed inputs/outputs, sync vs.
  async, or composability into a canvas — guessing now risks exactly the
  point-solution/inner-platform trap SPEC.md §0 exists to prevent. An
  interface that leaks into two already-Wails-bound services becomes de
  facto load-bearing fast, and is expensive to unwind once more actions
  accumulate on top of a guess.
- Reversibility: poor, for the reason above.

### D. Also decide npm workspaces now (frontend/ + future browser-extension/)
- Considered per Q5 research (npm workspaces recommended over
  Turborepo/Nx when a second JS package exists). Rejected for *now*,
  independent of A/B/C above: there is no second JS package yet —
  `browser-extension/` doesn't exist and SPEC.md §5 is still `OPEN`/unbuilt.
  A workspace root `package.json` with a single member (`frontend`) is pure
  ceremony with no present benefit. Revisit at the moment
  `browser-extension/` is actually scaffolded, not before. `go.work` is not
  applicable at all — it solves multi-Go-module coordination, and Mill's
  single-binary constraint (§1.1) means it stays one Go module permanently
  (wails3's own CI explicitly sets `GOWORK=off`, per Q5).

## Module path (separate small decision, same ADR)
`go.mod` currently reads `module changeme` — the unmodified scaffold
default. This needs to change regardless of A/B/C above, but the destination
path is a real fork: a bare local name (`module mill`) works and is simplest,
but a full hosted path (`module github.com/<owner>/mill`) is what every Go
tool (`go install`, checksum verification via sum.golang.org, and any future
`go get`) expects, and is what wailsapp/wails and virtually every real Go
module use. **No git remote is configured on this repo yet**, so the exact
`<owner>` segment is unconfirmed — this needs Ali's confirmation before
Phase 1 lands (see ADR-0002), since every `internal/*` import path will be
rooted at it and a later change is a mechanical but repo-wide rename.
Recommend the full hosted path once the destination is confirmed; using a
bare local name today only to rename later is strictly worse than asking
once.

## Recommendation
**B**, plus deferring workspaces (D's conclusion) and confirming the module
path before Phase 1. B is the only option that both satisfies CLAUDE.md's
existing (already-due) ports/adapters rule and stays silent on §3 exactly
where SPEC.md requires it to stay silent — it fixes a real, already-found
duplication as a side effect, and every file gets a change only where real
logic justifies it, not uniformly.

## Consequences
- Locks: two new packages (`internal/domain/runbook`,
  `internal/adapters/{clipboard,markdown,hotkey}`) and the convention that
  future domain logic goes in `internal/domain/*`, future commodity-library
  wrapping goes in `internal/adapters/*`, and `*service.go` at root stays a
  thin Wails-binding layer. `main.go` and Wails' binding-generator
  expectations are unaffected.
- Unlocks: swapping `html-to-markdown`, `golang.design/x/hotkey`, or the
  clipboard mechanism later touches exactly one adapter file each, never
  domain logic or Wails bindings; a single clipboard-write path instead of
  two; a clean, uncommitted place to put the next Runbook action's real
  logic without re-litigating this question each time.
- Follow-ups: ADR-0002 (CI/CD) sequences this as its Phase 2, after Phase 1's
  module rename; §3 resolving will determine whether/how
  `internal/domain/runbook`'s concrete `Action` shape generalizes — that's a
  future ADR, not this one.

## Lifecycle
- Owner: architect + Ali (raised the question)
- Maintains: this decision; the internal/domain vs internal/adapters
  boundary; the module-path confirmation
- Update triggers: SPEC.md §3 (capability/node composition) resolving off
  `OPEN`; a second JS package (`browser-extension/`, SPEC.md §5) actually
  getting scaffolded (triggers re-opening the workspaces question, D above);
  the module's hosted path changing after confirmation
- Last reviewed: 2026-08-06
- Review interval: 30 days while `proposed`; 365 days once `accepted`
