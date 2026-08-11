# Mill

Wails3 desktop app: Go backend + React/TypeScript/Vite frontend, compiled to a
single binary. Will become a guardrailed agentic-workflow/automation tool.
Full context, positioning, and open architecture questions live in
@docs/SPEC.md — read it before making any design decision, and update it as
decisions land. Do not treat this CLAUDE.md as a substitute for it.

## Model economics: expensive models orchestrate, cheap models toil

When the session runs on Fable or Opus, that model's job is design,
research synthesis, architecture, review, and decisions — never the
toiling work. Bulk/mechanical work gets delegated to a subagent on a
cheaper model, picked by complexity: **Haiku** for read-only volume
(codebase exploration, log/grep sweeps, doc lookups — `explorer` in
`.claude/agents/`), **Sonnet** for well-specified mechanical
implementation and verification runs (suite runs via
`test-investigator`, bounded refactors/migrations executed from a
written plan). Two hard rules: every `Agent` delegation states its
model explicitly — never rely on inheritance, which silently runs the
subagent on the expensive parent model — and the delegated task must
be *fixed and bounded* (a written brief with objective gates), because
subagents start cold and can't make the judgment calls the orchestrator
context holds. If a task can't be specified tightly enough for Sonnet
to execute against objective checks, that's a sign it's still
design work — do it in the main session, don't delegate it.

## Goal backlog: `docs/goals/BACKLOG.md` is the delivery queue

Requirements live in `docs/SPEC.md`; the committed, hand-reorderable
priority queue of goals lives in `docs/goals/BACKLOG.md` (top item =
next; UX/frontend-first is the standing tiebreak). Starting a session
without an explicit goal from the user: take the top unchecked goal,
read its goal file, follow Research → Plan → Implement. A delivered
goal's file moves to `docs/goals/archive/` in the same commit that
completes it. Adopted as a pattern, not a tool — researched
(spec-kit/task-master/OpenSpec/BMAD all rejected with reasons recorded
in BACKLOG.md's own header).

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

**Deliver through short-lived branches + a PR per goal; push at least
once per session — never let unpushed work accumulate**
([ADR-0034](docs/adr/0034-git-ci-operating-model.md), owner-ratified
after this repo's own CI history demonstrated the ignored-pipeline
failure). `main` is ruleset-protected: direct pushes are blocked (even
for the owner — bypass is "for pull requests only"), the CI checks are
required, and a green PR self-merges without waiting on anyone. So: a
goal's work lands as ONE self-merged PR when its scope completes
(quick out-of-goal fixes ride the next goal's PR or a small dedicated
one); worktree/agent branches live only as long as their one task,
then merge and delete. Required checks can't gate a direct push at all
(GitHub evaluates a SHA's already-recorded status, never runs checks
at push time) — the PR flow is what makes green-before-main real, not
review ceremony.

If `docs/SPEC.md` marks something `OPEN`, do not silently resolve it by
implementing one option — surface the choice.

**Goal-driven sessions finish their bounded scope, then hand off — never
defer scope that was already in-goal.** When working an explicit goal
(via `/goal` or an equivalent bounded scope handed to a session), finish
everything inside that scope before ending the session. Re-priming a
fresh session with this project's full context (`docs/SPEC.md`, the
relevant ADRs, `.claude/rules/`) has a real, repeated cost — pushing
already-scoped, bounded work to "a future session" multiplies that cost
for no reason and is not a legitimate way to end a session early. A
session-ending handoff exists to record what shipped and to name
anything genuinely outside the goal's scope, blocked on the user, or
newly discovered mid-session — never to paper over in-goal work that
simply didn't get finished. If a goal turns out to be too large for one
session, say so and ask before starting, not after ending partially
done.

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

**How to run Mill — the default is `task dev`, started once and left
running.** This is the single source of truth for launching, settled
during live testing (the reinstall-every-change loop was the wrong
default):

- **`task dev`** — THE way to run and iterate. Hot reload: **start it
  once and leave it running.** Frontend edits (`frontend/src/**`) are
  instant Vite HMR in the live window — no rebuild, no reinstall. Only a
  Go change restarts the app, and only a change to a *bound Go method
  signature* re-pays the ~20s `wails3 generate bindings` (Task skips it
  otherwise). It no longer wipes `bin/` (that just forced a slow relink
  for nothing — reverted this session). **Confirm you're on the live
  build by the green `DEV · live` badge** (top-left); anything else
  (`INSTALLED · <commit>` / `SERVER · <commit>`) is NOT the live build.
  PATH note: `wails3` (and `ls_lint`, used by the pre-commit hook) live
  in `~/go/bin` — put `export PATH="$HOME/go/bin:$PATH"` in your shell
  profile once, or prefix commands with `PATH="$HOME/go/bin:$PATH"`.
- **`task install:app`** — build + install the real `.app` to
  `/Applications` (one correct command: fresh frontend → clean bundle →
  clean-replace → verifies the embedded commit == HEAD). Use ONLY when
  you need the installed app specifically: Accessibility-gated hotkeys,
  the native menu, launch/Spotlight behaviour. NOT for normal iteration
  — that's `task dev`. Never run it while `task dev` is running (two Mill
  processes would share the same data files).
- `task setup:hooks` — run once after cloning: installs Lefthook's
  pre-commit hooks (lint/vet/build, mirrors CI). Requires `brew install
  lefthook golangci-lint` and `go install
  github.com/loeffel-io/ls-lint/v2/cmd/ls_lint@v2.3.1` first.
- `task build` / `task package` — production binary / `.app` bundle to
  `bin/` (both still `clean` first). `task clean` — clears `bin/`.
- `wails3 dev` / `wails3 build` — the underlying Wails3 CLI these targets
  wrap; see `Taskfile.yml` and `build/Taskfile.yml`.

## Project layout

- `main.go` — the only root Go file: embeds, window/tray setup, service
  construction + wiring. Wails-bound services live in per-bounded-context
  packages under `internal/services/<ctx>svc` (e.g. `compositionsvc`,
  `triggersvc`), with shared helpers in `internal/services/{seeding,servicetest}`.
- `frontend/` — React + TypeScript + Vite UI.
- `docs/SPEC.md` — living concept doc, rendered inside the app itself (Spec
  view). Source of truth for positioning and architecture status
  (`LOCKED` / `OPEN` / `PARKED`).
- `.claude/rules/` — coding conventions, split by topic/language
  (`frontend.md`, `backend.md`, `architecture.md`) rather than piled
  into this file; skills and agent profiles as they get added (see
  `docs/SPEC.md` §9 for the current roadmap).
