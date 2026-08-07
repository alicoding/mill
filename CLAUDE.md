# Mill

Wails3 desktop app: Go backend + React/TypeScript/Vite frontend, compiled to a
single binary. Will become a guardrailed agentic-workflow/automation tool.
Full context, positioning, and open architecture questions live in
@docs/SPEC.md — read it before making any design decision, and update it as
decisions land. Do not treat this CLAUDE.md as a substitute for it.

## Working method: Research → Plan → Implement

Every non-trivial change follows this order, no exceptions:

1. **Research** — before writing code for a new capability, check whether
   something already solves it: an existing library, a standard protocol, a
   pattern already named in `docs/SPEC.md`. A claim of "nothing exists for
   X" must be backed by an actual search (WebSearch, package registry, docs),
   not an assumption. This project has already been burned once by NIH and
   inner-platform drift (see `docs/SPEC.md` §0) — do not repeat that failure.
2. **Plan** — state the approach and its tradeoffs before editing files.
   For any design choice with more than one defensible answer (schema shape,
   module boundary, protocol), write it up before committing to it, and
   record the decision in `docs/SPEC.md` under the relevant section. When
   the decision is a data schema or an adopt-vs-build call for a capability
   with more than one real future use — not just today's immediate use
   case — build an explicit capability map first: every known future use,
   whether it's something to adopt or something that must stay Mill's own,
   and its current status. Deciding from today's narrowest use case alone
   is exactly how a point solution gets built (`docs/SPEC.md` §0); the map
   is what prevents that without requiring the full capability to be built
   up front. See `docs/SPEC.md` §3.3 for the worked example.
3. **Implement** — only after 1 and 2. Small, reviewable steps.

**Commit every verified change, always — don't wait to be asked.** Once
a change passes the full local check suite (lint/vet/test/build), commit
it; never leave the working tree dirty or a completed, verified change
sitting staged-but-uncommitted at the end of a turn. This overrides the
general default of asking before committing — for this repo specifically,
committing is the expected default, not an action that needs standing
permission each time. Still applies regardless: write a real commit
message (not a placeholder), double-check staged content doesn't include
anything secret-shaped, and never force-push, amend a previous commit, or
rewrite history without being explicitly asked — this rule covers regular
commits, not destructive git operations.

If `docs/SPEC.md` marks something `OPEN`, do not silently resolve it by
implementing one option — surface the choice.

## Hard constraints (non-negotiable — see `docs/SPEC.md` §1.1 for the why)

- **No Rust** anywhere in the toolchain or dependency tree.
- **No AI API calls from Mill itself, and no phone-home telemetry of any
  kind.** Mill mediates/guards actions initiated by other systems (an agent
  CLI, a chat client) — it is not an LLM client. Zero outbound network calls
  that aren't explicitly initiated by the user via a user-configured
  connector.
- **Single binary, no separate CLI/backend split.** Wails3 already satisfies
  this — don't introduce a second deployable.
- **Install story is `git clone` + documented local build.** No hosted-service
  dependency for the core loop.
- **CI/CD from day one**, not bolted on later. Every capability that lands
  needs its checks wired in the same change, not a follow-up.
- **SPEC.md tracks every capability from day one, not bolted on later.**
  Every capability/feature that lands gets a corresponding `docs/SPEC.md`
  entry in the same change — a new bullet under the relevant section, or a
  status update to an existing one (`LOCKED`/`OPEN`/`PARKED`, plus
  `UX: PROTOTYPE`/`FINAL` where a UI exists) — not a follow-up. Skip this
  only for pure mechanical changes (refactors, dependency bumps, bug fixes
  with no behavior change) that don't shift what SPEC.md actually
  describes. If it isn't in SPEC.md, treat it as undocumented, not done.
- **SOLID, DRY, DDD discipline — with a concrete reuse boundary, not just a
  platitude.** Generic/commodity concerns (parsing, UI widgets, OS
  plumbing, wire protocols) are fine to buy via a well-vetted library —
  that's the "compose, don't reinvent" rule everywhere else in this doc.
  Mill's actual **core domain** — what a guardrail evaluates and why, the
  Capture → Process → Apply orchestration itself, the action/capability
  model and its composition rules, session-identity resolution across
  tab/agent/process — must stay hand-written, Mill's own code, never
  delegated to or reimplemented by a library, because no library has an
  opinion on it; it's the specific reason Mill exists. Keep commodity
  dependencies behind a clean interface at the domain boundary (ports/
  adapters) so swapping the underlying library later never means rewriting
  domain logic. The current scaffold (`main.go`, `greetservice.go`,
  `specservice.go`, `frontend/`) is intentionally trivial; do not
  over-engineer it prematurely, but do not bolt unrelated concerns onto it
  either once real capabilities start landing.
- **Default to adopting an existing library/platform over hand-rolling,
  even when hand-rolling would be smaller or have fewer dependencies.**
  The deciding question is "who owns and maintains this six months from
  now," not "which is leaner to write today." Mill effectively has one
  maintainer, and infrastructure-shaped code — durable execution,
  retry/backoff, checkpointing, queues, and similar — is exactly the
  kind of thing that looks small at first and quietly becomes an
  unbounded maintenance burden once hand-rolled. Prefer a well-vetted
  library that already has the target capability, accept its dependency
  weight as a real but bounded, one-time cost, and keep it behind a
  ports/adapters boundary so it stays swappable. Hand-roll only when no
  adopted option actually satisfies the hard constraints (single binary,
  no Rust, no phone-home) — never merely because it would be smaller.
- **UI: use Primer React (`@primer/react` + `@primer/primitives`), don't
  hand-roll bespoke components or CSS.** Verified MIT-licensed, pure JS/TS
  (no native/Rust dependency anywhere in its tree), actively maintained.
  Ships finished, pre-styled components — import and use them, don't
  reassemble primitives from scratch the way shadcn-style kits require.
  Where custom CSS is genuinely needed (layout Primer doesn't cover),
  write it as a co-located `*.module.css` file consuming Primer's design
  tokens (`@primer/primitives` CSS custom properties) — Primer React v38+
  itself dropped `styled-components`/`sx`/`Box` and directs adopters to
  CSS Modules + CSS variables instead, so this is the framework's own
  current guidance, not an invented preference (see `docs/SPEC.md` §1.3).
  Don't add a single global stylesheet or reach for Tailwind/CSS-in-JS.
- **Max 500 lines per hand-written source file (`.go`/`.ts`/`.tsx`).**
  Enforced by `scripts/check-loc.sh`, run by both Lefthook (pre-commit)
  and CI's `file-loc-limit` job, so it can't land un-caught either way. A
  file crossing the limit means a real seam got missed — split along it
  (e.g. one package, multiple files; one component, extracted
  sub-components/hooks), don't truncate arbitrarily or suppress the
  check. Generated Wails bindings (`frontend/bindings/`) and the vendored
  gomobile scaffold (`build/ios/`, `build/android/`) are exempt — Mill
  doesn't own their shape.
- **Domain packages (`internal/domain/*`) stay pure: types + validation/
  execution logic only, no persistence, no state.** Storage (a settings-
  store-backed JSON blob, in-memory state, CRUD) lives one layer up, in
  the root-package `*service.go` Wails-binding file that owns that
  domain's lifecycle (`compositionservice.go` for `composition`,
  `triggerservice.go` for `trigger`). Where one package's execution needs
  data another layer owns (e.g. a Decision node's connector lookup), wire
  it with an injected function var or a small interface (see
  `composition.SetConnectorLookup`, `CompositionService`'s `Syncer`), not
  a direct import of the owning service — keeps the domain package
  testable standalone and free of Wails-binding concerns.

## Build / dev commands

- `task setup:hooks` — run once after cloning: installs Lefthook's
  pre-commit hooks (lint/vet/build, mirrors CI). Requires `brew install
  lefthook golangci-lint` first.
- `task dev` — run the app in dev mode with hot reload (frontend + backend).
- `task build` — production build to `bin/`.
- `wails3 dev` / `wails3 build` — underlying Wails3 CLI these Taskfile targets
  wrap; see `Taskfile.yml` and `build/Taskfile.yml` for platform-specific
  variants.

## Project layout

- `main.go`, `*service.go` — Go backend, Wails3 app bindings.
- `frontend/` — React + TypeScript + Vite UI.
- `docs/SPEC.md` — living concept doc, rendered inside the app itself (Spec
  view). Source of truth for positioning and architecture status
  (`LOCKED` / `OPEN` / `PARKED`).
- `.claude/` — project-specific skills and agent profiles as they get added
  (see `docs/SPEC.md` §9 for the current roadmap).
