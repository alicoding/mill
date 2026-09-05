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
their own encrypted vault file on your device. Every local backup
carries a copy of that file too — never its key, which stays in your
OS keychain — but "Export everything" leaves it out, since that
archive is the one meant to move to another machine or another
person. The vault's key sits in your OS keychain, stored against that
specific vault file — a second vault, or a vault restored from a
backup, gets its own key rather than replacing the first one's.

Turn on the unlock requirement and Mill asks before the vault opens.
The checkbox names what this Mac can actually offer — Touch ID, an
Apple Watch, your Mac password — rather than promising hardware you
may not have. Be clear about what that buys you: it proves who is at
the keyboard, and it does not stop another program running as you from
reading the key out of the keychain. Lock and unlock the vault from the
command palette (⌘K) too — search "vault" and only the action that
currently applies shows up.

Settings > Security decides when the vault closes itself. Choose how long
it may sit idle, from one minute to eight hours, a custom number of
minutes, or never; the count is time since you last used this Mac, so
working in another app keeps the vault open. Three checkboxes close it
regardless of idle time: when this Mac sleeps or the screen locks, when
you switch users, and when Mill's window is minimized. The first two
start on. The Secrets page states both halves in one line: what it
takes to unlock, and how long it stays open. A workflow run that needs
a secret while the vault is locked doesn't fail: it waits in Review
until you unlock the vault, then continues from the step that stopped.

If Mill can't open your vault file — the key for it isn't on this
device, or the key it has doesn't fit — the locked screen says which,
and offers to start a new vault. That keeps the current file beside it
as a dated backup and creates an empty one; the backup's entries stay
unreadable until the key that opens them turns up.

Secrets you already keep elsewhere need no copy. Secrets > Sources
points Mill at a dotenv file — a project's `.env` — or at a
Bruno collection, whose root `.env` supplies values and whose
environments name the secrets it expects — or at 1Password or
Bitwarden through their own command-line tools, which Mill asks for one
value at the moment a step runs, the way those tools' scripting docs
recommend. An extension can add stores of its own the same way: it
declares the store it reads, you point a source at the file or folder,
and Mill applies whatever comes back through the same gate — the
extension never receives another source's value, and never runs in the
window. The keys appear in every secret picker beside the vault's
entries, by name only, and every read is in your access history. The
value is read from the file at the moment a step runs, recorded in the
same access history as a vault read, and never stored by Mill.

**Anything that needs a secret names one; it never holds one.** An
integration's token, an HMAC signing key, an OAuth 1.0a consumer and
token secret, a JOSE key pair, an AI endpoint's API key — each field
picks an entry from Secrets rather than taking a typed value. That is
what puts one set of controls in front of every credential: the unlock
requirement, the access history, and the guardrails that can see which
secrets a step is about to use. Exporting one of these carries the
name of the entry, never the credential.

Each entry says what it holds — text, a key, a certificate or a file —
so a field only offers the entries it can actually use. An entry can
also point at a key in one of your sources instead of holding a value,
in which case Mill reads that key when something uses it.

An entry is the whole record, not five fixed boxes. Add fields of your
own — a serial number, a recovery code, an account id — and hide any
field whose value should stay masked until you ask for it. Add tags and
the list finds an entry by them; clicking a tag on a row narrows the
list to everything carrying it. A search matches titles, tags and field
names, never a value. Every entry says where it came from: added by
hand, from a source, or imported from a file.

Two ways to bring in what you already have. **Secrets > Sources > Find
.env files** scans one folder you choose — never your whole home
directory, never more than a few levels down, and never inside
dependency or build folders — lists the dotenv files it found with how
many keys each holds, and adds the ones you tick as sources or imports
their keys as entries. **Secrets > Import** reads a password export you
made yourself from the tool you already use, shows how many entries it
holds before anything is stored, and offers to delete the file straight
after, because an export holds every password in plain text. Mill never
reads another application's own credential store — you export, Mill
reads what you exported.

The first time you unlock after updating, any credential an earlier
version had saved outside the vault moves in: Mill creates an entry,
reads it back to check it arrived intact, points the integration at it,
and only then removes the old copy. If the check fails, the old copy
stays exactly where it was and Mill tries again next time. After that
the only Mill item left in your operating system's keychain is the
vault's own key.

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
