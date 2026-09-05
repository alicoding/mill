// A secret source an extension contributes (goal 0306 S4): the Netrc
// example declares a store, the Sources page offers it as a kind with
// the path field its manifest declares, its keys become secrets by
// name, and an entry can point at one instead of holding a value.
// Dedicated server (launchWithPlugins with the example added) --
// the shared pool has no plugins directory.
import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { callBindingViaRPC } from './fixtures/wailsRpc'
import { SECRET_SOURCE_PLUGIN_SERVER_BASE_PORT, SECRET_SOURCE_PLUGIN_MCP_BASE_PORT } from './fixtures/serverPorts'
import { openSecretSources, openSecrets, ensureVault } from './fixtures/secretStore'

const SECRETS = 'github.com/alicoding/mill/internal/services/secretsvc.SecretService.'
const PORTS = { server: SECRET_SOURCE_PLUGIN_SERVER_BASE_PORT, mcp: SECRET_SOURCE_PLUGIN_MCP_BASE_PORT }
const NETRC_KIND = 'plugin:netrc-secrets/netrc'

test('an extension-contributed secret source lists its keys by name and an entry can point at one', async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-netrc-'))
	const netrcPath = path.join(dir, '.netrc')
	fs.writeFileSync(netrcPath, 'machine api.example.com\n  login alice\n  password tok-e2e-netrc\n')
	const { page, close } = await launchWithPlugins(0, { extraExamples: ['netrc-secrets'], ports: PORTS })
	try {
		await page.goto('/')
		await openSecretSources(page)
		await expect(page.getByTestId('configure-secretsources')).toBeVisible()

		// The extension's own kind is offered after the built-ins, and
		// picking it renders the path field the manifest declares.
		await page.getByTestId('new-secretsource').click()
		await page.getByTestId('secretsource-label').fill('ZzE2eNetrc')
		await page.getByTestId('secretsource-kind').selectOption(NETRC_KIND)
		await expect(page.getByText('From Netrc file')).toBeVisible()
		await expect(page.getByTestId('secretsource-path')).toHaveAttribute('placeholder', '~/.netrc')
		await expect(page.getByTestId('secretsource-path')).toHaveValue('~/.netrc')
		await page.getByTestId('secretsource-path').fill(netrcPath)
		await page.getByTestId('save-secretsource').click()

		const row = page.locator('[data-testid="inventory-row"][data-entity="secretsource"]').filter({ hasText: 'ZzE2eNetrc' })
		await expect(row).toBeVisible()
		await expect(row).toContainText('Netrc file')

		// Its keys are secrets now, by title -- never a value.
		const listed = await callBindingViaRPC<{ ID: string; Title: string }[]>(page, SECRETS + 'ListProviderSecrets', [])
		const mine = listed.filter((s) => s.Title.endsWith('— ZzE2eNetrc'))
		expect(mine.map((s) => s.Title)).toEqual(['api.example.com/login — ZzE2eNetrc', 'api.example.com/password — ZzE2eNetrc'])
		expect(mine[0].ID).toMatch(/^plugin:[a-z0-9-]+\/api\.example\.com\/login$/)
		expect(JSON.stringify(listed)).not.toContain('tok-e2e-netrc')

		// An entry points at one of those keys instead of holding a value.
		// The vault is unlocked through the same bound methods the
		// unlock gesture calls (the harness cannot perform it), so the
		// page is reloaded to pick the open vault up.
		await ensureVault(page)
		await page.reload()
		await openSecrets(page)
		await page.getByTestId('secrets-section-vault').click()
		await page.getByTestId('secrets-new').click()
		await page.getByTestId('secret-title-input').fill('ZzE2eNetrcBacked')
		await page.getByTestId('secret-storage-source').click()
		await page.getByTestId('secret-source-select').selectOption({ label: 'api.example.com/password — ZzE2eNetrc' })
		await page.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(page.getByText('ZzE2eNetrcBacked', { exact: true })).toBeVisible()
	} finally {
		await close()
		fs.rmSync(dir, { recursive: true, force: true })
	}
})
