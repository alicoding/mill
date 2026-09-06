---
kind: explanation
---

# Secrets are references

Every field in Mill that needs a password, a token, or a key takes a
pick from Secrets, never a typed value — a workflow carries the name
of a secret, and Mill fills in the value only at the moment a step
runs.

## The vault

Secrets you add by hand live in one encrypted vault file on this
device. Its key sits in your login keychain, tied to that specific
file: a second vault, or one restored from a backup, gets its own key.
Turn on the unlock requirement and Mill asks for Touch ID or your
password before the vault opens.

## References, not values

An Integration's auth, an MCP server's token, an AI provider's API key,
an Environment's secret variables, a client certificate's passphrase —
each field is a picker over Secrets. Pick an entry and the field
stores its name. Exporting a workflow exports the reference, so the
value never travels with it; importing on another machine asks you to
point the reference at that machine's own entry.

Guardrails decide which steps may read each secret, and every read
lands in the entry's access history — who used it, in which run, when.

## Sources

A secret you already keep elsewhere needs no copy. Under
**Secrets › Sources**, Mill reads entries from your shell environment,
a `.env` file, or a password manager's CLI, and lists their keys in
every secret picker beside the vault's own entries. Mill reads the
value when something uses it and never stores it. An extension can add
a source of its own the same way, and never sees another source's
values.

## The lock policy

**Settings › Security** decides when the vault closes itself: after a
chosen idle time, when this Mac sleeps or the screen locks, when you
switch users, or when Mill's window is minimized. The Secrets page
states the whole policy in one line — what it takes to unlock, and how
long it stays open. Lock and unlock from the command palette too;
search "vault".

## Backups carry the vault

Every automatic backup and every full export includes the vault file.
Restoring one on the same device reopens it with the key already in
your keychain; on another device, Mill offers to start a new vault and
keeps the restored file beside it, so nothing is lost.

To put a value in the vault and use it from a step, follow
[Store and reference a secret](../how-to/store-and-reference-a-secret.md).
