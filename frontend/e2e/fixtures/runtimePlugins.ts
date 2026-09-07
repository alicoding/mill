import { chromium, expect, type Page } from '@playwright/test'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnMillServer, type SpawnedServer } from './server'
import { RUNTIME_PLUGINS_SERVER_BASE_PORT, RUNTIME_PLUGINS_MCP_BASE_PORT } from './serverPorts'

// The runtime-plugin e2e harness (docs/goals/0249), promoted from
// runtime-plugins.spec.ts once a second spec (runtime-plugin-doors)
// needed it (testing.md's promotion rule). Each caller gets a
// DEDICATED server whose plugins dir is a per-test COPY of
// examples/plugins -- the exact artifact a user copies from -- plus
// optional fixture plugins. Callers pick disjoint port OFFSETS: the
// original spec uses 0-8, the doors spec 10+.
//
// Picking an offset: the two bases are 20 apart, so offset o's SERVER
// port is offset o-20's MCP port. A new offset o is safe only when
// o, o-20 and o+20 are all unclaimed, and its own two ports fall
// outside every other family's base in serverPorts.ts.
export const EXAMPLES_PLUGINS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'examples', 'plugins')

// The example plugins every caller gets. Named here rather than copied
// line by line below so a spec asserting how many rows the Installed
// list shows can read the number off THIS list instead of keeping its
// own literal in step with it (the returned installedIds).
const SHARED_EXAMPLE_PLUGIN_IDS = ['mill-bookmark', 'mill-scribble', 'mill-index', 'mill-request-tester', 'mill-markmap']

// ExtraPlugin -- a fixture plugin a test writes into the copied
// plugins dir before boot: a manifest object and a main.js source.
export interface ExtraPlugin {
	id: string
	manifest: Record<string, unknown>
	main: string
	// Further files the folder ships, keyed by name: a framed view's or
	// capture's entry page and the script beside it (goal 0349).
	files?: Record<string, string>
}

// extraExamples names further example folders to copy in (a plugin
// that claims a gesture another example also claims stays out of the
// shared set, so the other specs keep their claimant).
// settings pre-seeds Mill's settings file before boot (the store is one
// JSON object of key -> JSON-encoded string), the way policy tooling
// writes an administrator's plugin allow-list.
// ports overrides the shared runtime-plugins bases with a spec's own
// dedicated pair (offset still applies within it), for a spec that
// wants out of the offset arithmetic above.
// extraEnv reaches the spawned server as further environment (the
// extension policy spec's MILL_PLUGIN_POLICY path).
export async function launchWithPlugins(offset: number, opts: { withBroken?: boolean; withNotifier?: boolean; extraPlugins?: ExtraPlugin[]; extraExamples?: string[]; settings?: Record<string, string>; ports?: { server: number; mcp: number }; extraEnv?: Record<string, string> } = {}) {
	const dir = mkdtempSync(path.join(tmpdir(), 'mill-plugins-e2e-'))
	// The plugins dir is a per-test COPY of examples/plugins (the exact
	// artifact a user copies from) -- never the repo folder itself, so
	// a test can add a deliberately-broken sibling without touching it.
	const pluginsDir = path.join(dir, 'plugins')
	mkdirSync(pluginsDir, { recursive: true })
	const installedIds = [...SHARED_EXAMPLE_PLUGIN_IDS, ...(opts.extraExamples ?? [])]
	for (const id of installedIds) cpSync(path.join(EXAMPLES_PLUGINS_DIR, id), path.join(pluginsDir, id), { recursive: true })
	if (opts.withBroken) {
		mkdirSync(path.join(pluginsDir, 'broken-one'))
		writeFileSync(path.join(pluginsDir, 'broken-one', 'manifest.json'), '{not json')
	}
	for (const extra of opts.extraPlugins ?? []) {
		mkdirSync(path.join(pluginsDir, extra.id))
		writeFileSync(path.join(pluginsDir, extra.id, 'manifest.json'), JSON.stringify({ id: extra.id, version: '1.0.0', ...extra.manifest }))
		writeFileSync(path.join(pluginsDir, extra.id, 'main.js'), extra.main)
		for (const [name, body] of Object.entries(extra.files ?? {})) writeFileSync(path.join(pluginsDir, extra.id, name), body)
	}
	if (opts.withNotifier) {
		// A minimal plugin exercising the notice door (goal 0277): one
		// registered command that notifies, run from the palette.
		mkdirSync(path.join(pluginsDir, 'notify-probe'))
		writeFileSync(path.join(pluginsDir, 'notify-probe', 'manifest.json'), JSON.stringify({ id: 'notify-probe', name: 'Notify probe', version: '1.0.0' }))
		writeFileSync(path.join(pluginsDir, 'notify-probe', 'main.js'), `export function activate(api) {
	api.registerCommand({ id: 'hello', label: 'Say hello from the probe', run: () => { api.notify({ level: 'warning', text: 'Hello from the probe.' }) } })
}
`)
	}
	if (opts.settings) writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(opts.settings))
	const serverPort = (opts.ports?.server ?? RUNTIME_PLUGINS_SERVER_BASE_PORT) + offset
	const server: SpawnedServer = await spawnMillServer({
		port: serverPort,
		mcpPort: (opts.ports?.mcp ?? RUNTIME_PLUGINS_MCP_BASE_PORT) + offset,
		settingsPath: path.join(dir, 'settings.json'),
		executionDbPath: path.join(dir, 'exec.db'),
		backupDir: path.join(dir, 'backups'),
		extraEnv: { ...(opts.extraEnv ?? {}), MILL_PLUGINS_DIR: pluginsDir },
	})
	const browser = await chromium.launch()
	const context = await browser.newContext({ baseURL: `http://127.0.0.1:${serverPort}` })
	const page = await context.newPage()
	return {
		page,
		pluginsDir,
		// What this harness put on disk, in copy order: the door a count
		// assertion reads instead of restating the number.
		installedIds,
		async close() {
			await browser.close()
			await server.stop()
			rmSync(dir, { recursive: true, force: true })
		},
	}
}

// runFromPalette -- the one way these tests fire a plugin command: the
// palette's own binding, the command by its registered label.
//
// exact: accessible-name matching is substring by default, and the
// palette holds commands whose labels CONTAIN a plugin's label (each
// plugin's own "Reload <name>", goal 0319) -- without it the click
// hits a strict-mode violation instead of the intended row.
export async function runFromPalette(page: Page, label: string) {
	await page.keyboard.press('Meta+/')
	const dialog = page.getByRole('dialog', { name: 'Command palette' })
	await expect(dialog).toBeVisible()
	await dialog.getByRole('combobox').fill(label)
	await dialog.getByRole('option', { name: label, exact: true }).click()
}

