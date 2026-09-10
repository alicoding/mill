import type { FrameLocator, Locator, Page } from '@playwright/test'

// bookmarkFace resolves mill-bookmark's own face content (goal 0380
// S2): its markup lives inside a sandboxed iframe now, never same-DOM,
// so every spec driving it reaches in the same way -- never a
// hand-rolled contentFrame() piercing, never a fixture swap to a
// same-DOM example. scope is the page itself for a single-bookmark
// spec, or a specific board-object node's own locator when more than
// one bookmark sits on the board at once (each carries its own iframe,
// so an unscoped frameLocator would be ambiguous).
export function bookmarkFace(scope: Page | Locator): FrameLocator {
	return scope.frameLocator('iframe[data-testid="plugin-face-frame-bookmark"]')
}

// bookmarkNodes -- every bookmark board-object wrapper on the page, in
// DOM order (creation order for a freshly-placed pair). Index into it
// to scope bookmarkFace() when more than one bookmark exists.
export function bookmarkNodes(page: Page): Locator {
	return page.locator('[data-testid="atlas-board-object"][data-object-kind="bookmark"]')
}

// selectBookmark lifts the click shield on one bookmark node so its
// face is genuinely live -- required before any REAL pointer
// interaction with the face (a click, a right-click, a drag): a
// freshly-placed object is NOT auto-selected, so a pointer event aimed
// at the face before this lands on the shield instead (which selects
// the object rather than reaching the frame -- the same fact
// runtime-plugin-face-object.spec.ts pins). fill()/press() on a
// frame-scoped locator reach the frame's own execution context
// directly and do not need this, but a real click always does.
// A no-op once the shield is already down.
export async function selectBookmark(node: Locator): Promise<void> {
	const shield = node.getByTestId('atlas-object-click-shield')
	if (await shield.count()) await shield.click()
}
