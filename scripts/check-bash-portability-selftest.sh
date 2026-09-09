#!/usr/bin/env bash
# Probes check-bash-portability.sh (goal 0403 S2e) against throwaway git
# repos, so an edit to the gate cannot silently stop catching a bash-4
# construct in a script CI would run under bash 3.2 -- same
# probe-on-touch shape as check-framework-api-first-selftest.sh.
set -euo pipefail
# shellcheck source=lib/git-fixture.sh
source "$(dirname "$0")/lib/git-fixture.sh"

gate="$(cd "$(dirname "$0")" && pwd)/check-bash-portability.sh"
fails=0

# probe <expected-exit> <label> <dir>
probe() {
  local want="$1" label="$2" dir="$3" got
  git -C "$dir" add -A
  set +e
  ( cd "$dir" && bash "$gate" >/dev/null 2>&1 )
  got=$?
  set -e
  if [ "$got" != "$want" ]; then
    echo "FAIL: want exit $want, got $got: $label" >&2
    fails=$((fails + 1))
  fi
}

good="$(mktemp -d)"
git_fixture_init "$good"
mkdir -p "$good/scripts"
cat >"$good/scripts/plain.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
names=("a" "b" "c")
for n in "${names[@]}"; do
  echo "$n"
done
EOF
probe 0 "a bash-3.2-clean script passes" "$good"

bad="$(mktemp -d)"
git_fixture_init "$bad"
mkdir -p "$bad/scripts"
cat >"$bad/scripts/uses-mapfile.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
mapfile -t lines < some-file.txt
EOF
probe 1 "a script using mapfile (bash 4+) fails" "$bad"

allowed="$(mktemp -d)"
git_fixture_init "$allowed"
mkdir -p "$allowed/scripts"
cat >"$allowed/scripts/annotated.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
declare -A seen=()  # bash4-ok -- test fixture proves the allow marker suppresses a real hit
EOF
probe 0 "a bash-4-only line carrying bash4-ok -- <reason> passes" "$allowed"

build_dir="$(mktemp -d)"
git_fixture_init "$build_dir"
mkdir -p "$build_dir/build/darwin"
cat >"$build_dir/build/darwin/postinstall.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
readarray -t items < some-file.txt
EOF
probe 1 "a bash-4 construct under build/**/*.sh fails too" "$build_dir"

divergent="$(mktemp -d)"
git_fixture_init "$divergent"
mkdir -p "$divergent/scripts"
cat >"$divergent/scripts/tmpfile.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
out="$(mktemp -t mill-probe)"
echo "$out"
EOF
probe 1 "mktemp -t (BSD prefix form GNU rejects) fails" "$divergent"

rm -rf "$good" "$bad" "$allowed" "$build_dir" "$divergent"

if [ "$fails" -ne 0 ]; then
  echo "check-bash-portability-selftest: $fails probe(s) failed" >&2
  exit 1
fi
echo "check-bash-portability-selftest: OK"
