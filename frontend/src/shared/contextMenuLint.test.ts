import { describe, expect, it } from 'vitest'
import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
// The shipped flat config is the fixture's authority: the test reads
// the no-restricted-syntax options out of it rather than re-spelling
// the selectors, so a selector edit that stops matching the forbidden
// shapes fails HERE, not only in a lint nobody ran.
// eslint.config.js sits at the frontend root, outside src -- a plain
// ESM JS import typed as the default export it is.
import eslintConfig from '../../eslint.config.js'

// The ESLint gates on menu-row shapes (goal 0346 slice B): a
// context-menu item is { commandId, ctx }, a row action is
// { commandId, ctx } -- TypeScript's excess-property check refuses one
// written literally, so the rule's job is the shapes it cannot reach
// (a spread, a helper return, an `as` cast). These fixtures prove the
// shipped selectors still catch them.

type RuleEntry = ['error', ...unknown[]]

function restrictedSyntaxOptions(fragment: string): unknown[] {
  const configs = eslintConfig as { rules?: Record<string, unknown> }[]
  for (const entry of configs) {
    const rule = entry.rules?.['no-restricted-syntax'] as RuleEntry | undefined
    if (!rule) continue
    const hit = (rule.slice(1) as { message?: string }[]).find((option) => option.message?.includes(fragment))
    if (hit) return rule.slice(1)
  }
  throw new Error(`eslint.config.js has no no-restricted-syntax option whose message names "${fragment}"`)
}

function lint(source: string, options: unknown[]): string[] {
  const linter = new Linter({ configType: 'flat' })
  return linter
    .verify(
      source,
      // files is required for a `.ts` fixture name: flat mode's own
      // default glob covers only JS extensions.
      { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser }, rules: { 'no-restricted-syntax': ['error', ...options] } },
      'fixture.ts',
    )
    .map((message) => message.message)
}

describe('the menu-row ESLint gates (goal 0346 slice B)', () => {
  it('refuses a run: on every ContextMenuItem shape the type system cannot reach', () => {
    const options = restrictedSyntaxOptions('A context-menu item is a registry command')
    const flagged = [
      // An untyped object literal holding the items array -- the class
      // the gate exists for (no ContextMenuItem annotation for
      // TypeScript to check against).
      `const menu = { items: [{ id: 'x', run: () => {} }] }\nexport default menu`,
      // An `as ContextMenuItem` cast around a literal that still carries one.
      `const item = { id: 'x', run: () => {} } as ContextMenuItem\nexport default item`,
      // An annotated variable.
      `const item: ContextMenuItem = { id: 'x', run: () => {} }\nexport default item`,
      // A helper's annotated return (typed elsewhere, written here).
      `const make = (): ContextMenuItem => ({ id: 'x', run: () => {} })\nexport default make`,
      // A submenu row.
      `const menu = { items: [{ id: 'x', submenu: [{ id: 'y', run: () => {} }] }] }\nexport default menu`,
    ]
    for (const source of flagged) {
      expect(lint(source, options), source).toHaveLength(1)
    }
  })

  it('leaves the command+ctx form and a label-only row alone', () => {
    const options = restrictedSyntaxOptions('A context-menu item is a registry command')
    const clean = `const menu = { items: [{ id: 'x', commandId: 'atlas.card.open', ctx: c }, { id: 'y', label: 'Group', submenu: [{ id: 'z', commandId: 'atlas.link.setKind', ctx: c }] }] }\nexport default menu`
    expect(lint(clean, options)).toHaveLength(0)
  })

  it('still refuses an onClick: on an InventoryMenuAction literal (goal 0346 slice A)', () => {
    const options = restrictedSyntaxOptions('A row action is a registry command')
    expect(lint(`const row = { menuActions: [{ id: 'x', onClick: () => {} }] }\nexport default row`, options)).toHaveLength(1)
  })
})
