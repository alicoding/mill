# Register a command

A walkthrough of adding a new command to Mill's registry, using the
vault lock/unlock commands as the worked example — small, self-contained,
and demonstrating every field a command typically needs. Read
"Commands" first for the full generated list of what's registered
today; this page is the tutorial for adding to it.

## 1. Decide where it lives

`frontend/src/shared/commands.ts` holds the `COMMANDS` array directly
for commands with no natural grouping; anything with 2+ related
commands splits into its own satellite file under `shared/` (the
500-line file convention) and spreads into `COMMANDS`. Below is one
such satellite file, quoted whole:

<!-- BEGIN GENERATED: frontend/src/shared/secretsCommands.ts -->

```ts
import type { Command } from './commands'
import { SecretService } from './bindings'
import { refreshVaultStatus, useVaultStatusStore } from './vaultStatusStore'

// The vault lock/unlock actions (goal 0222 S1's own new state door,
// vaultStatusStore.ts) -- split out of shared/commands.ts (CLAUDE.md's
// 500-line convention), spread into its COMMANDS array. Both were
// SecretsView.tsx-only onClick handlers before this; the view's own
// Lock/Unlock buttons now call these directly (findCommand(id)?.run())
// instead of their own SecretService calls, so a future palette/
// keyboard invocation performs the exact same action. Neither call
// needs input (UnlockVault/LockVault take no arguments -- any
// passphrase-equivalent lives behind Touch ID/keychain, not a typed
// field), so a direct service call is the whole implementation, same
// shape backup.now/panel.applyClipboard already use.
export const SECRETS_COMMANDS: Command[] = [
  {
    id: 'secrets.lockVault',
    label: 'Lock vault',
    defaultBinding: null,
    enabled: () => useVaultStatusStore.getState().vaultStatus?.Unlocked === true,
    run: () => { SecretService.LockVault().then(refreshVaultStatus).catch(console.error) },
  },
  {
    id: 'secrets.unlockVault',
    label: 'Unlock vault',
    defaultBinding: null,
    enabled: () => {
      const status = useVaultStatusStore.getState().vaultStatus
      return status !== null && status.Exists && !status.Unlocked
    },
    run: () => { SecretService.UnlockVault().then(refreshVaultStatus).catch(console.error) },
  },
]

```

<!-- END GENERATED -->

## 2. Fill in the `Command` shape

- `id` — a stable, namespaced string (`secrets.lockVault`, not
  `lockVault`) — namespacing by the area it belongs to is the
  convention every existing command follows.
- `label` — what the palette and Settings show.
- `defaultBinding` — a `KeyCombo`, or `null` for a command with no
  keyboard shortcut by default.
- `enabled` — omit for a command that's always valid. Provide a
  function when the command only makes sense in a specific state (here,
  only when the vault exists and is/isn't already unlocked) — never
  guard inline inside `run()` and return silently; an unavailable
  command is omitted from the palette entirely, not shown disabled.
- `run` — the actual action. Calls a generated service binding
  directly when the command needs no input, the same shape both
  commands above use.

## 3. Add it to `COMMANDS`

Spread your new array into `frontend/src/shared/commands.ts`'s
`COMMANDS` export (`...SECRETS_COMMANDS` is how the file above joins
in) — this is the one array every surface (palette, keyboard dispatch,
Settings' rebinding list, and the Quick Panel for anything opting into
`quickPanel: true`) reads from.

## 4. Verify

`frontend/src/shared/commands.test.ts` covers the dispatch contract
generically; add a case there if your command's `enabled` predicate has
real branches worth pinning. `commandsDeclaration.json` regenerates via
`go generate ./internal/docsgen` — run it and commit the result so
"Commands" picks up the new row.
