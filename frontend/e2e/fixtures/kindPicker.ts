import type { Locator, Page } from '@playwright/test'

// The shared kind picker (goal 0081 slice A2's "kind picker
// legibility" rider, frontend/src/atlas/KindPicker.tsx) replaced every
// bare native <select> a Kind was chosen through -- including
// AtlasCreateMenu.tsx's own (slice A5 rider (c)) -- with a rich
// local-state disclosure. This opens the picker button and clicks the
// option by its stable seeded kind id (KindPicker's own
// `${testId}-option-${kindID}` testid), scoped within `container`
// since the option list renders in place, not through a portal.
// testId defaults to the placement popover's own instance (the most
// common caller); AtlasCreateMenu's instance passes 'atlas-create-kind'.
export async function selectKind(container: Locator | Page, kindID: string, testId = 'atlas-placement-kind'): Promise<void> {
  await container.getByTestId(testId).click()
  await container.getByTestId(`${testId}-option-${kindID}`).click()
}

// internal/domain/atlas/builtin.go's own stable seeded kind ids.
export const ATLAS_KIND_TOPIC = 'atlas-kind-topic'
export const ATLAS_KIND_CONTACT = 'atlas-kind-contact'
export const ATLAS_KIND_DOCUMENT = 'atlas-kind-document'
