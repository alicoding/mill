#!/usr/bin/env bash
# Probes check-selftest-git-isolation.sh (goal 0394) against a bad and a
# good fixture script, then re-proves the underlying isolation itself
# (the Acceptance assertion): a git_fixture_init call made under the
# exact hostile environment a pre-commit hook exports for the repo being
# committed must leave that real checkout's `git status --porcelain`
# byte-identical before and after -- the class this goal exists to catch
# (a flipped core.bare, ~7000 staged deletions on the real index).
set -euo pipefail
source "$(dirname "$0")/lib/git-fixture.sh"

gate="$(cd "$(dirname "$0")" && pwd)/check-selftest-git-isolation.sh"
fails=0

# probe <expected-exit> <label> <dir>
probe() {
  local want="$1" label="$2" dir="$3" got
  set +e
  ( cd "$dir" && bash "$gate" >/dev/null 2>&1 )
  got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label" >&2
    fails=$((fails + 1))
  fi
}

bad="$(mktemp -d)"
git_fixture_init "$bad"
mkdir -p "$bad/scripts"
cat >"$bad/scripts/check-fixture-bad.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
dir="$1"
git -C "$dir" init -q
EOF
git_fixture_commit_all "$bad" "bad fixture"
probe 1 "a fixture-creating script that never sources the helper fails" "$bad"

good="$(mktemp -d)"
git_fixture_init "$good"
mkdir -p "$good/scripts"
cat >"$good/scripts/check-fixture-good.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/git-fixture.sh"
git_fixture_init "$1"
EOF
git_fixture_commit_all "$good" "good fixture"
probe 0 "a fixture-creating script that sources the helper passes" "$good"

allowed="$(mktemp -d)"
git_fixture_init "$allowed"
mkdir -p "$allowed/scripts"
cat >"$allowed/scripts/check-fixture-allowed.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
dir="$1"
git -C "$dir" init -q  # git-isolation:allow -- reasoned, hand-audited bare call
EOF
git_fixture_commit_all "$allowed" "allowed fixture"
probe 0 "a bare call carrying a reasoned git-isolation:allow passes" "$allowed"

rm -rf "$bad" "$good" "$allowed"

# --- end-to-end: git_fixture_init must not touch the REAL checkout even
# when invoked with the exact hostile environment a pre-commit hook
# exports for it (goal 0394's Acceptance).
real_root="$(git rev-parse --show-toplevel)"
real_git_dir="$(git rev-parse --absolute-git-dir)"
real_index="$(git rev-parse --git-path index)"
before="$(cd "$real_root" && git status --porcelain)"

probe_dir="$(mktemp -d)"
(
  export GIT_DIR="$real_git_dir"
  export GIT_WORK_TREE="$real_root"
  export GIT_INDEX_FILE="$real_index"
  git_fixture_init "$probe_dir"
  echo "probe content" >"$probe_dir/file.txt"
  git_fixture_commit_all "$probe_dir" "isolation probe"
)
rm -rf "$probe_dir"

after="$(cd "$real_root" && git status --porcelain)"

if [ "$before" != "$after" ]; then
  echo "FAIL: the real checkout's git status changed around an isolated fixture probe run under a hostile GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE" >&2
  echo "--- before ---" >&2
  echo "$before" >&2
  echo "--- after ---" >&2
  echo "$after" >&2
  fails=$((fails + 1))
fi

if [ "$fails" -ne 0 ]; then
  echo "check-selftest-git-isolation-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-selftest-git-isolation-selftest: OK"
