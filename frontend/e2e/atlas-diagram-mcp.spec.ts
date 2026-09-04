import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { test, expect } from './fixtures/server'
import { connectMCPClient, enableMCPWritesWithApprovalRequired, restoreMCPWriteDefaults } from './mcpTestClient'
import { createBoardObjectViaRPC, ATLAS_DEFAULT_SPACE_ID } from './fixtures/atlasNativeDropEscapeHatch'
import { nonSeededBoardObjects } from './fixtures/atlasBoard'

// Shared worker pool (testing.md): every assertion is scoped to the one
// diagram object this test creates and deletes itself. The MCP write
// gate is a global setting, so the test restores it either way.
//
// goal 0323: a diagram is a programmable content plane -- an agent
// reads its cells by id and edits them IN PLACE through the guarded
// MCP write path, and the change reaches the person through the exact
// same doors a hand edit does: the board's own face (the existing
// mirror watch) and the open embedded editor (the protocol's 'merge').

interface BoardObjectSummary {
  id: string
  kind: string
  source: { mirrorPath?: string }
}

function makeDrawioXML(label: string): string {
  return `<mxfile host="mill-e2e"><diagram id="page1" name="Page-1"><mxGraphModel dx="800" dy="600" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="850" pageHeight="1100"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="${label}" style="rounded=0;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="120" y="120" width="160" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`
}

async function callJSON<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text?: string }>
  if (result.isError) throw new Error(`${name} failed: ${content[0]?.text ?? JSON.stringify(result.content)}`)
  return JSON.parse(content[0]?.text ?? '{}') as T
}

async function findDiagramObjectID(client: Client, mirrorPath: string): Promise<string> {
  const listed = await callJSON<{ objects: BoardObjectSummary[] }>(client, 'atlas_read_board_objects', {})
  const found = listed.objects.find((o) => o.source.mirrorPath === mirrorPath)
  if (!found) throw new Error(`no board object mirroring ${mirrorPath}`)
  return found.id
}

async function approveInReview(page: import('@playwright/test').Page, description: string): Promise<void> {
  await page.getByRole('link', { name: 'Review' }).click()
  const item = page.getByTestId('review-mcp-write-item').first()
  await expect(item).toBeVisible({ timeout: 15_000 })
  await expect(item).toContainText(description)
  await item.getByTestId('review-mcp-write-approve').click()
  await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })
}

test('an agent reads a diagram\'s cells by id, adds one through the approval gate, and the board and the open editor both show it', async ({ page }, testInfo) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mill-e2e-atlas-diagram-mcp-'))
  const file = path.join(dir, 'ZzE2eMcpDiagram.drawio')
  fs.writeFileSync(file, makeDrawioXML('Origin'))

  await enableMCPWritesWithApprovalRequired(page)
  await page.getByRole('link', { name: 'Atlas' }).click()
  await expect(page.getByTestId('atlas-board')).toBeVisible()

  // X well clear of the creation tray (atlas-diagram-live-mirror.spec.ts's
  // own placement note): a centered object's controls render behind it.
  await createBoardObjectViaRPC(page, 'diagram', { mirrorPath: file, title: 'Agent diagram' }, { X: -700, Y: 480 }, ATLAS_DEFAULT_SPACE_ID)
  await page.reload()
  await page.getByRole('link', { name: 'Atlas' }).click()

  const object = nonSeededBoardObjects(page, 'diagram')
  await expect(object).toBeVisible()
  await expect(object.locator('svg')).toContainText('Origin')

  const client = await connectMCPClient(testInfo.parallelIndex)
  try {
    const objectId = await findDiagramObjectID(client, file)

    // The read that every write depends on: real cell ids, not XML.
    const read = await callJSON<{ format: string; pages: Array<{ name: string }>; cells: Array<{ id: string; kind: string; label: string }> }>(
      client, 'atlas_read_diagram', { objectId })
    expect(read.format).toBe('drawio')
    expect(read.pages.map((p) => p.name)).toEqual(['Page-1'])
    expect(read.cells).toEqual([expect.objectContaining({ id: '2', kind: 'vertex', label: 'Origin' })])

    // The gated add: one shape and the connector joining it to the cell
    // the read just reported. The call parks; approving it in Review is
    // what executes it.
    const addPromise = client.callTool({
      name: 'atlas_diagram_add_cells',
      arguments: {
        objectId,
        cells: [
          { id: 'agent-box', kind: 'vertex', label: 'Agent added', geometry: { x: 360, y: 120, width: 160, height: 60 } },
          { kind: 'edge', label: 'leads to', source: '2', target: 'agent-box' },
        ],
      },
    })
    await approveInReview(page, 'Add 1 shape and 1 connector to Agent diagram')
    const added = await addPromise
    expect(added.isError).toBeFalsy()

    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(object.locator('svg')).toContainText('Agent added', { timeout: 10_000 })

    // The live half, with nothing navigated and nothing reloaded: the
    // approval banner renders over the board itself, so approving here
    // leaves the board mounted and the face must still catch up --
    // through the existing mirror watch, never a second signal.
    const editPromise = client.callTool({
      name: 'atlas_diagram_edit_cells',
      arguments: { objectId, patches: [{ id: 'agent-box', label: 'Agent renamed' }] },
    })
    const banner = page.getByTestId('mcp-write-approval-banner')
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await expect(banner).toContainText('Edit 1 cell in Agent diagram')
    await banner.getByRole('button', { name: 'Approve' }).click()
    const edited = await editPromise
    expect(edited.isError).toBeFalsy()
    await expect(object.locator('svg')).toContainText('Agent renamed', { timeout: 10_000 })
    await expect(object.locator('svg')).toContainText('Origin')

    // The embedded editor opens on the agent's own edit -- the file IS
    // the shared artifact (ADR-0046), so the hand-editing door sees
    // exactly what the programmatic one wrote.
    await object.dblclick()
    const dialog = page.getByRole('dialog', { name: 'ZzE2eMcpDiagram.drawio' })
    await expect(dialog).toBeVisible()
    const frame = page.frameLocator('[data-testid="drawio-editor-frame"]')
    await expect(frame.getByText('Agent renamed', { exact: true })).toBeVisible({ timeout: 20_000 })

    // ...and a change that lands while the editor is ALREADY open
    // reaches it too, through the protocol's own 'merge' rather than a
    // reload that would discard whatever the person was mid-way
    // through. Driven here as a direct file write -- the identical
    // "atlas-mirror-changed" door a guarded MCP write arrives by (the
    // approval banner is unreachable behind this modal, so the gated
    // half of that same path is proven above instead).
    fs.writeFileSync(file, makeDrawioXML('Landed while open'))
    await expect(frame.getByText('Landed while open', { exact: true })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).not.toBeVisible()

    // Delete takes the dangling connector with it, and says which.
    const restored = await callJSON<{ cells: Array<{ id: string }> }>(client, 'atlas_read_diagram', { objectId })
    expect(restored.cells.map((c) => c.id)).toEqual(['2'])
    const deletePromise = client.callTool({
      name: 'atlas_diagram_delete_cells',
      arguments: { objectId, ids: ['2'] },
    })
    await expect(banner).toBeVisible({ timeout: 15_000 })
    await expect(banner).toContainText('Delete 1 cell from Agent diagram')
    await banner.getByRole('button', { name: 'Approve' }).click()
    const deleted = await deletePromise
    const deletedContent = deleted.content as Array<{ type: string; text?: string }>
    expect(deleted.isError).toBeFalsy()
    expect(JSON.parse(deletedContent[0]?.text ?? '{}')).toEqual(
      expect.objectContaining({ deleted: ['2'], edgesRemoved: [] }))
    await expect(object.locator('svg')).not.toContainText('Landed while open', { timeout: 10_000 })
  } finally {
    await client.close()
    await page.getByRole('link', { name: 'Atlas' }).click()
    await object.click({ button: 'right' })
    const menu = page.getByTestId('context-menu')
    await expect(menu).toBeVisible()
    await menu.getByText('Delete', { exact: true }).click()
    await expect(object).not.toBeVisible()
    await restoreMCPWriteDefaults(page)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
