#!/usr/bin/env bash
# Probes check-agent-definitions.sh (goal 0414 S1/S2/S3) against a
# throwaway git fixture tree, so an edit to the gate cannot silently
# stop catching a dropped sentinel or start rejecting a well-formed
# definition. The gate itself resolves paths off `git rev-parse
# --show-toplevel`, so each probe needs its own tiny git repo (init is
# enough; no commit required) rather than a bare fixture directory --
# same shape as review-report-selftest.
set -euo pipefail
# shellcheck source=lib/git-fixture.sh
source "$(dirname "$0")/lib/git-fixture.sh"

gate="$(cd "$(dirname "$0")" && pwd)/check-agent-definitions.sh"
fails=0

good_builder() {
  cat <<'EOF'
---
name: builder
description: fixture
tools: Read, Edit, Write, Bash, Grep, Glob, Agent
model: sonnet
maxTurns: 120
---

You build one goal's brief end to end. Own the PR to merge -- arm
auto-merge, then stop. A permission-blocked or classifier-blocked
action is reported to the orchestrator, never worked around by
another route. The only sub-agents you may spawn are reviewer,
explorer, research, and test-investigator. Never `fork`, never
`general-purpose`. A `pgrep -f <pattern>` search excludes the caller's
own shell. A worktree "busy" check names the holding process. The
dispatch's token ceiling is CUMULATIVE across resumes. At most two
resumes per brief. Write the drafted PR body to a file and run
scripts/check-review-report.sh against it, and do not call `gh pr
create` until it prints `review-report: ok`. Poll loops are forbidden
past this point: `timeout: 600000`.

## Checkpoint commits (mandatory)

The first commit on the goal branch happens the moment the build is
clean -- a `wip:` commit message is fine. A WIP checkpoint commit
happens every ~30 turns after that. At turn ~90 the pre-check pushes
the branch before anything else. A builder never ends a turn -- cap,
budget, or report -- with a dirty worktree on a goal branch.
EOF
}

good_reviewer() {
  cat <<'EOF'
---
name: reviewer
description: fixture
tools: Read, Grep, Glob, Bash
model: haiku
maxTurns: 40
---

`Bash` here is for read-only commands only.

## Report shape

```
## Review
Important — file.go:1
claim
Violates: rule
Fix: fix

Contract match: yes|no — why

Important findings open: <N>
```
EOF
}

# probe <expected-exit> <label> <basename> <content-fn>
probe() {
  local want="$1" label="$2" base="$3" content_fn="$4" root got
  root="$(mktemp -d)"
  git_fixture_init "$root"
  mkdir -p "$root/.claude/agents"
  "$content_fn" >"$root/.claude/agents/$base"
  set +e
  (cd "$root" && "$gate" >/dev/null 2>&1)
  got=$?
  set -e
  rm -rf "$root"
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label" >&2
    fails=$((fails + 1))
  fi
}

probe 0 "well-formed builder.md passes" builder.md good_builder
probe 0 "well-formed reviewer.md passes" reviewer.md good_reviewer

no_frontmatter() {
  echo "no frontmatter here"
}
probe 1 "builder.md missing frontmatter fails" builder.md no_frontmatter

no_subagent_restriction() {
  good_builder | grep -v 'only sub-agents you may spawn'
}
probe 1 "builder.md missing the read-only sub-agent allowlist fails" builder.md no_subagent_restriction

no_review_report_gate() {
  good_builder | grep -v 'check-review-report.sh'
}
probe 1 "builder.md missing the pre-PR check-review-report.sh call fails" builder.md no_review_report_gate

wrong_maxturns_builder() {
  good_builder | sed 's/maxTurns: 120/maxTurns: 60/'
}
probe 1 "builder.md with the wrong maxTurns for its size class fails" builder.md wrong_maxturns_builder

no_checkpoint_commit_rule() {
  good_builder | grep -v 'never ends a turn'
}
probe 1 "builder.md missing the checkpoint-commit rule fails" builder.md no_checkpoint_commit_rule

no_grammar_reviewer() {
  good_reviewer | grep -v '^## Review$'
}
probe 1 "reviewer.md missing the '## Review' template heading fails" reviewer.md no_grammar_reviewer

no_contract_match_reviewer() {
  good_reviewer | grep -v 'Contract match'
}
probe 1 "reviewer.md missing the Contract match line fails" reviewer.md no_contract_match_reviewer

if [ "$fails" -ne 0 ]; then
  echo "check-agent-definitions-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-agent-definitions-selftest: OK"
