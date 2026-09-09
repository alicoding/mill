#!/usr/bin/env bash
# Probes check-frame-runtime-fresh.sh's predicates against synthetic
# fixture trees (goal 0396): a reappeared hand-written file, a missing
# bundle, a stale one still carrying an import statement, and the clean
# state -- so a regression in the gate itself can't go unnoticed, the
# same "prove the gate against a stale fixture" shape as docsgen-
# freshness/sdk-freshness's own committed-diff checks, adapted for a
# gitignored build output neither can git-diff against.
set -euo pipefail

gate="$(cd "$(dirname "$0")" && pwd)/check-frame-runtime-fresh.sh"
fails=0

probe() {
	local want="$1" label="$2" root="$3" got
	set +e
	MILL_FRAME_ROOT="$root" bash "$gate" >/dev/null 2>&1
	got=$?
	set -e
	if [ "$got" != "$want" ]; then
		echo "FAIL: want exit $want, got $got: $label" >&2
		fails=$((fails + 1))
	fi
}

clean_bundle() {
	cat <<'EOF'
(function () { console.log('ok') })()
EOF
}

# clean: both bundles present, self-contained, no public/ leftovers.
clean="$(mktemp -d)"
mkdir -p "$clean/dist/plugin-frame"
clean_bundle >"$clean/dist/plugin-frame/activation.js"
clean_bundle >"$clean/dist/plugin-frame/bootstrap.js"
probe 0 "a fresh build with no hand-written leftovers passes" "$clean"

# reappeared: a hand-written file sits back under public/plugin-frame.
reappeared="$(mktemp -d)"
mkdir -p "$reappeared/dist/plugin-frame" "$reappeared/public/plugin-frame"
clean_bundle >"$reappeared/dist/plugin-frame/activation.js"
clean_bundle >"$reappeared/dist/plugin-frame/bootstrap.js"
echo "(function(){})()" >"$reappeared/public/plugin-frame/activation.js"
probe 1 "a hand-written public/plugin-frame/*.js fails" "$reappeared"

# missing: the build never ran.
missing="$(mktemp -d)"
probe 1 "a missing built bundle fails" "$missing"

# stale: the bundle still carries a module import (never cleanly built).
stale="$(mktemp -d)"
mkdir -p "$stale/dist/plugin-frame"
printf 'import { x } from "./x.js"\n(function(){})()\n' >"$stale/dist/plugin-frame/activation.js"
clean_bundle >"$stale/dist/plugin-frame/bootstrap.js"
probe 1 "a stale bundle carrying an import statement fails" "$stale"

# eval: a bundle calling eval() fails the CSP check.
evalcase="$(mktemp -d)"
mkdir -p "$evalcase/dist/plugin-frame"
echo "(function () { eval('1') })()" >"$evalcase/dist/plugin-frame/activation.js"
clean_bundle >"$evalcase/dist/plugin-frame/bootstrap.js"
probe 1 "a bundle calling eval() fails" "$evalcase"

rm -rf "$clean" "$reappeared" "$missing" "$stale" "$evalcase"

if [ "$fails" -ne 0 ]; then
	echo "check-frame-runtime-fresh-selftest: $fails probe(s) failed" >&2
	exit 1
fi
echo "check-frame-runtime-fresh-selftest: OK"
