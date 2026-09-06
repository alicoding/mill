import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

// Configure navigation (goal 0116): the page renders one kind's pane
// at a time, chosen from a grouped rail (configure/ConfigureKindNav.tsx),
// so reaching an entity means naming its kind. Labels are the rail's
// own accessible names; the pane test id is `configure-pane-<kind>`
// (shared/configureKinds.ts's ids).
export type ConfigureKindLabel =
  | 'Integrations' | 'MCP Servers' | 'AI Providers' | 'Certificates'
  | 'Environments' | 'Execution Environments'
  | 'Lists' | 'Attributes' | 'Conversion profiles'
  | 'Decisions' | 'Step types'

const KIND_BY_LABEL: Record<ConfigureKindLabel, string> = {
  Integrations: 'integration',
  'MCP Servers': 'mcpservers',
  'AI Providers': 'aiproviders',
  Certificates: 'certificates',
  Environments: 'environments',
  'Execution Environments': 'execenvs',
  Lists: 'lists',
  Attributes: 'attributes',
  'Conversion profiles': 'conversionprofiles',
  Decisions: 'decisions',
  'Step types': 'steptypes',
}

export function configureKindNav(page: Page): Locator {
  return page.getByTestId('configure-kind-nav')
}

// The rail item for one kind. exact: "Environments" is a prefix of
// "Execution Environments" only by accident of wording, never a match.
export function configureKindLink(page: Page, label: ConfigureKindLabel): Locator {
  return configureKindNav(page).getByRole('link', { name: label, exact: true })
}

export function configurePane(page: Page, label: ConfigureKindLabel): Locator {
  return page.getByTestId(`configure-pane-${KIND_BY_LABEL[label]}`)
}

// Selects a kind on an already-open Configure page and waits for its
// pane to be visible AND past its first fetch. The caller opens
// Configure itself (the sidebar link), the same way it did before the
// rail replaced the tab strip.
//
// A kind's pane mounts the first time it is selected, so its entities
// arrive AFTER the pane does: a caller that counted rows on the frame
// the pane appeared would read zero and call the inventory empty.
// `configure-loading` is the pane's own first-load marker
// (configure/ConfigureEntityPage.tsx); a pane that renders no such
// marker is settled the moment it is visible.
export async function openConfigureKind(page: Page, label: ConfigureKindLabel): Promise<void> {
  await configureKindLink(page, label).click()
  const pane = configurePane(page, label)
  await expect(pane).toBeVisible()
  await expect(pane.getByTestId('configure-loading')).toHaveCount(0)
}
