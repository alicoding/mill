import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// goal 0009 (docs/goals/0009-e2e-parallel-isolation.md): builds the
// e2e server binary exactly ONCE, before any worker starts -- each worker
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

// The output path lives under frontend/e2e/.build/, NOT the repo's
// shared bin/ -- bin/ is also where `task dev` (and build/package's
// `clean` = rm -rf bin/) operate, so an e2e suite and a dev loop
// running concurrently could destroy each other's artifacts mid-flight
// (a suite losing its server binary mid-run means spawn-ENOENT
// failures; a dev app losing its own .app bundle). A dedicated,
// gitignored path removes the shared-artifact contention structurally
// instead of trying to sequence the two loops.
//
// Rebuilds the frontend bundle immediately before the Go binary that
// embeds it (go:embed all:frontend/dist, main.go), every run -- goal
// 0062's stale-build-badge flake class. Go's own VCS stamping
// (runtime/debug.ReadBuildInfo, read at `go build` time) and Vite's
// __MILL_REPO_HEAD__ define (vite.config.ts's repoHead(), read at
// `vite build` time) are two INDEPENDENT `git rev-parse HEAD` reads;
// whenever they were taken at different moments -- e.g. `npm run
// build:dev` run once at a session's start, then this file's `go
// build` re-run minutes or commits later across a long session's many
// playwright invocations -- any commit landing in that window makes
// them disagree, and BuildIdentityBadge.tsx correctly (and
// misleadingly, in this harness-only case) reports a stale build. The
// two reads only ever agree by construction when they're taken back to
// back, so both builds now happen in the same globalSetup invocation.
export default function globalSetup(): void {
  execFileSync('npm', ['run', 'build:dev'], {
    cwd: path.join(REPO_ROOT, 'frontend'),
    stdio: 'inherit',
  })
  execFileSync('go', ['build', '-tags', 'server', '-o', 'frontend/e2e/.build/mill-server', '.'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  })
}
