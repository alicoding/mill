import { expect, type Page } from '@playwright/test'

// main.tsx's bootstrap() renders <App/> only after an async,
// deadline-raced plugin-load chain (docs/goals/0249) -- page.goto()
// resolving is a network/navigation event, not "the app mounted". A
// test whose FIRST action is a keyboard shortcut can race ahead of
// App.tsx's useKeymapDispatch, whose window keydown listener isn't
// attached until that later render commits. App.tsx marks the moment
// its own listeners are attached with a data-app-ready attribute on
// <html> (see App.tsx's own comment on the effect) -- this is that
// mount barrier, for every spec whose first drive is a shortcut.
export async function gotoAppReady(page: Page, path = '/'): Promise<void> {
  await page.goto(path)
  await waitForAppReady(page)
}

// Split out for a helper that presses a shortcut but doesn't own
// navigation itself (e.g. docs-view.spec.ts's openDocsSearch, called
// from a test that already navigated) -- it awaits the same mount
// barrier right before its own first keypress instead.
export async function waitForAppReady(page: Page): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-app-ready', 'true')
}
