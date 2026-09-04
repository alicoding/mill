import { describe, expect, it } from 'vitest'
import declaredCommands from './commandsDeclaration.json'
import { COMMANDS, commandLabel } from './commands'
import { formatCombo } from './keybinding'

// This IS goal 0231's freshness mechanism for
// userdocs/reference/commands.md, the same tfplugindocs shape as
// atlasNounDeclarationFields.json/.test.ts (goal 0211): internal/docsgen
// has no TypeScript parser, so the generated commands reference reads
// this small committed JSON instead of the live registry directly, and
// THIS test is the other half of the freshness chain -- verifying the
// JSON stays byte-for-byte derived from the real COMMANDS array (across
// shared/commands.ts and every satellite file it spreads in) rather than
// drifting into a stale, separately hand-maintained command list.
//
// Unlike atlasNounDeclarationFields.test.ts's `satisfies` type check
// (that JSON describes a TYPE's field set, checked once at compile
// time), this JSON describes DATA -- one entry per live command instance
// -- so the check is a runtime equality assertion against COMMANDS
// itself, sorted the same way (by id) the committed file is.
describe('commandsDeclaration.json (goal 0231: the commands reference page)', () => {
  it('has exactly one entry per registered command, matching id/label/binding/surface, sorted by id', () => {
    const want = [...COMMANDS]
      .map((c) => ({
        id: c.id,
        // The RESOLVED English, not the key the registry holds (goal
        // 0341): internal/docsgen reads this JSON straight into
        // userdocs/reference/commands.md, which is prose a reader
        // scans, never a table of key paths. copy() resolves against
        // the same statically-bundled en bundle i18next loads at boot.
        label: commandLabel(c),
        binding: c.defaultBinding ? formatCombo(c.defaultBinding.mods, c.defaultBinding.key) : null,
        surface: c.surface ?? null,
        enabled: Boolean(c.enabled),
        // The target kind a command REQUIRES (goal 0343) -- null for a
        // command acting on global state. The reference page renders a
        // targeted command's availability from this, never as
        // "always available".
        needs: c.needs ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id))
    expect(declaredCommands).toEqual(want)
  })

  it('has no duplicate ids', () => {
    const ids = (declaredCommands as { id: string }[]).map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
