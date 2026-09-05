---
kind: explanation
---

# Extensions and trust

An extension adds what Mill can do — a board object, a workflow step, a
command, a secret source, a view — as a folder of two files you
install, and it runs only with your say-so.

## The store

**Extensions** is its own page (⇧⌘X). **Installed** lists what you
have and what each one adds. **Browse** lists what your marketplaces
offer that you have not installed, starting with the examples Mill
ships. **Updates** shows what has a newer version.

Installing shows what the extension can do — the hosts it reaches,
whether it writes to your boards, what it adds — and installs only
after you confirm. A newly installed extension waits under Installed
until you allow it to run.

## Sources

A marketplace is any repository or folder with a `.mill/marketplace.json`
file, listing the extensions it offers. Add one under **Sources**;
Mill reads it only when you add it, refresh it, install from it, or
check for updates — never on its own. You can also install straight
from a repository, a `.zip` address, or a folder on this Mac.

## Tiers

Every installed extension wears one badge, and it says exactly what was
checked:

- **Verified** — its files match the hash the marketplace published,
  and a key this Mill trusts signed them.
- **Hash-pinned** — its files match the hash the marketplace published.
- **Unverified** — nothing checked these files; Mill asks you to
  acknowledge that before installing.
- **Dev** — you installed it from a folder on this Mac.

An extension that changes on disk after you allowed it loses its badge
until you allow it again.

## What an extension can reach

An extension declares up front what it contributes and what it may ask
for; the list you confirm at install is the list it gets. It renders
in its own frame with the theme Mill hands it, reaches the network
only through hosts it declared, writes to boards only through the same
guarded path an agent's write takes, and never receives another
extension's secrets. It cannot register hotkeys, update itself, or
phone home.

To install one, follow [Install a plugin](../reference/install-a-plugin.md).
To write one, start at [Extending the canvas](../reference/extending-the-canvas.md).
