import { expect, type Locator } from '@playwright/test'

// The step inspector's three tiers (goal 0327): Parameters is open on
// every new selection, so a spec reaching a step's behaviour or its
// test surface opens that tab first -- the same click a user makes.
export type InspectorTab = 'parameters' | 'settings' | 'test'

export async function openInspectorTab(panel: Locator, tab: InspectorTab): Promise<void> {
	const button = panel.getByTestId(`inspector-tab-${tab}`)
	await expect(button).toBeVisible()
	await button.click()
}
