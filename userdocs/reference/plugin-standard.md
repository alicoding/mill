# The plugin standard

Every plugin that ships with Mill follows these rules, and the
conformance check enforces the ones a machine can. Follow them and
your plugin feels like part of Mill.

## Configuration

1. Declare every setting in the manifest with a type, a default and a
   one-sentence description. (checked)
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
   Mill's own menus. (checked)
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

21. A view or capture with its own UI declares an entry page:
    `"entry": "view.html"` beside the view or capture in your
    manifest, pointing at an `.html` file inside your plugin folder.
    Mill mounts it in a sandboxed frame where your page owns every
    element, and the page loads scripts, styles, fonts and images only
    from that folder, so ship what it needs beside it. Your script
    goes in a `.js` file the page loads with `<script src>`: an inline
    `<script>` or an `onclick` attribute never runs. `window.
    acquireMillApi()` is its door back to Mill. Styles may stay
    inline. A surface that draws into Mill's own document instead
    still works and warns. (checked)

22. A canvas object whose face reports an open editor declares
    `content: "interactive"` on the same object. `content` says what
    happens to input over the face: `"static"` (the default) leaves
    every gesture to the canvas, `"interactive"` gives the selected
    face the wheel, the drag and the keys — and `ctx.setEditing`, the
    call that stands Mill's own board shortcuts down while your editor
    is open, exists only there. (checked: a face script calling
    `setEditing` without that declaration warns)

23. An MCP server you ship (`contributes.mcpServers`) declares a slug
    `id`, a `label`, a `command` and its `args`; every secret it needs
    is `"secretRef:<setting key>"` naming one of your own secretRef
    settings, never a literal, and never a vault entry — a literal
    under a name that looks like a credential is refused. (checked)

## Publishing

24. A marketplace is a repository or folder with `.mill/marketplace.json`
    at its root: `{ "name", "owner": { "name", "url"? }, "plugins":
    [ { "id", "name", "description", "version", "kinds"?, "sha256"?,
    "source" } ] }`. `name` is a slug; `mill` is reserved for the
    extensions Mill ships. A `source` is `{ "kind": "path", "path" }`
    (a folder beside the index), `{ "kind": "github", "repo", "ref"? }`
    or `{ "kind": "archive", "url", "sha256"? }`. Two entries may not
    share an id. (checked when the marketplace is added)
25. A release is a git tag equal to the version (`v1.2.0` or `1.2.0`)
    whose assets include `<id>-<version>.zip` — the plugin folder,
    zipped, with `manifest.json` at its root or one folder down — and
    `SHA256SUMS`; sign the zip with minisign as `<zip>.minisig` when
    you can. Mill fetches the asset by that name, for an install and
    for an update.
26. Declare the archive's `sha256` in your marketplace entry. What Mill
    checked is the badge every installed extension wears: **Verified**
    when the hash matches and a key the user trusts signed it,
    **Hash-pinned** when only the hash matches, **Unverified** when
    nothing declared a hash (a branch archive always lands here, and
    the user must acknowledge it), **Dev** for a folder on their Mac.
    A hash that does not match refuses the install.

## Quality gates

27. `go run ./internal/pluginconform <folder>` passes; `npm run
    plugin:typecheck` and `npm run plugin:lint` pass. (checked)

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
