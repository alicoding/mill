import { expect, test } from '@playwright/test'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { launchWithPlugins } from './fixtures/runtimePlugins'
import { connectMCPClient } from './mcpTestClient'
import { RUNTIME_PLUGIN_MCP_SERVER_BASE_PORT, RUNTIME_PLUGIN_MCP_MCP_BASE_PORT } from './fixtures/serverPorts'
import { openSettings, pluginRow } from './fixtures/settingsNav'

// Plugin contributions over MCP (goal 0324): what a person can reach
// in the app, an agent can reach over the wire -- through the real MCP
// transport against the real server, with the real example plugins.
// Dedicated server per test, the same reason every runtime-plugin spec
// has one (MILL_PLUGINS_DIR is process-wide) and because the tool list
// itself is global state; dedicated port pair, offsets 0/2/4 within it.

const PORTS = { server: RUNTIME_PLUGIN_MCP_SERVER_BASE_PORT, mcp: RUNTIME_PLUGIN_MCP_MCP_BASE_PORT }

async function toolNames(client: Client): Promise<string[]> {
	return (await client.listTools()).tools.map((t) => t.name)
}

function firstText(result: Awaited<ReturnType<Client['callTool']>>): string {
	const content = result.content as { type: string; text?: string }[]
	return content[0]?.text ?? ''
}

test('list_plugins reports the installed plugins and their declared tools become callable', async () => {
	const { page, close } = await launchWithPlugins(0, { ports: PORTS, extraExamples: ['mill-textcase'] })
	const client = await connectMCPClient(0, PORTS.mcp)
	try {
		await page.goto('/')

		const listed = JSON.parse(firstText(await client.callTool({ name: 'list_plugins', arguments: {} }))) as {
			id: string
			enabled: boolean
			contributions: { steps: string[]; tools: string[] }
		}[]
		const textcase = listed.find((p) => p.id === 'mill-textcase')
		expect(textcase, 'mill-textcase is listed').toBeTruthy()
		expect(textcase!.enabled).toBe(true)
		expect(textcase!.contributions.steps).toContain('text-case')
		expect(textcase!.contributions.tools).toContain('change_text_case')

		expect(await toolNames(client)).toContain('plugin_mill-textcase_change_text_case')

		const ran = await client.callTool({ name: 'plugin_mill-textcase_change_text_case', arguments: { text: 'hello there', mode: 'upper' } })
		expect(ran.isError ?? false).toBe(false)
		expect(firstText(ran)).toBe('HELLO THERE')
	} finally {
		await client.close()
		await close()
	}
})

test('turning a plugin off in Settings removes its tool from the MCP tool list, with no restart', async () => {
	const { page, close } = await launchWithPlugins(2, { ports: PORTS, extraExamples: ['mill-textcase'] })
	const client = await connectMCPClient(0, PORTS.mcp + 2)
	try {
		await page.goto('/')
		expect(await toolNames(client)).toContain('plugin_mill-textcase_change_text_case')

		await openSettings(page, 'extensions')
		const row = pluginRow(page, 'mill-textcase')
		await row.scrollIntoViewIfNeeded()
		await row.locator('[data-testid="extensions-plugin-toggle"]').click()

		await expect.poll(() => toolNames(client)).not.toContain('plugin_mill-textcase_change_text_case')
		// Gone from the server entirely, not merely refused: calling it
		// now is calling a tool that does not exist.
		await expect(client.callTool({ name: 'plugin_mill-textcase_change_text_case', arguments: { text: 'x', mode: 'upper' } }))
			.rejects.toThrow(/unknown tool/)
	} finally {
		await client.close()
		await close()
	}
})

test('a command-kind tool runs the plugin\'s own registered command in the open window', async () => {
	const { page, close } = await launchWithPlugins(4, { ports: PORTS })
	const client = await connectMCPClient(0, PORTS.mcp + 4)
	try {
		// The bridge only answers from a loaded main window -- that is
		// the point of a command tool: it runs what the person's own
		// palette entry runs, in the page where the plugin is live.
		await page.goto('/')
		await expect(page.getByRole('link', { name: 'Atlas' })).toBeVisible()

		expect(await toolNames(client)).toContain('plugin_mill-index_refresh_board_index')
		const ran = await client.callTool({ name: 'plugin_mill-index_refresh_board_index', arguments: {} })
		expect(ran.isError ?? false).toBe(false)
		expect(firstText(ran)).toContain('Refresh the board index')
	} finally {
		await client.close()
		await close()
	}
})
