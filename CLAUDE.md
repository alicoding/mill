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
   record the decision in `docs/SPEC.md` under the relevant section.
3. **Implement** — only after 1 and 2. Small, reviewable steps.

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
- **SOLID, DRY, DDD discipline** — proper domain/class separation as real
  domain logic lands. The current scaffold (`main.go`, `greetservice.go`,
  `specservice.go`, `frontend/`) is intentionally trivial; do not
  over-engineer it prematurely, but do not bolt unrelated concerns onto it
  either once real capabilities start landing.
- **UI: use Primer React (`@primer/react` + `@primer/primitives`), don't
  hand-roll bespoke components or CSS.** Verified MIT-licensed, pure JS/TS
  (no native/Rust dependency anywhere in its tree), actively maintained.
  Ships finished, pre-styled components — import and use them, don't
  reassemble primitives from scratch the way shadcn-style kits require.
  The current bespoke "Neon-night" CSS custom properties in
  `frontend/public/style.css` predate this decision and are a known
  migration debt, not the standard going forward — new UI work should use
  Primer components and its design tokens (`@primer/primitives`), not add
  more bespoke CSS.

## Build / dev commands

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
