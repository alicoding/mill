# Mill

Wails3 desktop app: Go backend + React/TypeScript/Vite frontend, compiled to a
single binary. Will become a guardrailed agentic-workflow/automation tool.
Full context, positioning, and open architecture questions live in
`docs/SPEC.md` — read the relevant sections before any design decision, and
update it as decisions land. Do not treat this CLAUDE.md as a substitute for
it. (Backticked pointer, not an `@`-import: an `@`-import eagerly loads the
whole file into every session's context — see SPEC §9.1.)

## The orchestrator owns the app; delegation must earn its keep

Owner-ratified 2026-08-29, superseding the earlier economics-first
framing ("expensive models orchestrate, cheap models toil"): too many
app decisions had drifted to subagents, and the felt quality showed it
— agent-built surfaces repeatedly needed orchestrator eyes-on-code to
find the layers a report never surfaces (goal 0248's trail is the
worked case: the core surgery was right, and the dead typography, the
async focus strip, and the shared-board test leak underneath were all
found only by reading the diff and probing the live build). The
operational law:

1. **Anything the user feels, the orchestrator authors or line-reviews
   itself** — interaction behavior, CSS/typography, UX states, copy,
   component structure. Review means reading the diff, running it
   live, and probing it — never accepting an agent's report as the
   evidence.
2. **Agents get only machine-verifiable mechanical scope** — regens,
   bounded migrations from a written spec, test runs, read-only
   research volume. If correctness can't be checked by a gate or a
   diff the orchestrator reads, it isn't delegated.
3. **No agent-authored user-facing change merges without the
   orchestrator's eyes-on-diff plus a live hands-on pass.** The
   design contract stays in the brief as before; this adds the
   back half — the contract is verified by the contract's author.
4. **The economics tradeoff inverts for the app**: decision quality
   outranks orchestrator-token economy. Delegation is the exception
   that must earn its keep, not the default that must be argued out
   of.

Model picks when delegation IS warranted: **Haiku** for read-only
volume (codebase exploration, log/grep sweeps, doc lookups —
`explorer` in `.claude/agents/`), **Sonnet** for the mechanical scope
above (`test-investigator`, bounded refactors/migrations from a
written plan). Every `Agent` delegation states its model explicitly —
never rely on inheritance. The delegated task must be *fixed and
bounded* (a written brief with objective gates); if it can't be
specified that tightly, it's the orchestrator's own work.

**Every dispatched BUILD agent works in its own git worktree; the main
checkout belongs to the orchestrator.** State it in the brief. Before ANY
git write or build in the main checkout, check `git branch --show-current`
and `git status` — if it is not main or the tree is dirty, an agent owns it;
deploy instead by building from a throwaway worktree at origin/main.

**Concurrent dispatch is the default; serialization must earn its keep
(goal 0200).** Claude Code's own docs make worktree-isolated parallel
sessions the standard workflow and file-ownership partitioning the
conflict strategy; they are silent on machine resources, so that cap is
Mill's own. Three constraints, three rules — never one blanket
serialization:
- **Touch-sets, not turns.** The brief's design contract already
  predicts each build's touch-set; dispatch concurrently whenever
  predicted sets are disjoint outside the known hub files (generated
  `frontend/bindings/**`, shared Atlas chrome). Dependent slices of one
  arc sequence as dependencies, not policy. Measured on the 7-PR arc
  #392–#404: 15 of 21 pairs disjoint outside hubs; 5 of the 6 overlaps
  were same-arc dependent slices.
- **Hub files get a merge strategy, not a mutex.** Bindings conflicts
  resolve by regenerating on rebase (`wails3 generate bindings`), never
  hand-merged; 0180's per-noun registration removed the other fixable
  hub. Single-file brushes are rebase-trivial — the pr-shepherd handles
  them.
- **A verification lock, not a build lock.** Agents author in parallel;
  heavy gates (Playwright e2e, `go test -race`) run ONE suite at a time
  on this 16GB machine — the documented freeze was stacked gate suites,
  never parallel authoring. Cap 2–3 concurrent build agents; pause
  dispatches under ~2GB free.
- **The nested docs repo stays effectively single-writer** — the
  staging rule below governs it.
Merge ordering stays auto-merge + shepherd rebase. GitHub's merge queue
is available (public repo) but not adopted — revisit if two
individually-green PRs ever combine red on main.

**In the nested docs repo, stage only the files you changed — never
`git add -A` there.** Worktrees isolate the mill checkout but not the nested
`docs/` repo: it lives at one physical path every concurrently-running agent
shares, so a blanket stage sweeps in other agents' in-flight edits. Commit
docs promptly after writing them rather than leaving them uncommitted across
a long build.

**Design/UX/spec contracts are the orchestrator's own work-product — never
delegated.** Before dispatching any user-facing surface, the orchestrator
writes the design contract INTO the brief: what renders where and in what
hierarchy, what each click/keystroke does, every label/empty-state's copy,
and what changes visibly on each state transition. The agent's discretion is
implementation (code structure, test mechanics) — never what the user sees.
A design question surfacing mid-build gets reported back, not decided by the
agent.

## Upgrade the ground before building on it

Before a feature goal enters a session, ask what its subsystem costs to
EXTEND today. If the answer is "a lot," the upgrade goal goes in front of it
in the queue — as the first slice of the feature's own arc, not a separate
initiative. Measure it (goals 0163, 0169 have the repeatable shape): count
the files/lines the newest similar addition actually cost, and how many
separate hand-maintained places had to learn the new thing exists. Test:
would the next three additions each pay this cost again? If yes, upgrade
first, and prove it by migrating the EXISTING items onto it before any new
one is added (old tests must pass unmodified). If no, build the feature
directly and record why the upgrade wasn't needed.

## Goal backlog: `docs/goals/BACKLOG.md` is the delivery queue

Requirements live in `docs/SPEC.md`; the committed, hand-reorderable
priority queue of goals lives in `docs/goals/BACKLOG.md` (top item = next;
UX/frontend-first is the standing tiebreak). Starting a session without an
explicit goal: take the top unchecked goal, read its goal file, follow
Research → Plan → Implement. Work discovered mid-session that outlives the
session gets a goal file and a queue position before the session ends — an
ephemeral session task list is working memory, never the record.

**Mirror the active queue into the session task list** — the terminal's
task panel is the owner's live window into an autonomous session;
scrollback is not visibility. TaskCreate one task per in-flight/queued
backlog item, blocker-chained in queue order. Status contract:
- `in_progress` — being actively worked THIS turn, by the session or a
  dispatched agent. Nothing else.
- `pending` — queued, OR blocked on the owner. When blocked, the subject
  SAYS SO ("BLOCKED ON OWNER: ...") so the board distinguishes waiting from
  queued at a glance.
- `completed` — shipped or closed, with the OUTCOME in the subject, not the
  intention. A task closed with a stale subject is a lie that outlives the
  work.

The task list is visibility, never the record: `docs/goals/BACKLOG.md`
stays the truth.

**Before starting an ad-hoc request that isn't the queue's current top
item, name in one sentence where it lands against `docs/goals/BACKLOG.md`**:
it supersedes/reorders the queue, merges into an existing goal, becomes a
new goal, or is a below-goal-granularity fix riding the next PR with no
goal file. No separate triage step or log — the sentence in the response IS
the record. (A `UserPromptSubmit` hook in `.claude/settings.json`
resurfaces this just-in-time.)

**With a ratified queue, sessions self-drive.** Finish a goal (or hit a
real block), pull the next queue item, work it under the orchestrator-owns-the-app
rules above, continue — never idle awaiting a go-ahead the queue already gave.
Stop for the owner ONLY when: it costs money, it is irreversible, it is
a SPEC `OPEN` item, or it is a pure taste/product call with no
defensible industry precedent to research against. Everything else
proceeds — including publishing, which is no longer a gate
(owner-granted 2026-08-23: "ask only when it costs money"). Still never
granted: force-push and history rewrites. Owner check-ins are progress
reports, not permission gates. A delivered goal's file moves to
`docs/goals/archive/` in the same commit that completes it.

**Releases are held until v1** (owner-decided 2026-08-23). Beta builds
publish on every merge and in-app updates work from them, so nothing in
development needs a tagged release; the stable channel only matters once
someone other than the owner downloads Mill. Leave release-please's PR
open and unmerged — it keeps updating itself into a live changelog
draft, which is useful, and closing it only invites recreation. Revisit
when the owner calls v1.

## Working method: Research → Plan → Implement

Every non-trivial change follows this order, no exceptions:

1. **Research** — before writing code for a new capability, check whether
   something already solves it: an existing library, a standard protocol, a
   pattern already named in `docs/SPEC.md`. **Research → Adopt → Compose**
   (`.claude/rules/architecture.md` has the full statement). A claim of
   "nothing exists for X" must be backed by an actual search (WebSearch,
   package registry, docs), not an assumption.
2. **Plan** — state the approach and its tradeoffs before editing files.
   For any design choice with more than one defensible answer (schema
   shape, module boundary, protocol), write it up before committing to it,
   and record the decision in `docs/SPEC.md` under the relevant section.
   When the decision is a data schema or an adopt-vs-build call for a
   capability with more than one real future use, build an explicit
   capability map first: every known future use, whether it's something to
   adopt or something that must stay Mill's own, and its current status.
   See `docs/SPEC.md` §3.3 for the worked example.
3. **Implement** — only after 1 and 2. Small, reviewable steps.

**Commit every verified change, always — don't wait to be asked.** Once a
change passes the full local check suite (lint/vet/test/build), commit it;
never leave the working tree dirty or a completed, verified change sitting
staged-but-uncommitted at the end of a turn. Write a real commit message
(not a placeholder), double-check staged content doesn't include anything
secret-shaped, and never force-push, amend a previous commit, or rewrite
history without being explicitly asked. (Force-push and
filter-branch/filter-repo are hook-denied outright —
`scripts/hook-command-guard.sh`, which also denies `pkill -f`/`killall`;
amend/rebase stay judgement since "explicitly asked" is legal.)

**Deliver through short-lived branches + a PR per goal; push at least once
per session — never let unpushed work accumulate**
([ADR-0034](docs/adr/0034-git-ci-operating-model.md)). `main` is
ruleset-protected: direct pushes are blocked (even for the owner), CI
checks are required, and a green PR self-merges without waiting on anyone.
A goal's work lands as ONE self-merged PR when its scope completes (quick
out-of-goal fixes ride the next goal's PR or a small dedicated one);
worktree/agent branches live only as long as their one task, then merge
and delete.

If `docs/SPEC.md` marks something `OPEN`, do not silently resolve it by
implementing one option — surface the choice.

**Goal-driven sessions finish their bounded scope, then hand off — never
defer scope that was already in-goal.** Re-priming a fresh session with
this project's full context has a real, repeated cost — pushing
already-scoped, bounded work to "a future session" multiplies that cost for
no reason. If a goal turns out to be too large for one session, say so and
ask before starting, not after ending partially done.

## Hard constraints (non-negotiable — see `docs/SPEC.md` §1.1 for the why)

Product-level, always in effect regardless of what file is being touched.
Coding conventions live in `.claude/rules/` instead (see `docs/SPEC.md`
§9.1 for that split's rationale).

- **No Rust** anywhere in the toolchain or dependency tree.
- **No AI API calls from Mill itself, and no phone-home telemetry of any
  kind.** Mill mediates/guards actions initiated by other systems — it is
  not an LLM client. Zero outbound network calls that aren't explicitly
  initiated by the user via a user-configured connector.
- **Single binary, no separate CLI/backend split.** Wails3 already
  satisfies this — don't introduce a second deployable.
- **Install story is `git clone` + documented local build.** No
  hosted-service dependency for the core loop.
- **CI/CD from day one**, not bolted on later. Every capability that lands
  needs its checks wired in the same change.
- **SPEC.md tracks every capability from day one, not bolted on later.**
  Every capability/feature that lands gets a corresponding `docs/SPEC.md`
  entry in the same change — a new bullet or a status update
  (`LOCKED`/`OPEN`/`PARKED`, plus `UX: PROTOTYPE`/`FINAL` where a UI
  exists) — not a follow-up. Skip only for pure mechanical changes
  (refactors, dependency bumps, behavior-neutral bug fixes). If it isn't in
  SPEC.md, treat it as undocumented, not done.

## Build / dev commands

- **`task dev`** — THE way to run and iterate. Hot reload: start it once
  and leave it running. Frontend edits (`frontend/src/**`) are instant Vite
  HMR — no rebuild, no reinstall. Only a Go change restarts the app, and
  only a change to a *bound Go method signature* re-pays the ~20s `wails3
  generate bindings`. Confirm you're on the live build by the green `DEV ·
  live` badge (top-left); anything else is NOT the live build. PATH note:
  `wails3` (and `ls_lint`, used by the pre-commit hook) live in `~/go/bin`.
- **`task install:app`** — build + install the real `.app` to
  `/Applications`. Use ONLY when you need the installed app specifically:
  Accessibility-gated hotkeys, the native menu, launch/Spotlight behaviour.
  NOT for normal iteration — that's `task dev`. Never run it while `task
  dev` is running (two Mill processes would share the same data files).
- `task setup:hooks` — run once after cloning: installs Lefthook's
  pre-commit hooks (lint/vet/build, mirrors CI). Requires `brew install
  lefthook golangci-lint` and `go install
  github.com/loeffel-io/ls-lint/v2/cmd/ls_lint@v2.3.1` first.
- `task build` / `task package` — production binary / `.app` bundle to
  `bin/` (both `clean` first). `task clean` clears `bin/`.
- `wails3 dev` / `wails3 build` — the underlying Wails3 CLI these targets
  wrap; see `Taskfile.yml` and `build/Taskfile.yml`.

## Project layout

- `main.go` — the only root Go file: embeds, window/tray setup, service
  construction + wiring. Wails-bound services live in per-bounded-context
  packages under `internal/services/<ctx>svc`, with shared helpers in
  `internal/services/{seeding,servicetest}`.
- `frontend/` — React + TypeScript + Vite UI.
- `docs/SPEC.md` — living concept doc, rendered inside the app itself (Spec
  view). Source of truth for positioning and architecture status
  (`LOCKED` / `OPEN` / `PARKED`).
- `.claude/rules/` — coding conventions, split by topic/language
  (`frontend.md`, `backend.md`, `architecture.md`) rather than piled into
  this file; skills and agent profiles as they get added (see
  `docs/SPEC.md` §9 for the current roadmap).
