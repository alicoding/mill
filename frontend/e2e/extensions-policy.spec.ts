// The organisation's extension policy (goal 0349 S6): a policy file
// on the machine decides what installs and runs, and every surface
// says so -- the banner, the blocked row and its reason, the refused
// install prompt, the Verification tab's policy line, and the read-only
// summary under Settings > Security. A file that cannot be read closes
// the door on every non-built-in extension.
//
// Dedicated server pair (EXTENSIONS_POLICY_*): the policy changes what
// every Extensions row and install prompt says, which is global state.
import { expect, test } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { EXTENSIONS_POLICY_SERVER_BASE_PORT, EXTENSIONS_POLICY_MCP_BASE_PORT } from './fixtures/serverPorts'
import { gotoAppReady } from './fixtures/appReady'
import { openExtensions, openPluginDetail, openSettings, pluginRow } from './fixtures/settingsNav'

const PORTS = { server: EXTENSIONS_POLICY_SERVER_BASE_PORT, mcp: EXTENSIONS_POLICY_MCP_BASE_PORT }

const BANK_POLICY = {
	version: 1,
	managedBy: 'Example Bank',
	block: [{ id: 'mill-scribble' }, { id: 'mill-textcase' }],
	blockedCapabilities: ['open-url'],
}

function writePolicyFile(body: string): { path: string; dir: string } {
	const dir = mkdtempSync(path.join(tmpdir(), 'mill-policy-e2e-'))
	const file = path.join(dir, 'plugin-policy.json')
	writeFileSync(file, body)
	return { path: file, dir }
}

test('a managed Mac says who manages it, lists a blocked extension with its reason, and names the policy on Verification', async () => {
	const policy = writePolicyFile(JSON.stringify(BANK_POLICY))
	const { page, close } = await launchWithPlugins(0, { ports: PORTS, extraEnv: { MILL_PLUGIN_POLICY: policy.path } })
	try {
		await gotoAppReady(page)
		await openExtensions(page, 'installed')

		const banner = page.getByTestId('extensions-policy-banner')
		await expect(banner).toBeVisible()
		await expect(banner).toContainText('Managed by Example Bank')
		await expect(banner).toContainText('Your organisation decides which extensions can be installed.')

		// Blocked by id: listed, marked, never running.
		const scribble = pluginRow(page, 'mill-scribble')
		await expect(scribble.getByTestId('extensions-row-policy')).toHaveText("Blocked by your organisation's policy")
		await expect(scribble.getByTestId('extensions-plugin-toggle')).toHaveCount(0)
		const scribbleDetail = await openPluginDetail(page, 'mill-scribble')
		await expect(scribbleDetail.getByTestId('extensions-plugin-policy')).toContainText("Blocked by your organisation's policy.")
		await expect(scribbleDetail.getByTestId('extensions-plugin-policy-reason')).toHaveText('Your organisation blocks this extension.')

		// Blocked by a capability the manifest declares.
		const bookmarkDetail = await openPluginDetail(page, 'mill-bookmark')
		await expect(bookmarkDetail.getByTestId('extensions-plugin-policy-reason')).toHaveText('Your organisation blocks extensions that can open links.')

		// An allowed extension says so on its Verification tab.
		const indexDetail = await openPluginDetail(page, 'mill-index', 'verification')
		await expect(indexDetail.getByTestId('extensions-verification-policy')).toHaveText("Allowed by Example Bank's policy.")

		// A blocked one names the reason there too.
		const blockedDetail = await openPluginDetail(page, 'mill-scribble', 'verification')
		await expect(blockedDetail.getByTestId('extensions-verification-policy')).toContainText("Blocked by your organisation's policy. Your organisation blocks this extension.")
	} finally {
		await close()
		rmSync(policy.dir, { recursive: true, force: true })
	}
})

test('an install the policy refuses stops in the prompt with the reason, and Settings > Security shows the policy read-only', async () => {
	const policy = writePolicyFile(JSON.stringify(BANK_POLICY))
	const { page, close } = await launchWithPlugins(2, { ports: PORTS, extraEnv: { MILL_PLUGIN_POLICY: policy.path } })
	try {
		await gotoAppReady(page)
		await openExtensions(page, 'browse')
		const entry = page.locator('[data-testid="extensions-browse-row"][data-plugin-id="mill-textcase"]')
		await entry.getByTestId('extensions-browse-install').click()

		const dialog = page.getByTestId('extensions-install-dialog')
		await expect(dialog).toBeVisible()
		await expect(dialog.getByTestId('extensions-install-refusal')).toContainText("Your organisation's policy doesn't allow this extension.")
		await expect(dialog.getByTestId('extensions-install-refusal-reason')).toHaveText('Your organisation blocks this extension.')
		await expect(page.getByRole('dialog').getByRole('button', { name: 'Install', exact: true })).toBeDisabled()
		await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()

		await openSettings(page, 'security')
		const section = page.getByTestId('settings-extension-policy')
		await expect(section.getByTestId('settings-extension-policy-managed-by')).toHaveText('Example Bank')
		await expect(section.getByTestId('settings-extension-policy-tier')).toHaveText('Any')
		await expect(section.getByTestId('settings-extension-policy-capabilities')).toHaveText('Open links')
		await expect(section.getByTestId('settings-extension-policy-sources')).toHaveText('Any source')
		await expect(section.getByTestId('settings-extension-policy-path')).toHaveText(policy.path)
	} finally {
		await close()
		rmSync(policy.dir, { recursive: true, force: true })
	}
})

test('a policy file that cannot be read blocks every installed extension and says why', async () => {
	const policy = writePolicyFile('{"version": 1,')
	const { page, close } = await launchWithPlugins(4, { ports: PORTS, extraEnv: { MILL_PLUGIN_POLICY: policy.path } })
	try {
		await gotoAppReady(page)
		await openExtensions(page, 'installed')
		const banner = page.getByTestId('extensions-policy-banner')
		await expect(banner).toContainText('Extensions are blocked')
		await expect(banner).toContainText("The extension policy file can't be read. Ask your administrator.")
		await expect(pluginRow(page, 'mill-index').getByTestId('extensions-row-policy')).toHaveText("Blocked by your organisation's policy")
		const detail = await openPluginDetail(page, 'mill-index')
		await expect(detail.getByTestId('extensions-plugin-policy-reason')).toHaveText("The extension policy file can't be read. Ask your administrator.")
	} finally {
		await close()
		rmSync(policy.dir, { recursive: true, force: true })
	}
})
