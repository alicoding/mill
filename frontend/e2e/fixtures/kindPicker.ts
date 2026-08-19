import type { Locator, Page } from '@playwright/test'

// The shared kind picker (goal 0081 slice A2's "kind picker
// legibility" rider, frontend/src/atlas/KindPicker.tsx) replaced every
// bare native <select> a Kind was chosen through -- including
// AtlasCreateMenu.tsx's own (slice A5 rider (c)) -- with a rich
// disclosure. This opens the picker button and clicks the option by
// its stable seeded kind id (KindPicker's own
// `${testId}-option-${kindID}` testid). The trigger click stays scoped
// to `container`; the option click is resolved against the whole page
// (goal 0124 slice 2 rebuilt the option list on Primer's Overlay,
// which portals to document.body -- outside `container`'s own DOM
// subtree whenever container is a popover/dialog, not the page root).
// testId defaults to the placement popover's own instance (the most
// common caller); AtlasCreateMenu's instance passes 'atlas-create-kind'.
export async function selectKind(container: Locator | Page, kindID: string, testId = 'atlas-placement-kind'): Promise<void> {
  await container.getByTestId(testId).click()
  const page = typeof (container as Locator).page === 'function' ? (container as Locator).page() : (container as Page)
  await page.getByTestId(`${testId}-option-${kindID}`).click()
}

// internal/domain/atlas/builtin.go's own stable seeded kind ids.
export const ATLAS_KIND_TOPIC = 'atlas-kind-topic'
export const ATLAS_KIND_CONTACT = 'atlas-kind-contact'
export const ATLAS_KIND_DOCUMENT = 'atlas-kind-document'
