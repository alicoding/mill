import { chromium, expect, test as base } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

// Port ranges deliberately clear of both Wails' own server-mode default
// (8080) and Mill's own default MCP bind address (127.0.0.1:8090) --
// confirmed live, not assumed: a real LaunchAgent-run mill-server on
// this machine holds localhost:8090 and <tailscale-host>:8080
// permanently, and must never be touched by this suite. Each worker's
// index (Playwright's own `parallelIndex`, stable 0..workers-1 for
// concurrently-running workers, unlike the ever-incrementing
// `workerIndex`) gets one port from each range.
const SERVER_BASE_PORT = 9400
// Exported (unlike SERVER_BASE_PORT) so a spec that needs to talk MCP
// directly -- e.g. canvas-live-sync.spec.ts, driving a real
// update_workflow call against the open editor -- can compute this
// worker's own MCP port (`MCP_BASE_PORT + testInfo.parallelIndex`,
// same arithmetic the workerServer fixture below already uses to spawn
// it) without spawning a second listener of its own.
export const MCP_BASE_PORT = 9500
// A dedicated, disjoint range for the one persistence spec
// (persistence.spec.ts) that deliberately restarts its own server
// against the same settings file mid-test -- never shared with the
// standard per-worker server above, so the two can never collide even
// though both may be alive on the same worker at once.
export const PERSISTENCE_SERVER_BASE_PORT = 9600
export const PERSISTENCE_MCP_BASE_PORT = 9650
// The scale spec's own disjoint range (goal 0073) -- same
// own-server-own-ports reasoning as persistence, since its dense
// fixture env var must never leak into the standard workers' seeds.
export const SCALE_SERVER_BASE_PORT = 9680
export const SCALE_MCP_BASE_PORT = 9730
// The card-page-at-scale spec's own disjoint range (goal 0073 slice
// B) -- same own-server-own-ports reasoning as SCALE_*, since its
// mirror-dense folder-pick override must never leak into the standard
// workers' seeds either.
export const MIRROR_SERVER_BASE_PORT = 9690
export const MIRROR_MCP_BASE_PORT = 9740
// updates.spec.ts's own two disjoint pairs (goal 0082) -- one server
// per channel, since MILL_TEST_UPDATE_CHANNEL is fixed for a process's
// whole lifetime and both channels' UI need proving in the same run.
export const UPDATES_SOURCE_SERVER_BASE_PORT = 9760
export const UPDATES_SOURCE_MCP_BASE_PORT = 9780
export const UPDATES_RELEASE_SERVER_BASE_PORT = 9790
export const UPDATES_RELEASE_MCP_BASE_PORT = 9810

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
      // extraEnv is spread BEFORE this block, so a caller-supplied
      // override (e.g. the mirror-dense spec's own folder-pick
      // fixture) would otherwise always lose to this default.
      MILL_TEST_FOLDER_PICK_PATH: opts.extraEnv?.MILL_TEST_FOLDER_PICK_PATH ?? FOLDER_PICK_FIXTURE,
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
    await page.goto(`${baseURL}/`)
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
