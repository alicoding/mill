import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { test, expect } from './fixtures/server'
import { connectMCPClient, enableMCPWritesWithApprovalRequired, restoreMCPWriteDefaults } from './mcpTestClient'
import { deleteViaPageMenu } from './fixtures/atlasPage'

// Atlas over MCP's guarded write (goal 0083): atlas_propose_card_write
// parks through the SAME ADR-0032 pending-write queue import_workflow/
// update_workflow already use -- mcp-write-approval.spec.ts's own
// harness pattern, followed exactly here rather than a second shape.
// Review/the approval banner render purely off the pending write's own
// description string (ReviewView.tsx/MCPWriteApprovals.tsx have no
// per-tool special-casing), so no additive UI was needed for this to
// show up correctly.

interface AtlasListKindsResult {
  kinds: Array<{ id: string; name: string }>
}

async function findKindIdByLabel(client: Client, label: string): Promise<string> {
  const result = await client.callTool({ name: 'atlas_list_kinds', arguments: {} })
  if (result.isError) throw new Error(`atlas_list_kinds failed: ${JSON.stringify(result.content)}`)
  const content = result.content as Array<{ type: string; text?: string }>
  const parsed = JSON.parse(content[0]?.text ?? '{}') as AtlasListKindsResult
  const found = parsed.kinds.find((k) => k.name === label)
  if (!found) throw new Error(`kind "${label}" not found in atlas_list_kinds: ${content[0]?.text}`)
  return found.id
}

test('a parked atlas card write appears as a Review row; approving creates the card, denying a second proposal writes nothing', async ({ page }, testInfo) => {
  await enableMCPWritesWithApprovalRequired(page)

  const client = await connectMCPClient(testInfo.parallelIndex)
  try {
    const topicKindId = await findKindIdByLabel(client, 'Topic')
    const title = 'E2E MCP atlas card'

    const proposePromise = client.callTool({
      name: 'atlas_propose_card_write',
      arguments: { kindId: topicKindId, title, note: 'created by an MCP e2e test' },
    })

    await page.getByRole('link', { name: 'Review' }).click()
    const item = page.getByTestId('review-mcp-write-item').first()
    await expect(item).toBeVisible({ timeout: 15_000 })
    await expect(item).toContainText(`CREATE card "${title}"`)

    await item.getByTestId('review-mcp-write-approve').click()
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })

    const result = await proposePromise
    if (result.isError) {
      throw new Error(`atlas_propose_card_write ultimately errored after approval: ${JSON.stringify(result.content)}`)
    }

    // The write actually executed: the card is visible in Atlas, found
    // via the same ⌘K jump dialog atlas-jump.spec.ts's own suite proves
    // (Meta+Enter jumps straight to the card overlay, no pulse step).
    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await page.keyboard.press('Meta+k')
    await page.getByTestId('atlas-jump-input').fill(title)
    await expect(page.locator('[data-component="atlas-jump-dialog"]').getByTestId('atlas-jump-result')).toHaveCount(1)
    await page.keyboard.press('Meta+Enter')
    const overlay = page.locator('[data-component="atlas-card-overlay"]')
    await expect(overlay).toBeVisible()
    await expect(overlay).toContainText(title)

    // Cleanup the created card now (testing.md's within-file discipline)
    // rather than at the end, so a failure in the deny-path half below
    // never leaves it behind.
    await deleteViaPageMenu(page, overlay)
    await expect(overlay).toHaveCount(0)

    // Deny path: a second proposal, never written.
    const deniedTitle = 'E2E MCP atlas card (denied)'
    const denyPromise = client.callTool({
      name: 'atlas_propose_card_write',
      arguments: { kindId: topicKindId, title: deniedTitle },
    })
    await page.getByRole('link', { name: 'Review' }).click()
    const denyItem = page.getByTestId('review-mcp-write-item').first()
    await expect(denyItem).toBeVisible({ timeout: 15_000 })
    await expect(denyItem).toContainText(`CREATE card "${deniedTitle}"`)
    await denyItem.getByTestId('review-mcp-write-deny').click()
    await expect(page.getByTestId('review-mcp-write-item')).toHaveCount(0, { timeout: 10_000 })

    const denyResult = await denyPromise
    if (!denyResult.isError) {
      throw new Error('a denied atlas_propose_card_write must return an error result')
    }

    await page.getByRole('link', { name: 'Atlas' }).click()
    await expect(page.getByTestId('atlas-board')).toBeVisible()
    await page.keyboard.press('Meta+k')
    await page.getByTestId('atlas-jump-input').fill(deniedTitle)
    await expect(page.getByTestId('atlas-jump-no-matches')).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    await client.close()
  }

  await restoreMCPWriteDefaults(page)
})
