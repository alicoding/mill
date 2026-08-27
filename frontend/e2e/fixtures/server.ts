import { chromium, expect, test as base } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVER_BASE_PORT, MCP_BASE_PORT } from './serverPorts'

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

export interface SpawnedServer {
  baseURL: string
  settingsPath: string
  executionDbPath: string
  backupDir: string
  /** Kills exactly this process (SIGTERM, then SIGKILL if it doesn't exit) -- never anything else. */
  stop: () => Promise<void>
}

export interface SpawnServerOptions {
  port: number
  mcpPort: number
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
  const proc = spawn(MILL_SERVER_BIN, [], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...opts.extraEnv,
      WAILS_SERVER_PORT: String(opts.port),
      MILL_MCP_ADDR: `127.0.0.1:${opts.mcpPort}`,
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
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const stderrTail: string[] = []
  proc.stderr.on('data', (chunk: Buffer) => {
    stderrTail.push(chunk.toString())
    if (stderrTail.length > 50) stderrTail.shift()
  })

  const baseURL = `http://localhost:${opts.port}`
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

  return { baseURL, settingsPath: opts.settingsPath, executionDbPath: opts.executionDbPath, backupDir: opts.backupDir, stop }
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
      port: SERVER_BASE_PORT + idx,
      mcpPort: MCP_BASE_PORT + idx,
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
})

export { expect }
