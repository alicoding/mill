# Plugin theming

A plugin's face, view, or capture is drawn inside Mill, so it should
look like Mill — in light and dark, and in every color scheme Settings
offers. You don't ship a palette. You read the variables Mill sets, and
your surface follows the user's choice everywhere it changes.

## The mount root tells you the theme

Mill puts two attributes on the element it hands you:

- `data-mill-theme` — `light` or `dark`. Always one of the two, never
  "auto": it is the settled answer, already resolved from the user's
  choice and the system preference.
- `data-mill-scheme` — the exact scheme, such as `light`, `dark_dimmed`,
  or `light_high_contrast`.

Both update in place when the user changes the theme, so plain CSS is
enough for a dark variant:

```css
.my-panel {
  background: var(--bgColor-default);
  color: var(--fgColor-default);
  border: 1px solid var(--borderColor-default);
}

[data-mill-theme="dark"] .my-panel {
  box-shadow: none;
}
```

## In JavaScript

Every context object carries the same pair, plus a change feed:

```js
export function activate(api) {
  api.registerView({
    id: 'my-view',
    render(el, ctx) {
      draw(el, ctx.theme)               // { mode: 'dark', scheme: 'dark_dimmed' }
      ctx.onThemeChange((theme) => draw(el, theme))
    },
  })
}
```

`onThemeChange` returns an unsubscribe function. Use it when your
surface paints pixels it can't restyle with CSS — a canvas, a chart, a
generated image. Everything else should use the variables and need no
JavaScript at all.

## The variables you may rely on

These are the names Mill promises. They are defined in every scheme.
You may define and read variables of your own on top of them; what the
conformance check refuses is reading one that is neither on this list
nor defined anywhere in your plugin.

Mill's own:

| Variable | Use |
| --- | --- |
| `--mill-accent-emphasis` | strong accent fill, with `--fgColor-onEmphasis` on top |
| `--mill-accent-fg` | accent text and links |
| `--mill-accent-muted` | subtle accent tint behind content |
| `--mill-accent-border-muted` | subtle accent border |
| `--mill-kind-trigger` | the trigger step color |
| `--mill-kind-capture` | the capture step color |
| `--mill-kind-process` | the process step color |
| `--mill-kind-apply` | the apply step color |
| `--mill-kind-decision` | the decision step color |
| `--mill-kind-terminal` | the terminal step color |
| `--mill-mono` | the monospace stack for machine-readable text |

From the design system Mill's own interface is built on:

| Variable | Use |
| --- | --- |
| `--fgColor-default` | body text |
| `--fgColor-muted` | secondary text |
| `--bgColor-default` | the surface behind your content |
| `--bgColor-muted` | a recessed or secondary surface |
| `--borderColor-default` | dividers and outlines |
| `--fgColor-accent` | accent text and links |
| `--bgColor-accent-emphasis` | a strong accent fill |
| `--fgColor-onEmphasis` | text and icons painted on any emphasis fill |
| `--borderColor-accent-emphasis` | the border of an accent fill |
| `--fgColor-danger` | an error message or a destructive action |
| `--fgColor-attention` | a warning message |
| `--fgColor-success` | a success message |

## What the check enforces

Run it over your folder before you ship:

```
go run ./internal/pluginconform path/to/my-plugin
```

- Reading a `--` variable that is neither on the list above nor defined
  by your own files **fails** — it may be undefined in some schemes, or
  vanish in a later release.
- A hardcoded color — `#1f6feb`, `rgb(31, 111, 107)` — **warns**. A
  literal is right for content the user authored (a pen color, a chart
  series). It is wrong for your surface's own chrome, which stops
  matching Mill the moment the theme changes.

A folder named `vendor/` is skipped: a bundled third-party engine
brings its own palette and its own variable names, and neither is your
plugin's chrome.

## Shipping a theme of your own

A plugin can contribute whole color themes, and a theme is data rather
than code: a CSS file holding nothing but declarations, listed in your
manifest.

```json
"contributes": {
  "themes": [
    { "id": "sepia", "label": "Sepia", "family": "light", "file": "themes/sepia.css" }
  ]
}
```

```css
/* themes/sepia.css */
--bgColor-default: #f6efe2;
--fgColor-default: #3a3026;
--fgColor-accent: #8a5a1f;
```

`family` says which appearance the theme belongs to, `light` or `dark`.
Mill layers your file over that family's built-in palette, so you
declare only the tokens you change and every other token keeps a value
that already works.

The file may contain only `--token: value;` declarations of the
variables listed above, plus comments. A selector, an at-rule, a
`url()`, or a variable outside the list is refused, and the check names
the line. Your theme then appears in Settings > Appearance under its
family, with your plugin's name beneath its label.

Turning your plugin off or removing it takes its themes with it, and
the appearance falls back to Mill's own.
