#!/usr/bin/env bash
# Sourced by any scripts/*.sh selftest that builds a throwaway git repo
# under mktemp. A git-commit-invoked pre-commit hook (unlike a bare
# `lefthook run`) exports GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE and the
# rest of git's own local-repo environment for the repo being committed;
# those variables override every nested git subcommand's `-C <dir>`,
# redirecting init/add/commit at the REAL repo instead of the fixture
# (goal 0394: this bit twice -- a flipped core.bare and ~7000 staged
# deletions on the real index). `git help hooks`' own "Environment
# Variables" section names the fix: `unset $(git rev-parse
# --local-env-vars)` before any nested git call in a different
# repository -- the list is git's own, so it tracks new variables a
# future git version adds without this file changing.
set -euo pipefail

# git_fixture_init <dir> -- clears the calling process's local git
# environment, then initializes <dir> as its own throwaway repo with a
# committer identity and hooks disabled, so a fixture commit can never
# re-trigger this repository's own hooks.
git_fixture_init() {
  local dir="$1" local_env_vars var
  local_env_vars="$(git rev-parse --local-env-vars 2>/dev/null || true)"
  for var in $local_env_vars; do
    unset "$var"
  done
  mkdir -p "$dir"
  git -C "$dir" init -q -b main
  git -C "$dir" config user.name "Fixture"
  git -C "$dir" config user.email "fixture@example.invalid"
  git -C "$dir" config core.hooksPath /dev/null
  git -C "$dir" config commit.gpgsign false
}

# git_fixture_commit_all <dir> <msg> -- stages everything under <dir> and
# commits it to the fixture repo a prior git_fixture_init call created.
git_fixture_commit_all() {
  local dir="$1" msg="$2"
  git -C "$dir" add -A
  git -C "$dir" commit -q -m "$msg"
}
