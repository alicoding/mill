#!/usr/bin/env bash
# Enforces goal 0394: a script that creates a throwaway git repo (`git
# init`, or `git -C` against a fixture directory) sources
# scripts/lib/git-fixture.sh, whose git_fixture_init clears the calling
# process's local git environment before touching the fixture. A
# git-commit-invoked pre-commit hook (unlike a bare `lefthook run`)
# exports GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE for the repo being
# committed; those variables override every un-isolated `git -C
# <fixturedir>` call, redirecting it at the REAL repo instead of the
# fixture (goal 0394's Why: a flipped core.bare, ~7000 staged deletions
# on the real index -- twice). A line that legitimately needs a bare
# git call carries `git-isolation:allow -- <reason>` on the same line.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

violations=0

while IFS= read -r -d '' file; do
  case "$file" in
    scripts/lib/git-fixture.sh) continue ;;  # the helper itself, not a fixture-creating selftest
  esac
  sources_helper=false
  if grep -qE 'source[[:space:]].*lib/git-fixture\.sh' "$file"; then
    sources_helper=true
  fi
  while IFS=: read -r line_no line; do
    [ -n "$line_no" ] || continue
    case "$line" in
      *git-isolation:allow*) continue ;;
    esac
    if [ "$sources_helper" = true ]; then
      continue
    fi
    echo "check-selftest-git-isolation: $file:$line_no: creates/touches a git fixture without sourcing scripts/lib/git-fixture.sh -- a hook-invoked commit inherits GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE and this call would touch the REAL repo instead of the fixture; source the helper (git_fixture_init/git_fixture_commit_all), or carry 'git-isolation:allow -- <reason>' on this line"
    violations=$((violations + 1))
  done < <(grep -nE 'git init|git -C ' "$file" || true)  # git-isolation:allow -- this line IS the detection pattern, not a fixture creator
done < <(git ls-files -z -- 'scripts/*.sh')

if ((violations > 0)); then
  echo "error: $violations selftest git-isolation violation(s) -- see scripts/lib/git-fixture.sh and .claude/rules/testing.md." >&2
  exit 1
fi

echo "check-selftest-git-isolation: no violations"
