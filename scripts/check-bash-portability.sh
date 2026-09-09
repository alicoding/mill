#!/usr/bin/env bash
# Enforces goal 0403 S2e: every scripts/**/*.sh and build/**/*.sh file CI
# or lefthook can invoke must run cleanly under bash 3.2. GitHub's hosted
# macOS runners resolve a bare `#!/usr/bin/env bash` shebang to exactly
# that version (so does a contributor's own Mac when Homebrew's bash
# isn't ahead of /bin/bash on PATH) -- it lacks associative arrays
# (declare -A/local -A), mapfile/readarray, coproc, the
# ^^/,,/^/, case-modification expansions, &>>, |&, and ;;&. One of those
# in a script CI runs is a latent exit 127/2 that only a real bash-3.2
# invocation surfaces (the #819 class this gate closes). Run by lefthook
# (pre-commit) and CI's bash-portability job -- one script both call,
# same non-drift shape as check-comment-hygiene.sh.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# This gate's own two files necessarily spell out the flagged
# constructs verbatim -- this header, and the selftest's probe
# fixtures -- so scanning them would flag its own documentation, not a
# real usage.
self_regex='^scripts/check-bash-portability(-selftest)?\.sh$'

allow_marker='bash4-ok -- '

# mapfile/readarray/coproc: whole-word builtins with no bash-3.2
# equivalent. declare -A / local -A: associative arrays (any combined
# flag ordering, e.g. -Ag/-gA). ${var^^}/${var,,}/${var^}/${var,}:
# case-modification parameter expansion. &>>: combined
# append-stdout-and-stderr redirection (bash 3.2 needs `>>file 2>&1`).
# |&: pipe-both-streams shorthand for `2>&1 |` -- the `[^&]` after it
# excludes an alternation-bar-then-&& inside an unrelated regex string
# (never followed by a second &, unlike the real operator). ;;&: case
# fallthrough-and-keep-testing.
bash4_patterns='\bmapfile\b|\breadarray\b|\bcoproc\b|(declare|local)[[:space:]]+-[a-zA-Z]*A\b|\$\{[A-Za-z_][A-Za-z0-9_]*(\^\^|\^|,,|,)|&>>|\|&([^&]|$)|;;&'

violations=0
while IFS= read -r -d '' file; do
  if [[ "$file" =~ $self_regex ]]; then
    continue
  fi
  hits="$(grep -nE -- "$bash4_patterns" "$file" || true)"
  [[ -z "$hits" ]] && continue
  while IFS= read -r hit; do
    lineno="${hit%%:*}"
    linetext="${hit#*:}"
    if [[ "$linetext" == *"$allow_marker"* ]]; then
      continue
    fi
    echo "bash-portability: $file:$lineno: bash-4-only construct -- $linetext"
    violations=$((violations + 1))
  done <<<"$hits"
done < <(git ls-files -z -- 'scripts/*.sh' 'scripts/**/*.sh' 'build/**/*.sh')

if [[ "$violations" -gt 0 ]]; then
  echo
  echo "bash-portability: $violations violation(s). GitHub's macOS runner (and a"
  echo "contributor machine without Homebrew bash ahead on PATH) resolves"
  echo "#!/usr/bin/env bash to bash 3.2 -- make the construct bash-3.2-compatible,"
  echo "or annotate the line with '# ${allow_marker}<reason>' if it must stay."
  exit 1
fi
echo "bash-portability: OK"
