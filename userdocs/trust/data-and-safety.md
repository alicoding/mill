# Trust, data, and safety

Mill's trust posture in plain statements:

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
from every export. The vault's key sits in your OS keychain by
default, or optionally behind Touch ID or your Mac password for an
extra prompt every time you unlock.

**External effects ask first.** The guardrail model
([Guardrails](../concepts/guardrails.md)) parks any step that leaves
the machine until you approve it or a rule you wrote allows it.
Agents get no shortcut around this.

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
