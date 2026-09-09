import { chromium, expect, test as base } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyCpuThrottle } from './throttle'

// Every per-spec dedicated port pair lives in ./serverPorts.ts (split
// out at the 500-line hand-written-file limit, .claude/rules/
// architecture.md) -- re-exported here so no spec's own
// `import { X_PORT } from './fixtures/server'` had to change.
export * from './serverPorts'

// goal 0009 (docs/goals/0009-e2e-parallel-isolation.md): each Playwright
// worker gets its OWN mill-server process, own port, own MCP port, and
// own throwaway MILL_SETTINGS_PATH/MILL_EXECUTION_DB_PATH -- replacing
// the old single-shared `webServer` (playwright.config.ts) that forced
// `workers: 1` and the run-the-suite-twice discipline
// (.claude/rules/testing.md). The binary itself is built exactly once,
// in globalSetup (./global-setup.ts); this module only ever execs the
// already-built binary, once per worker -- from e2e's OWN .build/ dir,
// never the repo's shared bin/ (see global-setup.ts's comment for the
// dev-loop/e2e mutual-destruction incident that forced the split).

const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..')
const MILL_SERVER_BIN = path.join(REPO_ROOT, 'frontend', 'e2e', '.build', 'mill-server')

// Server-mode Playwright has no display a real native folder-picker
// panel could render into (goal 0067) -- every spawned server carries
// this fixture path so AtlasService.PickFolder's own env bypass
// (MILL_TEST_FOLDER_PICK_PATH) returns it instead of opening the real
// OS dialog. Harmless for every test that never calls PickFolder.
const FOLDER_PICK_FIXTURE = path.join(REPO_ROOT, 'frontend', 'e2e', 'fixtures', 'synced-folder')

// Same bypass for AtlasService.PickImageFile (goal 0206) --
// MILL_TEST_IMAGE_PICK_PATH. Harmless for every test that never calls it.
const IMAGE_PICK_FIXTURE = path.join(REPO_ROOT, 'frontend', 'e2e', 'fixtures', 'synced-folder', 'logo.png')

// Same bypass for AtlasService.PickDiagramFile (goal 0194's live
// round-trip slice) -- MILL_TEST_DIAGRAM_PICK_PATH. Harmless for every
// test that never calls it.
const DIAGRAM_PICK_FIXTURE = path.join(REPO_ROOT, 'frontend', 'e2e', 'fixtures', 'diagram-pick.drawio')

async function waitForHealth(url: string, proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastErr: unknown
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      throw new Error(`mill-server exited early (code ${proc.exitCode}) before becoming healthy at ${url}`)
    }
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch (err) {
      lastErr = err
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${url} to become healthy: ${String(lastErr)}`)
}

const readyLinePattern = /MILL_READY addr=127\.0\.0\.1:(\d+) mcp=127\.0\.0\.1:(\d+)/

interface ReadyAddrs {
  port: number
  mcpPort: number
}

// Reads stdout until main.go's own MILL_READY line appears (goal 0358
// S6): structured text is parsed, never matched against "listening" or
// similar prose (.claude/rules/architecture.md) -- this is the one
// place that owns the pattern. Only ever awaited when the caller asked
// for an OS-assigned port (SpawnServerOptions.port omitted); a caller
// naming its own fixed port never triggers the server to print this
// line at all (wiring.announceServerReady's own gate), so this
// function is never raced against a process that won't produce it.
async function waitForReadyLine(proc: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<ReadyAddrs> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onExit = (code: number | null) => {
      clearTimeout(timer)
      proc.stdout.off('data', onData)
      reject(new Error(`mill-server exited early (code ${code}) before printing MILL_READY`))
    }
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString()
      const match = readyLinePattern.exec(buffer)
      if (match) {
        clearTimeout(timer)
        proc.stdout.off('data', onData)
        proc.off('exit', onExit)
        resolve({ port: Number(match[1]), mcpPort: Number(match[2]) })
      }
    }
    const timer = setTimeout(() => {
      proc.stdout.off('data', onData)
      proc.off('exit', onExit)
      reject(new Error(`timed out after ${timeoutMs}ms waiting for a MILL_READY line; got so far: ${JSON.stringify(buffer)}`))
    }, timeoutMs)
    proc.stdout.on('data', onData)
    proc.once('exit', onExit)
  })
}

export interface SpawnedServer {
  baseURL: string
  /** The server's real bound port -- OS-assigned unless the caller named one. */
  port: number
  /** The MCP listener's real bound port -- OS-assigned unless the caller named one. */
  mcpPort: number
  settingsPath: string
  executionDbPath: string
  backupDir: string
  /** Kills exactly this process (SIGTERM, then SIGKILL if it doesn't exit) -- never anything else. */
  stop: () => Promise<void>
}

export interface SpawnServerOptions {
  // Omit both for an OS-assigned port pair (the default, goal 0358 S6:
  // servers bind OS-assigned ports, never a literal port in a spec) --
  // spawnMillServer then reads the real ports back off main.go's
  // MILL_READY line. A spec with its own historically-dedicated fixed
  // pair (declared in ./serverPorts.ts) still names both explicitly.
  port?: number
  mcpPort?: number
  /** The browser bridge's bind port; OS-assigned when omitted. */
  bridgePort?: number
  settingsPath: string
  executionDbPath: string
  backupDir: string
  // Extra env for the spawned process (e.g. the scale spec's
  // MILL_TEST_DENSE_ATLAS gate) -- never overrides the isolation vars
  // above, which are spread after it.
  extraEnv?: Record<string, string>
}

// Spawns exactly one mill-server process directly (no intermediate
// shell -- `spawn(bin, args)`, not `exec('sh -c ...')`), so `stop()`
// below always targets the real server PID, never a shell wrapper
// around it. Used both by the standard per-worker fixture and directly
// by persistence.spec.ts, which needs to start/stop more than one
// server within a single test.
export async function spawnMillServer(opts: SpawnServerOptions): Promise<SpawnedServer> {
  const env = {
    ...process.env,
    ...opts.extraEnv,
    WAILS_SERVER_PORT: String(opts.port ?? 0),
    MILL_MCP_ADDR: `127.0.0.1:${opts.mcpPort ?? 0}`,
    // The browser bridge's own loopback listener (goal 0350): every
    // server binds one, so it must be per-worker isolated like the MCP
    // listener above or two concurrent workers fight for the default
    // port. OS-assigned unless a spec that talks to the bridge
    // directly (browser-bridge.spec.ts, browser-replay.spec.ts) names
    // the port it will connect to.
    MILL_BRIDGE_ADDR: `127.0.0.1:${opts.bridgePort ?? 0}`,
    MILL_SETTINGS_PATH: opts.settingsPath,
    MILL_EXECUTION_DB_PATH: opts.executionDbPath,
    MILL_BACKUP_DIR: opts.backupDir,
    // Derived from settingsPath's own directory (every call site's
    // own per-worker/per-spec mkdtemp dir) rather than a new
    // SpawnServerOptions field every one of them would otherwise need
    // to start passing -- goal 0185: without this, a spec that ever
    // touches the Secrets page would create/unlock the REAL user's
    // vault file. secrets.spec.ts's own dir happens to compute the
    // identical path, so it doesn't need an extraEnv override at all.
    MILL_SECRETS_PATH: path.join(path.dirname(opts.settingsPath), 'secrets.kdbx'),
    // Every e2e server uses the in-memory keyring: per-worker
    // isolation for secrets (the real keychain is machine-global),
    // and identical absent-means-ErrNotFound semantics on the Linux
    // CI runner, which has no Secret Service at all.
    MILL_TEST_KEYRING: 'memory',
    // extraEnv is spread BEFORE this block, so a caller-supplied
    // override (e.g. the mirror-dense spec's own folder-pick
    // fixture) would otherwise always lose to this default.
    MILL_TEST_FOLDER_PICK_PATH: opts.extraEnv?.MILL_TEST_FOLDER_PICK_PATH ?? FOLDER_PICK_FIXTURE,
    // Same override-wins-by-spreading-first shape, for
    // AtlasService.PickImageFile's own e2e bypass (goal 0206).
    MILL_TEST_IMAGE_PICK_PATH: opts.extraEnv?.MILL_TEST_IMAGE_PICK_PATH ?? IMAGE_PICK_FIXTURE,
    // Same shape for AtlasService.PickDiagramFile's own e2e bypass
    // (goal 0194's live round-trip slice).
    MILL_TEST_DIAGRAM_PICK_PATH: opts.extraEnv?.MILL_TEST_DIAGRAM_PICK_PATH ?? DIAGRAM_PICK_FIXTURE,
    // Lets remote-access.spec.ts populate a paired device directly --
    // pairing itself only completes over a non-loopback connection,
    // which this isolated per-worker server never has.
    MILL_TEST_ALLOW_DEVICE_SEED: '1',
    // Every e2e server gets the in-memory clipboard adapter by
    // default (goal 0356): a workflow's apply-clipboard-write-*/
    // capture-clipboard-html step must never reach the real OS
    // pasteboard just because a spec happened to run this file. A
    // spec that deliberately needs the real pasteboard (verifying a
    // Node-side pbcopy round-trip through CompositionService.
    // ReadHostClipboardText, or a real Finder-file-url read) passes
    // MILL_CLIPBOARD: 'host' via extraEnv, and must wrap that flow in
    // withClipboardLock (frontend/e2e/fixtures/clipboardLock.ts) --
    // enforced by scripts/check-test-side-effects.sh. Same
    // override-wins-by-computing-first shape as the PICK_PATH
    // defaults above.
    MILL_CLIPBOARD: opts.extraEnv?.MILL_CLIPBOARD ?? 'memory',
    // Same in-memory-by-default posture for the URL/browser opener
    // (goal 0356 part 2): AtlasService.OpenURL's own osopen.Port
    // resolves to a recorder, never the real Wails Browser.OpenURL, so
    // an external-link click anywhere in a spec never opens a real
    // browser tab on the machine running this worker. No spec needs the
    // real opener today, so unlike MILL_CLIPBOARD's host mode there is
    // no lock fixture to wrap around an override -- extraEnv can still
    // pass MILL_OPEN: 'host' if a future spec genuinely needs it.
    MILL_OPEN: opts.extraEnv?.MILL_OPEN ?? 'memory',
  }

  // Fail fast in the harness itself, before ever spawning a process
  // that could touch the real OS keychain: MILL_TEST_KEYRING is never
  // overridable via extraEnv (spread before this block, goal 0356's
  // same MILL_CLIPBOARD posture just above), so this can only trip if a
  // future edit here breaks that invariant.
  if (env.MILL_TEST_KEYRING !== 'memory') {
    throw new Error(`spawnMillServer: MILL_TEST_KEYRING resolved to ${JSON.stringify(env.MILL_TEST_KEYRING)}, want 'memory' -- refusing to spawn a server that could touch the real OS keychain`)
  }

  const proc = spawn(MILL_SERVER_BIN, [], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const stderrTail: string[] = []
  proc.stderr.on('data', (chunk: Buffer) => {
    stderrTail.push(chunk.toString())
    if (stderrTail.length > 50) stderrTail.shift()
  })

  // opts.port undefined means an OS-assigned pair was requested (the
  // default): main.go only ever prints MILL_READY in that case
  // (wiring.announceServerReady's own gate), so this read is skipped
  // entirely for a caller naming its own fixed port -- that port is
  // already known, and no such line would ever arrive.
  let port = opts.port
  let mcpPort = opts.mcpPort
  if (port === undefined) {
    try {
      const ready = await waitForReadyLine(proc, 60_000)
      port = ready.port
      mcpPort = ready.mcpPort
    } catch (err) {
      proc.kill('SIGKILL')
      throw new Error(`${String(err)}\nmill-server stderr:\n${stderrTail.join('')}`, { cause: err })
    }
  }
  if (mcpPort === undefined) {
    // Both-or-neither invariant: a caller naming its own port must name
    // its own mcpPort too, never mix an explicit port with an
    // OS-assigned MCP listener.
    throw new Error('spawnMillServer: mcpPort must be set whenever port is (both explicit, or neither)')
  }

  const baseURL = `http://localhost:${port}`
  try {
    await waitForHealth(`${baseURL}/health`, proc, 60_000)
  } catch (err) {
    proc.kill('SIGKILL')
    throw new Error(`${String(err)}\nmill-server stderr:\n${stderrTail.join('')}`, { cause: err })
  }

  // Isolation guard, preserved per-worker instead of once globally (the
  // old global-setup.ts's own job): prove this exact process is serving
  // isolated MILL_* data before any test trusts it -- same
  // isolated-data-badge signal, same refusal-to-proceed behavior on a
  // failure, just checked once per spawned server instead of once for
  // the whole (previously singular) server.
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    // The very first Chromium request after a fresh bind intermittently
    // gets ERR_EMPTY_RESPONSE even though /health already answered and
    // every later request (curl and browser alike) serves fine --
    // observed repeatedly on brand-new dedicated port pairs. Retry the
    // guard navigation a few times before declaring the server bad; a
    // genuinely broken server still fails every attempt, with its own
    // stderr included below.
    let lastGotoErr: unknown
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await page.goto(`${baseURL}/`)
        lastGotoErr = undefined
        break
      } catch (err) {
        lastGotoErr = err
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
    if (lastGotoErr !== undefined) {
      throw new Error(`guard navigation to ${baseURL} failed after retries: ${String(lastGotoErr)}\nmill-server stderr:\n${stderrTail.join('')}`, { cause: lastGotoErr })
    }
    await expect(
      page.getByTestId('isolated-data-badge'),
      `Server at ${baseURL} is NOT running on isolated MILL_* data -- refusing to trust it`,
    ).toBeVisible({ timeout: 15_000 })
  } finally {
    await browser.close()
  }

  const stop = async (): Promise<void> => {
    if (proc.exitCode !== null || proc.signalCode !== null) return
    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => proc.kill('SIGKILL'), 5_000)
      proc.once('exit', () => {
        clearTimeout(forceKill)
        resolve()
      })
      proc.kill('SIGTERM')
    })
  }

  return { baseURL, port, mcpPort, settingsPath: opts.settingsPath, executionDbPath: opts.executionDbPath, backupDir: opts.backupDir, stop }
}

// spawnUpdatesServer is updates.spec.ts's own dedicated-server helper
// (goal 0082), promoted here once a second updates spec file needed it
// too (goal 0220 S1, testing.md's "a helper used by 2+ spec files MUST
// be promoted" rule) -- each updates test needs its own server carrying
// a fixed MILL_TEST_UPDATE_* env for its whole lifetime, on its own
// disjoint port pair, so it can never share the standard per-worker
// fixture.
export async function spawnUpdatesServer(
  idx: number,
  serverBasePort: number,
  mcpBasePort: number,
  extraEnv: Record<string, string>,
): Promise<{ server: SpawnedServer; dir: string }> {
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-updates-${idx}-`))
  const server = await spawnMillServer({
    port: serverBasePort + idx,
    mcpPort: mcpBasePort + idx,
    settingsPath: path.join(dir, 'settings.json'),
    executionDbPath: path.join(dir, 'execution.db'),
    backupDir: path.join(dir, 'backups'),
    extraEnv,
  })
  return { server, dir }
}

function mkWorkerTempDir(idx: number): string {
  return mkdtempSync(path.join(tmpdir(), `mill-e2e-w${idx}-`))
}

interface WorkerFixtures {
  workerServer: SpawnedServer
}

export const test = base.extend<Record<string, never>, WorkerFixtures>({
  // Playwright's own fixture signature requires this first ({})
  // parameter regardless of whether any test-scoped fixtures are consumed.
  // eslint-disable-next-line no-empty-pattern
  workerServer: [async ({}, use, workerInfo) => {
    const idx = workerInfo.parallelIndex
    const dir = mkWorkerTempDir(idx)
    const server = await spawnMillServer({
      settingsPath: path.join(dir, 'settings.json'),
      executionDbPath: path.join(dir, 'execution.db'),
      backupDir: path.join(dir, 'backups'),
      // Session restore off (goal 0091): on a SHARED server every
      // fresh page's mount would land wherever the previous test
      // stood -- and a client-side pre-test reset cannot win the race
      // against a closing page's trailing save. The dedicated
      // atlas-session-restore spec proves the feature on its own
      // server, without this.
      extraEnv: { MILL_TEST_ATLAS_SESSION_OFF: '1' },
    })
    await use(server)
    await server.stop()
    rmSync(dir, { recursive: true, force: true })
  }, { scope: 'worker' }],

  // `use` here is Playwright's own fixture-resolution callback, not a
  // React hook -- eslint-plugin-react-hooks matches on the `use*` name
  // pattern alone and has no way to tell the two apart.
  baseURL: async ({ workerServer }, use) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(workerServer.baseURL)
  },

  // fixtures/throttle.ts's applyCpuThrottle (goal 0358 S8): every
  // dedicated-server spec's own page must apply the same rate, so the
  // logic lives there and this fixture is one caller of it.
  //
  // navigator.platform pin (goal 0405 S1): Mill only ships a macOS
  // .app, but Primer KeybindingHint (@primer/react/experimental) picks
  // its own glyph-vs-spelled-out rendering off the REAL browser's
  // navigator.platform, with no override hook in this version -- on
  // the ubuntu-latest CI runner that resolves to "other" ("Meta"
  // instead of "⌘"), diverging from every developer's own Mac and from
  // the real installed app. Pinning it here (before any script on the
  // page runs) makes every worker -- local or CI -- render the SAME
  // mac glyphs the shipped app does, rather than chasing an
  // environment-dependent text assertion.
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true })
    })
    await applyCpuThrottle(page)
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(page)
  },
})

export { expect }
