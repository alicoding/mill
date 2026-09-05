import type { Page } from '@playwright/test'
import { callBindingViaRPC } from './wailsRpc'

// The secret store, reached without the vault-unlock gesture the
// harness cannot perform (goal 0306). Every secret-shaped field on a
// Configure entity now names an entry, so a spec that used to type a
// token has to have one to point at first; this creates one through the
// same bound methods the UI calls, then returns the REFERENCE the field
// stores.
//
// Used by 2+ files, so it lives here per .claude/rules/testing.md.

const SECRETS = 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.'

// ensureVault sets up and unlocks the store if this server has never
// had one. Idempotent: a second call on an open vault does nothing.
export async function ensureVault(page: Page): Promise<void> {
  const status = await callBindingViaRPC<{ Exists: boolean; Unlocked: boolean }>(page, SECRETS + 'VaultStatus', [])
  if (!status.Exists) {
    await callBindingViaRPC(page, SECRETS + 'SetupVault', [])
  }
  const after = await callBindingViaRPC<{ Unlocked: boolean }>(page, SECRETS + 'VaultStatus', [])
  if (!after.Unlocked) {
    await callBindingViaRPC(page, SECRETS + 'UnlockVault', [])
  }
}

// createSecret stores one entry and returns the reference a Configure
// entity's field holds for it. kind is secret.Kind's wire value
// ('text', 'key', 'certificate', 'file').
export async function createSecret(page: Page, title: string, value: string, kind = 'text'): Promise<string> {
  await ensureVault(page)
  const created = await callBindingViaRPC<{ ID: string }>(page, SECRETS + 'CreateSecret', [title, '', value, '', '', '', kind, ''])
  return `vault:${created.ID}`
}

// deleteSecret removes an entry a spec created. Within-file cleanup
// discipline: delete what you create.
export async function deleteSecret(page: Page, reference: string): Promise<void> {
  await callBindingViaRPC(page, SECRETS + 'DeleteSecret', [reference.replace(/^vault:/, '')])
}

// secretTitles is what a picker would list, so a spec can assert an
// entry is offered (or is not) without driving the select itself.
export async function secretTitles(page: Page): Promise<{ ID: string; Title: string; Kind: string }[]> {
  return callBindingViaRPC<{ ID: string; Title: string; Kind: string }[]>(page, SECRETS + 'ListSecrets', [])
}

// openSecrets navigates to the Secrets page and clears the first-run
// intro if this server has never shown it -- a modal that would
// otherwise swallow the first click of any spec that lands here
// (shared/FirstRunIntro.tsx, goal 0202).
export async function openSecrets(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Secrets' }).click()
  await page.getByTestId('secrets-view').waitFor()
  await dismissSecretsIntro(page)
}

// dismissSecretsIntro clears the intro if it is on screen. The dialog
// mounts a moment after the view does, so a bare isVisible() can miss
// it and leave a backdrop that swallows the next click; waiting for it
// with a short timeout and treating the timeout as "already seen" is
// what makes this safe on both a fresh and a reused server.
async function dismissSecretsIntro(page: Page): Promise<void> {
  const intro = page.getByRole('dialog', { name: 'Keep credentials out of your workflows' })
  try {
    await intro.waitFor({ state: 'visible', timeout: 3000 })
  } catch {
    return
  }
  await intro.getByRole('button', { name: 'Got it' }).click()
  await intro.waitFor({ state: 'detached' })
}

// openSecretSources lands on the Sources section, which is reachable
// whether or not this server's vault is unlocked.
export async function openSecretSources(page: Page): Promise<void> {
  await openSecrets(page)
  await page.getByTestId('secrets-section-sources').click()
}
