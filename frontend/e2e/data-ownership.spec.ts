import { chromium, expect, test } from '@playwright/test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnMillServer, spawnMillServerProcess, type SpawnedServer } from './fixtures/server'
import { applyCpuThrottle } from './fixtures/throttle'
import { callBindingViaRPC } from './fixtures/wailsRpc'

const CAPABILITIES = 'github.com/alicoding/mill/internal/services/capabilitysvc.CapabilitiesService.List'
const OWNERSHIP_ERROR = 'Mill is already using these data files. Close that instance or choose different data paths.'

async function waitForExit(proc: ChildProcessWithoutNullStreams): Promise<{ code: number | null; stderr: string }> {
  let stderr = ''
  proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('conflicting mill-server did not exit within 15 seconds'))
    }, 15_000)
    proc.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stderr })
    })
  })
}

// Owns both process lifetimes so this test can prove contention between real
// server binaries. Every data path and OS-assigned listener stays isolated.
// eslint-disable-next-line no-empty-pattern -- this test needs testInfo only.
test('a live server owns its settings and execution files before services start', async ({}, testInfo) => {
  const dir = mkdtempSync(path.join(tmpdir(), `mill-e2e-data-ownership-${testInfo.parallelIndex}-`))
  const settingsPath = path.join(dir, 'owner', 'settings.json')
  const executionDbPath = path.join(dir, 'owner', 'execution.db')
  let owner: SpawnedServer | undefined
  const browser = await chromium.launch()

  try {
    owner = await spawnMillServer({
      settingsPath,
      executionDbPath,
      backupDir: path.join(dir, 'owner', 'backups'),
    })
    const page = await browser.newPage()
    await applyCpuThrottle(page)
    await page.goto(`${owner.baseURL}/`)

    // A call through Wails' real transport proves services registered after
    // ownership acquisition are live during ordinary startup.
    const capabilities = await callBindingViaRPC<unknown[]>(page, CAPABILITIES, [])
    expect(capabilities.length).toBeGreaterThan(0)
    const settingsBefore = readFileSync(settingsPath)

    const sameSettingsDb = path.join(dir, 'same-settings', 'execution.db')
    const sameSettings = spawnMillServerProcess({
      settingsPath,
      executionDbPath: sameSettingsDb,
      backupDir: path.join(dir, 'same-settings', 'backups'),
    })
    const firstConflict = await waitForExit(sameSettings)
    expect(firstConflict.code).not.toBe(0)
    expect(firstConflict.stderr).toContain(OWNERSHIP_ERROR)
    expect(firstConflict.stderr).not.toContain(settingsPath)
    expect(firstConflict.stderr).not.toContain(sameSettingsDb)
    expect(existsSync(sameSettingsDb)).toBe(false)
    expect(readFileSync(settingsPath)).toEqual(settingsBefore)

    const sameDatabaseSettings = path.join(dir, 'same-database', 'settings.json')
    const sameDatabase = spawnMillServerProcess({
      settingsPath: sameDatabaseSettings,
      executionDbPath,
      backupDir: path.join(dir, 'same-database', 'backups'),
    })
    const secondConflict = await waitForExit(sameDatabase)
    expect(secondConflict.code).not.toBe(0)
    expect(secondConflict.stderr).toContain(OWNERSHIP_ERROR)
    expect(secondConflict.stderr).not.toContain(sameDatabaseSettings)
    expect(secondConflict.stderr).not.toContain(executionDbPath)
    expect(existsSync(sameDatabaseSettings)).toBe(false)

    expect((await callBindingViaRPC<unknown[]>(page, CAPABILITIES, [])).length).toBe(capabilities.length)
    await page.close()
  } finally {
    await browser.close()
    if (owner) await owner.stop()
    rmSync(dir, { recursive: true, force: true })
  }
})
