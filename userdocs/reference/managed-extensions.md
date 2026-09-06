# Managed extensions

An organisation decides which extensions Mill may install and run on a
Mac by placing one file on it. Mill reads the file every time it lists,
loads or installs an extension, so a change takes effect on the next
reload with nothing to restart, and nothing in Mill's own settings can
loosen it.

## The policy file

```
/Library/Application Support/Mill/plugin-policy.json
```

The file is system-wide, so device management can deploy it like any
other managed preference. Setting `MILL_PLUGIN_POLICY=<path>` makes
Mill read a different file instead — the way to try a policy before
rolling it out, and what tests and server mode use.

Every key:

| Key | Meaning |
| --- | --- |
| `version` | Always `1`. |
| `managedBy` | The organisation's name, shown in the banner above Extensions. |
| `allow` | Rules naming the extensions that may install and run. Once the list has any entry, it is exclusive: anything it does not name is blocked. |
| `block` | Rules naming extensions that may never install or run. A block always wins over an allow. |
| `requiredTier` | The lowest trust tier an extension may wear: `"verified"`, `"hash-pinned"`, or `"any"` (the default). Checked when installing and every time extensions load. |
| `blockedCapabilities` | Capabilities no extension may declare: `fetch`, `write-content`, `open-url`, `open-app`, `list-files`, `read-file`, `erase-board-items`. An extension declaring one is blocked. |
| `allowedSources` | Marketplace names and addresses installs may come from. Once set, Add source, Browse installs and installs from a link are limited to them. |

A rule in `allow` or `block` is `{ "id", "publisherKey", "versions" }`,
with at least one of `id` (the extension's id) or `publisherKey` (the
minisign public key that signs it). `versions` narrows the rule to a
range — `"^1.2"`, `">=1 <2"` — and a version Mill cannot read counts as
blocked, never as allowed.

## What people see

- Extensions shows **Managed by <organisation>** above every tab.
- A blocked extension stays in the Installed list, marked **Blocked by
  your organisation's policy**, and its details say why: the block
  list, the required tier, a blocked capability. It never runs.
- Installing a blocked extension stops at the prompt with the same
  reason, before anything downloads or lands.
- The **Verification** tab says whether the policy allows or blocks the
  extension.
- **Settings › Security** shows the whole policy, read-only.

## When the file cannot be read

A present file that is not valid blocks every extension that is not
built into Mill, and Extensions says so: *The extension policy file
can't be read. Ask your administrator.* The detail is in Mill's log.
This is deliberate — a broken policy closes the door rather than
opening it.

## Examples for a bank

Only two named extensions, both required to be signed and verified,
from the bank's own marketplace:

```json
{
  "version": 1,
  "managedBy": "Example Bank",
  "allow": [
    { "id": "bank-reconcile", "publisherKey": "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3" },
    { "id": "bank-tickets", "versions": "^2" }
  ],
  "requiredTier": "verified",
  "allowedSources": ["bank-market"]
}
```

Anything may install, but nothing that reaches the network:

```json
{
  "version": 1,
  "managedBy": "Example Bank",
  "blockedCapabilities": ["fetch"]
}
```

One extension is blocked below a fixed version:

```json
{
  "version": 1,
  "managedBy": "Example Bank",
  "block": [{ "id": "acme-notes", "versions": "<1.4.0" }],
  "requiredTier": "hash-pinned"
}
```

## What an install checks

Every install also reads the extension's files before enabling it,
policy or not:

- Code that builds code at run time — `eval`, `new Function`, an
  `import()` of a web address, a script tag loading from the web — is
  refused.
- A web address written into the extension's own code whose host it
  never declared under `contributes.network` is refused: *Reaches
  <host> without declaring it.* Comments, the XML namespace host and
  loopback addresses do not count; an address inside a bundled library
  (a `vendor/` folder) is noted rather than refused.
- Code Mill cannot read easily — a large script with no source map, an
  embedded base64 blob, a long line of near-random characters — is
  noted, not refused: *Contains code Mill can't read easily.* The note
  shows in the install prompt and again on the Verification tab.

A refused install leaves nothing on disk.
