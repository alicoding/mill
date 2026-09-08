#!/usr/bin/env bash
# Enforces goal 0358 S6's class fix: an e2e server binds an OS-assigned
# port (frontend/e2e/fixtures/server.ts's spawnMillServer, reading the
# real port back off main.go's MILL_READY line), never a literal one --
# a literal is exactly what let two worktrees' own worker pools collide
# on the same fixed port on one machine. Run by lefthook (pre-commit)
# and CI's ci-gate -- one script both call, same non-drift shape as
# check-e2e-seed-literals.sh.
#
# What this gate flags, in frontend/e2e/**/*.ts:
#   - a literal port in the old shared-pool/persistence range (94xx,
#     95xx, 96xx) -- bounded so it never fires inside an unrelated
#     longer digit run (a hash, a timestamp, a byte count);
#   - a literal `127.0.0.1:<port>` address -- the shape every real
#     server-spawn env var (WAILS_SERVER_PORT, MILL_MCP_ADDR,
#     MILL_BRIDGE_ADDR) takes.
#
# A spec's own historically-dedicated fixed pair (declared in
# ./serverPorts.ts, well outside the 94xx-96xx range) is untouched by
# this gate -- it was never the collision this goal fixes, and every
# range in that file lives in one reviewable place already.
#
# Escape hatch, same line as the literal:
#   port-literal: <reason>
# for the rare literal that names a deliberately-unreachable test
# address (a form value proving a "connection refused" path), never a
# real server-spawn port -- see configure-environments.spec.ts and
# request-test-panel.spec.ts for the two real cases.
set -euo pipefail

range_pattern='(^|[^0-9])(94[0-9]{2}|95[0-9]{2}|96[0-9]{2})([^0-9]|$)'
loopback_pattern='127\.0\.0\.1:[0-9]+'
allow='port-literal: '

violations=0

while IFS= read -r -d '' file; do
  hits="$(grep -nE "$range_pattern|$loopback_pattern" "$file" | grep -vF "$allow" || true)"
  if [[ -n "$hits" ]]; then
    while IFS= read -r hit; do
      echo "e2e-fixed-ports: $file:$hit"
      violations=$((violations + 1))
    done <<< "$hits"
  fi
done < <(git ls-files -z -- 'frontend/e2e/**/*.ts' 'frontend/e2e/*.ts')

if (( violations > 0 )); then
  cat >&2 <<'MSG'

A literal port above belongs to the class goal 0358 S6 fixed: two
worktrees' own worker pools binding the SAME fixed port on one machine.

Spawn through frontend/e2e/fixtures/server.ts's spawnMillServer without
`port`/`mcpPort` (or import an existing SpawnedServer's own `.port`/
`.mcpPort` field) -- it binds `:0` and reads the real ports back off
main.go's MILL_READY line.

If the literal really is a deliberately-unreachable test address (never
a server this suite spawns), say so on the same line:
  // port-literal: <why this address is never a real listener>
MSG
  exit 1
fi

echo "e2e-fixed-ports: 0 violation(s)."
