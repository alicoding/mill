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
10. One narrow purpose per plugin. (review)

## Contracts

11. `id` is a kebab-case slug distinct from `name`; `name` contains
    neither "Mill" nor "plugin". (checked)
12. `version` is semver; `minMillVersion` names the oldest Mill you
    support. (checked)
13. `icon.png` (128×128) is present and declared as `icon`;
    `icon@dark.png` is optional. (checked)
14. `README.md` sits beside the plugin folder in your repository,
    never inside it (a plugin folder holds only files Mill serves); it
    says what the plugin does, its settings and the capabilities it
    needs. (checked for the examples: `examples/plugins/<id>.md`)
15. No remote code, no self-update, no telemetry: `fetch` only through
    `api.fetch`, no `import()` of a URL, no `eval`. (checked)
16. Labels and messages use sentence case; no emoji in labels.
    (checked)
17. Payload keys are camelCase; command ids are `<plugin>.<verb>`;
    tool names are `verb_noun`. (checked)
18. SDK comments and your README describe behaviour for plugin
    authors: no repository vocabulary (goal ids, internal file
    names). (checked over the generated reference)
19. A theme you contribute is a CSS file of nothing but
    `--token: value;` declarations, every token drawn from the
    documented theme variables: no selector, no at-rule, no `url()`.
    Mill layers it over the built-in palette of the family you name,
    so declare only what you change. (checked)

## Quality gates

20. `go run ./internal/pluginconform <folder>` passes; `npm run
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
