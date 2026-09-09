---
name: build-brief
description: Execute a dispatch brief on the GitHub Actions runner that `claude-build.yml` starts -- the standard builder operational block, but the workflow's checkout IS the worktree. Invoked as `/build-brief <brief body>` by that workflow's automation-mode prompt; never invoke it by hand against a checkout the orchestrator or another agent owns.
---

# Running a brief on a runner

This skill runs the SAME contract a local worktree builder follows
(CLAUDE.md's orchestrator/builder model, `.claude/rules/*.md`,
`.claude/skills/brief/divergences.md`) with one substitution: there is
no separate worktree to create, because `claude-build.yml`'s checkout
already sits on the brief's fresh branch (`git checkout -b "$BRANCH"`,
run before this skill starts) inside a runner nothing else is using.
Never a second review or merge path -- the reviewer subagent, the PR's
`## Review` section, and CI's `ci-gate` stay the authority exactly as
they are for a local builder.

## Input

The brief's BODY text arrives as this skill's argument (the text after
`/build-brief ` in the prompt) -- never a `docs/goals/briefs/<n>.md`
path. `docs/goals/` is git-ignored and local-only (it carries the
owner's verbatim words and work context); a runner checkout never has
it, so a path argument here is always a defect in the dispatch, not
something to work around by inventing content.

Two more values ride in the job's environment, set by the workflow
from its own inputs (read them with the Bash tool, e.g. `echo
"$BRANCH"` -- they are not part of the prompt text):
- `$BRANCH` -- already checked out; never create or switch to a
  different branch.
- `$ARM_AUTO_MERGE` -- `"true"` or `"false"`; gates the auto-merge step
  below.

## Steps

1. **Load the rules.** Read every file under `.claude/rules/*.md` and
   `.claude/skills/brief/divergences.md` before touching code -- same
   requirement as any builder brief.
2. **Ground-truth the brief.** For every file:line the brief cites,
   read that file at that location before trusting the citation; a
   brief's claim about the code is a hypothesis, not a fact.
3. **Implement** exactly the brief's design contract. A design question
   the brief does not answer is reported in this run's final message,
   never decided here -- stop short of the undecided part and finish
   whatever the brief DID fully specify.
4. **Run the brief's own gates.** Lefthook is not installed on this
   runner -- run the exact `scripts/check-*.sh` commands, `go test`,
   `npm run test` (Vitest), and `npx playwright test` invocations the
   brief names, directly, the same way lefthook would have run them
   locally. A gate this runner cannot execute (a manual-only check) is
   named as skipped in the final report, never silently omitted.
   CI's `ci-gate` on the opened PR is still the authority these local
   runs are rehearsing, not replacing.
5. **Dispatch the `reviewer` subagent** (the `Agent` tool, same as a
   local builder) on `git diff origin/main...HEAD` against the brief
   text. Fix every Important finding before opening the PR.
6. **Commit** with the standard trailers:
   ```
   Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
   ```
   Add a `Claude-Session:` trailer only if this run's own session URL
   is available in the environment; omit the line rather than
   fabricate one.
7. **Push `$BRANCH`** and open the PR (`gh pr create`, `$GH_TOKEN` is
   already set) with:
   - Title from the brief's `## PR` section.
   - Body ending in the standard footer:
     ```
     🤖 Generated with [Claude Code](https://claude.com/claude-code)
     ```
   - A `## Review` section holding the reviewer's report in the gate's
     required shape: a `Nit — ` / `Important — ` / `Nothing to report`
     line per finding, `Contract match: yes`, and the exact line
     `Important findings open: 0`. `scripts/check-review-report.sh`
     enforces this shape as CI's `review-report` job; get it right
     before opening, not after a rejection.
8. **Arm auto-merge only when `$ARM_AUTO_MERGE` is `"true"`**:
   `gh pr merge --auto --squash <n>`. When it is `"false"`, leave the
   PR open and say so in the final report -- never merge and never
   silently skip stating which happened.
9. **Report as this run's final message** (there is no orchestrator
   session reading files back from this runner): the PR URL and
   `gh pr view <n> --json number,state` output, the gate outputs from
   step 4, the reviewer's findings, and the auto-merge decision from
   step 8. This message is the only artifact the dispatcher sees.

## Dispatching this workflow

```
gh workflow run claude-build.yml --repo millhq/mill \
  -f branch=goal/<n>-<slug> \
  -f brief="$(cat brief.txt)" \
  -f arm_auto_merge=true
```

`brief.txt` holds the brief BODY only. It must never contain
owner-verbatim or internal work-context text -- `docs/goals/` is
local-only precisely because that material never leaves this machine;
a brief bound for this workflow is written clean of it from the start,
not redacted after the fact.

`workflow_dispatch` requires `claude-build.yml` to already exist on the
ref it runs against; with no `--ref` given it dispatches against the
repository's default branch. Add `--ref <branch>` to run it from a
branch that has not merged yet (how this workflow proves itself before
its own PR merges to `main`):
```
gh workflow run claude-build.yml --repo millhq/mill \
  --ref <branch-with-this-file> \
  -f branch=goal/<n>-<slug> -f brief="$(cat brief.txt)"
```

Poll the result with `gh run list --repo millhq/mill --workflow
claude-build.yml -L 1`, not by watching -- runs take minutes, not
seconds.
