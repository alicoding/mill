---
kind: reference
---

# The plugin standard

Every plugin that ships with Mill follows these rules, and the
conformance check enforces the ones a machine can. Follow them and
your plugin feels like part of Mill. Bringing a plugin over from
another platform? Start with [Port an extension from another
platform](port-a-vscode-extension.md).

## Configuration

1. Declare every setting in the manifest's `configuration` key, with a
   type, a default and a one-sentence description. (checked) `settings`
   still loads as a deprecated alias; renaming to `configuration` clears
   the warning.
2. Settings render in Mill's Settings; a plugin never builds its own
   settings page. (review)
3. Request only the capabilities and hosts you use. (checked: an
   unused declared capability warns)

## Interaction

4. Every action is a command declared in the manifest
   (`contributes.commands`) and registered with the same id; tools
   reference declared commands. (checked) A command may also seat
   itself in Mill's menu bar with `menu: { path, group?, order? }` --
   `path` is `"workflow"`, `"atlas"` or `"help"` only, never one of
   Mill's own menus. (checked) A ported manifest's own
   `contributes.menus` is accepted too, mapped onto whichever of
   Mill's seats it names; see [the porting
   guide](port-a-vscode-extension.md#menu-ids-and-mills-seats).
   (checked)
5. Ship no default hotkey; people bind their own in Settings ›
   Shortcuts. (checked: the SDK has no hotkey field; this rule
   documents why)
6. Use only the documented theme variables ([plugin
   theming](plugin-theming.md)); no colour literals. (checked)
7. Add the minimum persistent chrome: a face, a view or a capture only
   when the task needs one. (review)
8. No promotion, ads or upgrade prompts anywhere. (review)
9. Report a failure through `api.notify` with one actionable sentence;
   `console.error` only alongside it, never instead. (checked: a
   `console.error` with no `api.notify` in the same function warns)
10. Present output, never type it: show a result through
    `api.ui.renderOutput`, which gives the reader the same tree,
    table, log, rendered view, Find, Copy and Raw every other output
    surface in Mill has. Never a `<pre>` or a text box of your own —
    a text box says the reader can edit what they are reading.
    (review)
11. One narrow purpose per plugin. (review)

## Contracts

12. `id` is a kebab-case slug distinct from `name`; `name` contains
    neither "Mill" nor "plugin". (checked)
13. `version` is semver; `minMillVersion` names the oldest Mill you
    support. (checked)
14. `icon.png` (128×128) is present and declared as `icon`;
    `icon@dark.png` is optional. (checked)
15. `README.md` sits beside the plugin folder in your repository,
    never inside it (a plugin folder holds only files Mill serves); it
    says what the plugin does, its settings and the capabilities it
    needs. (checked for the examples: `examples/plugins/<id>.md`)
16. No remote code, no self-update, no telemetry: `fetch` only through
    `api.fetch`, no `import()` of a URL, no `eval`. (checked)
17. Labels and messages use sentence case; no emoji in labels.
    (checked)
18. Payload keys are camelCase; command ids are `<plugin>.<verb>`;
    tool names are `verb_noun`. (checked)
19. SDK comments and your README describe behaviour for plugin
    authors: no repository vocabulary (goal ids, internal file
    names). (checked over the generated reference)
20. A theme you contribute is a CSS file of nothing but
    `--token: value;` declarations, every token drawn from the
    documented theme variables: no selector, no at-rule, no `url()`.
    Mill layers it over the built-in palette of the family you name,
    so declare only what you change. (checked)

21. A view, capture or canvas object with its own UI declares an entry
    page: `"entry": "view.html"` beside the view, capture or canvas
    object in your manifest, pointing at an `.html` file inside your
    plugin folder.
    Mill mounts it in a sandboxed frame where your page owns every
    element, and the page loads scripts, styles, fonts and images only
    from that folder, so ship what it needs beside it. Your script
    goes in a `.js` file the page loads with `<script src>`: an inline
    `<script>` or an `onclick` attribute never runs. `window.
    acquireMillApi()` is its door back to Mill. Styles may stay
    inline. A canvas object's page receives the object as its context
    and writes back through `object.updatePayload`; its face is
    always interactive. A canvas object may still draw into Mill's own
    document instead (`renderFace`, the deprecated form) — see rule 32
    for why a view or capture may not. (checked)

22. A canvas object whose face reports an open editor declares
    `content: "interactive"` on the same object. `content` says what
    happens to input over the face: `"static"` (the default) leaves
    every gesture to the canvas, `"interactive"` gives the selected
    face the wheel outright — a scroll over it never also moves the
    board — along with the drag and the keys, and `ctx.setEditing`,
    the call that stands Mill's own board shortcuts down while your
    editor is open, exists only there. The chrome band above the face
    keeps panning the board in every state. (checked: a face script
    calling `setEditing` without that declaration warns)

23. An MCP server you ship (`contributes.mcpServers`) declares a slug
    `id`, a `label`, a `command` and its `args`; every secret it needs
    is `"secretRef:<setting key>"` naming one of your own secretRef
    settings, never a literal, and never a vault entry — a literal
    under a name that looks like a credential is refused. (checked)

24. No code built at run time: no `eval`, no `new Function`, no
    `import()` of a web address, no `<script src>` loading from the
    web. This covers every `.js` and `.html` you ship, a bundled
    library included. Checked when the plugin is installed, and a hit
    refuses the install. (checked)
25. Every web address written into your own code names a host you
    declared under `contributes.network`; a `*.example.com`
    declaration covers its subdomains. An undeclared host refuses the
    install with *Reaches <host> without declaring it.* Addresses in
    comments, the XML namespace host and loopback do not count; an
    address inside a `vendor/` folder is noted to the person
    installing rather than refused. (checked)
26. Ship code a reader can read: a `.js` over 50 KB carries a
    `//# sourceMappingURL`, no base64 blob over 8 KB, no long line of
    near-random characters. A hit never refuses; the install prompt
    and the Verification tab say *Contains code Mill can't read
    easily.* and the person decides. (checked: warns)

## Publishing

27. A marketplace is a repository or folder with `.mill/marketplace.json`
    at its root: `{ "name", "owner": { "name", "url"? }, "plugins":
    [ { "id", "name", "description", "version", "kinds"?, "sha256"?,
    "source" } ] }`. `name` is a slug; `mill` is reserved for the
    extensions Mill ships. A `source` is `{ "kind": "path", "path" }`
    (a folder beside the index), `{ "kind": "github", "repo", "ref"? }`
    or `{ "kind": "archive", "url", "sha256"? }`. Two entries may not
    share an id. (checked when the marketplace is added)
28. A release is a git tag equal to the version (`v1.2.0` or `1.2.0`)
    whose assets include `<id>-<version>.zip` — the plugin folder,
    zipped, with `manifest.json` at its root or one folder down — and
    `SHA256SUMS`; sign the zip with minisign as `<zip>.minisig` when
    you can. Mill fetches the asset by that name, for an install and
    for an update.
29. Declare the archive's `sha256` in your marketplace entry. What Mill
    checked is the badge every installed extension wears: **Verified**
    when the hash matches and a key the user trusts signed it,
    **Hash-pinned** when only the hash matches, **Unverified** when
    nothing declared a hash (a branch archive always lands here, and
    the user must acknowledge it), **Dev** for a folder on their Mac.
    A hash that does not match refuses the install.

## Quality gates

30. `go run ./internal/pluginconform <folder>` passes; `npm run
    plugin:typecheck` and `npm run plugin:lint` pass. (checked)

## Board views

31. A view placed in the Atlas board's own switcher
    (`"placement": "board-switcher"`) that writes card fields through
    `api.content.setCardFields` declares the `edit-card-fields`
    capability. (checked)

## Sandboxed activation

32. `main.js` itself activates inside a sandboxed frame, the same
    isolation an entry page gets — unless your manifest declares a
    canvas object, which still activates alongside Mill's own document
    until Mill ships a framed canvas API. Because of that, a view or
    capture must declare an entry page (rule 21): Mill can no longer
    draw one in its own document, so a view or capture with no entry
    page refuses the install. `registerCommand`, `registerView` and
    `registerCapture` work the same either way — write one `main.js`
    for both. (checked: refuses the install)

## Entity references

33. An `entityRef` setting names a known `entityKind` — one of the
    Configure entity kinds the picker supports (`request`, `list`,
    `mcpserver`, `workflow`, `workflow-scope`, `decision`, `execenv`,
    `environment`, `aiprovider`, `conversionprofile`, `atlas-kind`,
    `atlas-linkkind`); an unknown or missing `entityKind` blocks the
    load. The stored value is the picked entity's id, chosen through
    the same picker a workflow node's own reference field uses.
    (checked)

## Menu when clauses

34. A `contributes.menus` item seated on `editor/context` or
    `view/title` declares a `when` clause; one that declares none
    shows everywhere, so say `when: "true"` if that is the intent.
    (checked, advisory)
35. A `when` clause that reads `plugin.<key>` names a key your own
    scripts actually write with `api.context.set(key, value)` (or the
    entry-page/framed equivalent, `call('context.set', key, value)`)
    somewhere — a key you never set stays permanently falsy. (checked,
    advisory)

## Context keys

Your own plugin can contribute facts a `when` clause reads: call
`api.context.set(key, value)` — from `main.js` directly, or from a
framed entry page's `acquireMillApi().call('context.set', key,
value)` — and a declared item's `when: "plugin.<key>"` reads it back,
evaluated host-side, synchronously, every time the item's own seat or
its command's enablement is checked. `value` is a string, number,
boolean, or an array of strings; a key already starting with
`"plugin."` is refused, since that prefix is added automatically
wherever the fact is read back.

## SDK conveniences

The SDK carries a few small helpers so a plugin never re-invents them:
`api.ui.el(tag, attrs, children)` builds one DOM element the safe way —
never `innerHTML`, so nothing you pass can inject markup — for the
rest of your face's own layout (rule 10 still governs presenting a
*result*, through `api.ui.renderOutput`). `api.fetchJSON(url, init?)`
is `api.fetch` plus a JSON parse, answering `{ ok, status, data,
errorText }` and never throwing, not even for a denied request or a
non-2xx response. `api.storage.pushList(key, item, { dedupeBy?, max?
})` and `api.storage.getList(key)` are sugar over `get`/`set` for a
request-history or cache-list. `api.convert.markdownToHtml(markdown)`
is `htmlToMarkdown`'s reverse direction, the same sanitized renderer.
`api.formatDate(iso, style)` formats a timestamp the way Mill's own
interface does (`'relative'`, `'short'` or `'long'`) instead of a
plugin's own `Date` math. Every one of these is optional — hand-rolling
the same shape yourself still works, it's just more code.

## Checking your own plugin

```sh
go run ./internal/pluginconform path/to/your-plugin
cd frontend && npm run plugin:typecheck
cd frontend && npm run plugin:lint
```

The first prints every failure and warning it finds, naming the rule
above it enforces. A failure blocks shipping; a warning is your call —
the check tells you why the rule exists, not just that you broke it.

See [Install a plugin](install-a-plugin.md) for the full authoring
guide and [the plugin API reference](plugin-api/index.md) for every
type. [Plugin API maturity](plugin-api-maturity.md) lists each
contribution family's current level and its evidence, generated fresh
from this repository on every build.
