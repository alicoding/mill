import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// goal 0009 (docs/goals/0009-e2e-parallel-isolation.md): builds
// bin/mill-server exactly ONCE, before any worker starts -- each worker
// then just execs the already-built binary against its own port/
// settings file (./fixtures/server.ts's `spawnMillServer`). This
// replaces the old per-run `webServer.command` (`go build ... &&
// ./bin/mill-server`), which rebuilt on every run and only ever ran one
// server for the whole suite to share.
//
// The isolation guard this file used to own (proving the server the
// suite is about to exercise runs on isolated MILL_* data before any
// test trusts it -- the incident that guard exists for is documented
// in ./fixtures/server.ts's own header comment) moved with it: it's
// now checked once per spawned server, inside `spawnMillServer` itself,
// since "the server" is no longer a single global thing to check once.
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

export default function globalSetup(): void {
  execFileSync('go', ['build', '-tags', 'server', '-o', 'bin/mill-server', '.'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
}
