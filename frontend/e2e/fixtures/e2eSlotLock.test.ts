import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { acquireE2ESlot, releaseE2ESlot } from './e2eSlotLock'

// Every test gets its own lock directory (never the real
// os.tmpdir()/mill-e2e-slot.lock) so this suite can never contend with
// -- or be confused for -- an actual Playwright run on this machine.
let lockDir: string

afterEach(() => {
  if (lockDir) rmSync(lockDir, { recursive: true, force: true })
})

function freshLockDir(): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'e2e-slot-lock-test-')), 'slot.lock')
  lockDir = dir
  return dir
}

// A pid guaranteed dead: spawn a trivial child and let it exit fully
// before reading its pid back.
function deadPid(): number {
  const result = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
  return result.pid ?? -1
}

describe('acquireE2ESlot / releaseE2ESlot', () => {
  it('acquires an unheld lock immediately', async () => {
    const dir = freshLockDir()
    await acquireE2ESlot(1_000, { lockDir: dir, bypass: false })
    expect(existsSync(dir)).toBe(true)
    releaseE2ESlot({ lockDir: dir, bypass: false })
    expect(existsSync(dir)).toBe(false)
  })

  it('a second acquire waits for the first release, then succeeds', async () => {
    const dir = freshLockDir()
    await acquireE2ESlot(1_000, { lockDir: dir, bypass: false })

    let secondAcquired = false
    const second = acquireE2ESlot(5_000, { lockDir: dir, pollIntervalMs: 20, bypass: false }).then(() => {
      secondAcquired = true
    })

    // Give the second caller time to poll at least once and observe
    // the held lock before releasing it.
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(secondAcquired).toBe(false)

    releaseE2ESlot({ lockDir: dir, bypass: false })
    await second
    expect(secondAcquired).toBe(true)
  })

  it('reclaims a lock whose owner pid is no longer alive', async () => {
    const dir = freshLockDir()
    const pid = deadPid()
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid, cwd: '/nowhere', startedAt: new Date().toISOString() }))

    await acquireE2ESlot(1_000, { lockDir: dir, pollIntervalMs: 20, bypass: false })
    expect(existsSync(path.join(dir, 'owner.json'))).toBe(true)
  })

  it('times out naming the current holder', async () => {
    const dir = freshLockDir()
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, cwd: '/held-by-me', startedAt: new Date().toISOString() }))

    await expect(acquireE2ESlot(50, { lockDir: dir, pollIntervalMs: 20, bypass: false })).rejects.toThrow(
      new RegExp(`pid ${process.pid}.*\\/held-by-me`),
    )
  })

  it('never removes a lock directory owned by a different pid', () => {
    const dir = freshLockDir()
    mkdirSync(dir)
    writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid + 1, cwd: '/other', startedAt: new Date().toISOString() }))

    releaseE2ESlot({ lockDir: dir, bypass: false })
    expect(existsSync(dir)).toBe(true)
  })
})
