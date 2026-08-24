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
// updates.spec.ts's own disjoint pairs (goal 0082, beta pair added
// goal 0100) -- one server per channel, since MILL_TEST_UPDATE_CHANNEL
// is fixed for a process's whole lifetime and every channel's UI needs
// proving in the same run.
export const UPDATES_SOURCE_SERVER_BASE_PORT = 9760
export const UPDATES_SOURCE_MCP_BASE_PORT = 9780
export const UPDATES_RELEASE_SERVER_BASE_PORT = 9790
export const UPDATES_RELEASE_MCP_BASE_PORT = 9810
export const UPDATES_BETA_SERVER_BASE_PORT = 9815
export const UPDATES_BETA_MCP_BASE_PORT = 9825
// The channel-preference opt-in test: persists a store value and
// reloads, so it needs its own server like the other updates cases.
export const UPDATES_CHANNEL_PREF_SERVER_BASE_PORT = 10360
export const UPDATES_CHANNEL_PREF_MCP_BASE_PORT = 10380
// goal 0122: the ready-state pill test forces MILL_TEST_UPDATE_READY
// for its whole server lifetime -- own pair like every updates case.
export const UPDATES_READY_SERVER_BASE_PORT = 10680
export const UPDATES_READY_MCP_BASE_PORT = 10700
// atlas-kind-authoring.spec.ts's own dedicated pair (goal 0079):
// kinds/link kinds are GLOBAL Atlas vocabulary every board render and
// picker reads -- the shared worker pool can't isolate that
// (testing.md's shared-vs-dedicated rule).
export const ATLAS_KIND_AUTHORING_SERVER_BASE_PORT = 10400
export const ATLAS_KIND_AUTHORING_MCP_BASE_PORT = 10420
// guardrail-authoring.spec.ts's own dedicated pair (goal 0078): the
// full rule-from-park -> unstick -> audit-edit -> policy-removed loop
// asserts exact rule counts/groupings in the Rules audit view, which
// the standard per-worker pool can't guarantee stays uncontaminated by
// another spec file sharing that worker's one server -- same
// own-server-own-ports reasoning as persistence/scale/mirror above.
export const GUARDRAIL_AUTHORING_SERVER_BASE_PORT = 9840
export const GUARDRAIL_AUTHORING_MCP_BASE_PORT = 9860

// atlas-authoring.spec.ts's own dedicated pair (goal 0081 slice A1):
// creates/deletes cards and notes in the seeded space and asserts
// exact card/note presence and projection counts, same own-server-
// own-ports reasoning as guardrail-authoring above.
export const ATLAS_AUTHORING_SERVER_BASE_PORT = 9880
export const ATLAS_AUTHORING_MCP_BASE_PORT = 9900
// atlas-containment.spec.ts's own dedicated pair (goal 0081 slice A2):
// draws/groups areas and drags cards between frames in the seeded
// space, asserting exact frame child counts -- same own-server-own-
// ports reasoning as atlas-authoring above, disjoint from it so the
// two spec files' own card/frame counts never cross-contaminate.
export const ATLAS_CONTAINMENT_SERVER_BASE_PORT = 9920
export const ATLAS_CONTAINMENT_MCP_BASE_PORT = 9940

// atlas-slots.spec.ts's own dedicated pair (goal 0081 slice A4): drags
// slot anchors, creates/removes links, and asserts exact link counts
// per card -- same own-server-own-ports reasoning as atlas-authoring/
// atlas-containment above, disjoint from both.
export const ATLAS_SLOTS_SERVER_BASE_PORT = 9960
export const ATLAS_SLOTS_MCP_BASE_PORT = 9980

// atlas-page-edit.spec.ts's own dedicated pair (goal 0081 slice A5):
// edits fields in place, adds/removes links via the page's own slot
// rows, and asserts exact link/chip counts and nav-stack state --
// same own-server-own-ports reasoning as atlas-slots above, disjoint
// from it.
export const ATLAS_PAGE_EDIT_SERVER_BASE_PORT = 10000
export const ATLAS_PAGE_EDIT_MCP_BASE_PORT = 10020

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
      // Every e2e server uses the in-memory keyring: per-worker
      // isolation for secrets (the real keychain is machine-global),
      // and identical absent-means-ErrNotFound semantics on the Linux
      // CI runner, which has no Secret Service at all.
      MILL_TEST_KEYRING: 'memory',
      // extraEnv is spread BEFORE this block, so a caller-supplied
      // override (e.g. the mirror-dense spec's own folder-pick
      // fixture) would otherwise always lose to this default.
      MILL_TEST_FOLDER_PICK_PATH: opts.extraEnv?.MILL_TEST_FOLDER_PICK_PATH ?? FOLDER_PICK_FIXTURE,
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

// atlas-select-group.spec.ts: its own file (and therefore worker) --
// the select-then-group flow proved green in single-worker runs and
// red sharing a worker with the containment spec's heavy gestures.
export const ATLAS_SELECT_GROUP_SERVER_BASE_PORT = 10060
export const ATLAS_SELECT_GROUP_MCP_BASE_PORT = 10080

// atlas-session-restore.spec.ts's own dedicated pair (goal 0091): the
// one spec that needs restore-on-mount LIVE (the worker pool suppresses
// it via MILL_TEST_ATLAS_SESSION_OFF above), reload-based within one
// test -- same own-server-own-ports reasoning as persistence.
export const ATLAS_SESSION_SERVER_BASE_PORT = 10100
export const ATLAS_SESSION_MCP_BASE_PORT = 10120

// guardrail.spec.ts's own dedicated pair: its Review-queue assertions
// (exact pending/resolved rows, kind-filter narrowing, the sidebar
// pending-count badge) must never be contaminated by another spec
// cohabiting the standard per-worker pool's one shared server (e.g.
// mcp-write-cancel.spec.ts parking its own MCP approval on the same
// worker) -- same own-server-own-ports reasoning as guardrail-
// authoring above, one class of bug applied to this file's own
// Review-queue state.
export const GUARDRAIL_SPEC_SERVER_BASE_PORT = 10140
export const GUARDRAIL_SPEC_MCP_BASE_PORT = 10160

// guardrail-review.spec.ts's own dedicated pair -- guardrail.spec.ts's
// Review-queue tests split into this second file once the converted
// file crossed the 500-line hand-written-file limit
// (.claude/rules/architecture.md); its own port pair rather than
// reusing GUARDRAIL_SPEC_* above, so the two files' worker-time
// lifetimes can never overlap on the same ports even though same-file/
// same-worker serialization no longer makes that a correctness risk.
export const GUARDRAIL_REVIEW_SERVER_BASE_PORT = 10180
// Kept well clear of the server range above: 8 tests x up to 10-per-
// test offsets x up to 4 workers pushes the server range itself past
// 10250, so the MCP base must start beyond that or a computed server
// port can land on another test's MCP listener.
export const GUARDRAIL_REVIEW_MCP_BASE_PORT = 10300

// atlas-perspectives.spec.ts's own dedicated pair (goal 0095 slice 2,
// ADR-0041): the active perspective is GLOBAL Atlas session state
// (AtlasSessionState.activePerspectiveID), and its own perspective/
// membership records are read by every other Atlas spec's board --
// same shared-global-state reasoning as guardrail-authoring/
// atlas-session-restore above, applied to this feature's own writes.
export const ATLAS_PERSPECTIVES_SERVER_BASE_PORT = 10320
export const ATLAS_PERSPECTIVES_MCP_BASE_PORT = 10340

// atlas-linking.spec.ts's own dedicated pair (goal 0124 slice 2):
// drags links between cards and asserts exact edge counts, same
// own-server-own-ports reasoning as atlas-slots above.
export const ATLAS_LINKING_SERVER_BASE_PORT = 10440
export const ATLAS_LINKING_MCP_BASE_PORT = 10460

// atlas-delivery-ledger.spec.ts's own dedicated pair (goal 0164 L1):
// edits the seeded ledger-sync workflow's own folderPath config
// (global, shared-workflow state per composition's own model) and
// creates real Atlas cards from a fixture folder, same own-server-
// own-ports reasoning as atlas-linking above.
export const ATLAS_LEDGER_SYNC_SERVER_BASE_PORT = 10480
export const ATLAS_LEDGER_SYNC_MCP_BASE_PORT = 10500

// atlas-folder-import-kind-proposal.spec.ts's own dedicated pair (goal
// 0172 S2): its own MILL_TEST_FOLDER_PICK_PATH override points at a
// frontmatter-carrying fixture folder distinct from the shared pool's
// synced-folder/ (which the standard worker fixture already commits
// every OTHER folder-import spec to) -- same own-server-own-ports
// reasoning as atlas-delivery-ledger above.
export const KIND_PROPOSAL_SERVER_BASE_PORT = 10520
export const KIND_PROPOSAL_MCP_BASE_PORT = 10540

// atlas-single-space-trap.spec.ts's own dedicated pair (goal 0183):
// deletes the seeded root card down to ZERO spaces and back up, a
// global root-card-count state every other Atlas spec in the shared
// pool assumes never happens (they all rely on auto-entering the one
// seeded root, "The engagement", on every fresh load) -- same
// own-server-own-ports reasoning as atlas-session-restore above.
export const ATLAS_SINGLE_SPACE_SERVER_BASE_PORT = 10560
export const ATLAS_SINGLE_SPACE_MCP_BASE_PORT = 10580
