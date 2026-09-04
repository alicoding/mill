# Trust, data, and safety

Turn off your network and Mill keeps working — nothing here calls home
on its own.

**No phone-home, ever.** Mill makes no network call you didn't
configure: no telemetry, no analytics, no AI API calls of its own.
The updater talks to the releases page only when you check or a
channel you chose is enabled; workflow steps talk only to endpoints
you configured.

**Your data is local files.** Settings and entities live in a JSON
store, run history in SQLite, both on your machine. Settings →
Backups snapshots them on a schedule, exports everything to one
file, and imports it on another machine. Passwords and keys live in
their own encrypted vault file on your device, deliberately excluded
from every export. The vault's key sits in your OS keychain, stored
against that specific vault file — a second vault, or a vault restored
from a backup, gets its own key rather than replacing the first one's.

Turn on "Require Touch ID to unlock" and Mill asks for Touch ID or your
Mac password before the vault opens. Be clear about what that buys you:
it proves who is at the keyboard, and it does not stop another program
running as you from reading the key out of the keychain. Lock and
unlock the vault from the command palette (⌘K) too — search "vault"
and only the action that currently applies shows up.

If Mill can't open your vault file — the key for it isn't on this
device, or the key it has doesn't fit — the locked screen says which,
and offers to start a new vault. That keeps the current file beside it
as a dated backup and creates an empty one; the backup's entries stay
unreadable until the key that opens them turns up.

Secrets you already keep elsewhere need no copy. Configure > Secret
sources points Mill at a dotenv file — a project's `.env` — or at a
Bruno collection, whose root `.env` supplies values and whose
environments name the secrets it expects — or at 1Password or
Bitwarden through their own command-line tools, which Mill asks for one
value at the moment a step runs, the way those tools' scripting docs
recommend. The keys appear in every secret picker beside the vault's
entries, by name only, and every read is in your access history. The value is read from the file at the
moment a step runs, recorded in the same access history as a vault
read, and never stored by Mill.

**Clipboard history is opt-in and screened.** Turning on the
Clipboard history workflow is the only way it starts watching, and
turning it off stops watching immediately. Anything a password manager
or similar app marks confidential is never recorded, and any known
secret value is scrubbed before an entry is ever saved. Every entry you
copy back leaves a line in your own access history.

**External effects ask first.** The guardrail model
([Guardrails](../concepts/guardrails.md)) parks any step that leaves
the machine until you approve it or a rule you wrote allows it.
Agents get no shortcut around this.

**Plugins run only with your say-so.** A plugin you install waits in
Settings > Extensions, showing what it can request and reach, until
you allow it; Mill fingerprints its files at that moment and stops it
if they change; an administrator can pin the allowed set and require
signatures in the settings file; and Export plugin audit files what
every plugin asked for and read
([Install a plugin](../reference/install-a-plugin.md)).

**Execution environments are not a sandbox.** Run a command executes
with your full user account — the pinned shell, directory, and
environment give reproducibility, not confinement. Anything the
script can do, you can do; treat scripts accordingly.

**Updates verify before touching anything.** A downloaded update is
checked against its published digest and refused on mismatch, and a
backup snapshot is taken before any install. A copy built from
source never self-updates.

**When something breaks, you get the truth.** Every failure you can
see — a crash, a failed run, a bad connector save, an update that
didn't install — shows a Copy details button that copies the exact
error plus enough context to root-cause it, instead of leaving you to
retype it from a screenshot. Every run also records what actually
happened.
