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

Product-level, always in effect regardless of what file is being
touched. Coding conventions (SOLID/DRY/DDD reuse boundary, adopt-vs-
hand-roll, the file-length limit, Go domain-layer purity, the Primer/UI
rule) live in `.claude/rules/` instead — loaded the same way, just
organized by topic/language rather than piled into this always-loaded
file. See `docs/SPEC.md` §9.1 for that split's own rationale.

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
  `docs/SPEC.md` is product decisions (what Mill is, and why) — keep
  coding-pattern reasoning (which library, which component, how a check
  is enforced) out of it; that belongs in `.claude/rules/` instead, per
  the split above.

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
- `.claude/rules/` — coding conventions, split by topic/language
  (`frontend.md`, `backend.md`, `architecture.md`) rather than piled
  into this file; skills and agent profiles as they get added (see
  `docs/SPEC.md` §9 for the current roadmap).
