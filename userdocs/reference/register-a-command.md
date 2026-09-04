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

// The vault lock/unlock/reset actions (goal 0222 S1's own state door,
// vaultStatusStore.ts) -- split out of shared/commands.ts (CLAUDE.md's
// 500-line convention), spread into its COMMANDS array. The view's own
// buttons call these (findCommand(id)?.run()) instead of their own
// SecretService calls, so a palette or keyboard invocation performs the
// exact same action. None needs input: any passphrase-equivalent lives
// behind the system authentication sheet, not a typed field.
//
// Every run() records its outcome in the store (goal 0330). A rejected
// unlock used to end in console.error, which left the Unlock button
// looking like it did nothing at all on a device whose stored key does
// not open the vault file.
function record(promise: Promise<unknown>): void {
  const { setVaultError } = useVaultStatusStore.getState()
  setVaultError('')
  promise
    .then(refreshVaultStatus)
    .catch((err) => { setVaultError(String(err)) })
}

export const SECRETS_COMMANDS: Command[] = [
  {
    id: 'secrets.lockVault',
    label: 'Lock vault',
    defaultBinding: null,
    enabled: () => useVaultStatusStore.getState().vaultStatus?.Unlocked === true,
    run: () => { record(SecretService.LockVault()) },
  },
  {
    id: 'secrets.unlockVault',
    label: 'Unlock vault',
    defaultBinding: null,
    enabled: () => {
      const status = useVaultStatusStore.getState().vaultStatus
      return status !== null && status.Exists && !status.Unlocked
    },
    run: () => { record(SecretService.UnlockVault()) },
  },
  {
    id: 'secrets.resetVault',
    label: 'Start a new vault',
    defaultBinding: null,
    // Only offered where the current file cannot be opened at all --
    // the stored key does not fit it, or there is no key for it here.
    // Anywhere else this would discard a readable vault.
    enabled: () => {
      const { vaultStatus, vaultError } = useVaultStatusStore.getState()
      if (vaultStatus === null || !vaultStatus.Exists || vaultStatus.Unlocked) return false
      return vaultErrorKind(vaultError) === 'keyMismatch' || vaultErrorKind(vaultError) === 'noKey'
    },
    // Destructive, and only meaningful with the locked view's own
    // failure on screen to explain what it replaces.
    paletteHidden: true,
    run: () => { record(SecretService.ResetVault()) },
  },
]

// vaultErrorKind classifies a lock/unlock failure by the stable token
// the Go error carries. Wails delivers a bound method's error to
// JavaScript as text, so matching a token that never changes is what
// keeps the wording on this side, where it can be translated, instead
// of pinning the UI to a Go sentence.
export type VaultErrorKind = 'keyMismatch' | 'noKey' | 'cancelled' | 'authUnavailable' | 'other' | 'none'

export function vaultErrorKind(error: string): VaultErrorKind {
  if (!error) return 'none'
  if (error.includes('key-mismatch')) return 'keyMismatch'
  if (error.includes('no-vault-key')) return 'noKey'
  if (error.includes('unlock-cancelled')) return 'cancelled'
  if (error.includes('auth-unavailable')) return 'authUnavailable'
  return 'other'
}

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
