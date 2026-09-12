import { describe, expect, it } from 'vitest'
import { COMMANDS, commandLabel } from './commands'
import { formatCombo } from './keybinding'

// Vitest owns the committed declaration snapshot because the registry
// is TypeScript data. Go docsgen consumes its output; it does not parse
// COMMANDS. Normal test runs refuse drift, while docs:commands is the
// one explicit scoped update command.
const declaredCommands = [...COMMANDS]
  .map((command) => ({
    id: command.id,
    label: commandLabel(command),
    binding: command.defaultBinding ? formatCombo(command.defaultBinding.mods, command.defaultBinding.key) : null,
    surface: command.surface ?? null,
    enabled: Boolean(command.enabled),
    needs: command.needs ?? null,
  }))
  .sort((a, b) => a.id.localeCompare(b.id))

describe('commandsDeclaration.json (goal 0231: the commands reference page)', () => {
  it('matches the live registry projection exactly', async () => {
    await expect(JSON.stringify(declaredCommands, null, 2) + '\n').toMatchFileSnapshot('./commandsDeclaration.json')
  })

  it('has no duplicate ids', () => {
    const ids = declaredCommands.map((command) => command.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
