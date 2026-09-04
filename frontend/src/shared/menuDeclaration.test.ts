import { describe, expect, it } from 'vitest'
import declaredMenu from './menuDeclaration.json'
import { menuDocRows } from './menuDocRows'

// The freshness half of the menu-bar reference page, the same shape
// commandsDeclaration.test.ts already uses for the commands page:
// internal/docsgen has no TypeScript parser, so the generated page
// reads this committed JSON instead of the live projection, and THIS
// test is what stops the JSON drifting away from the menu bar the app
// actually installs.
describe('menuDeclaration.json (the menu-bar reference page)', () => {
  it('is exactly the menu bar the projection renders, in bar order', () => {
    expect(declaredMenu).toEqual(menuDocRows())
  })

  it('names a command or a platform item for every row, never neither', () => {
    for (const row of declaredMenu) {
      expect(row.menu.length).toBeGreaterThan(0)
      expect(row.item.length).toBeGreaterThan(0)
    }
  })
})
