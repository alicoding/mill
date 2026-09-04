# Mill plugin SDK

Types only. A Mill plugin is plain ESM with no build step — this package
adds autocomplete and optional type-checking to that, and never becomes
a dependency your plugin loads at runtime.

The version tracks Mill's own version, the same number your manifest's
`minMillVersion` names.

## Install

From the repository, pinned to a tag or a branch:

```
npm i -D github:alicoding/mill#path:frontend/plugin-sdk
```

Or, if you keep your plugin beside a Mill checkout, point at the folder:

```
npm i -D file:../mill/frontend/plugin-sdk
```

Neither one is required to ship a plugin. You can also skip npm and
reference the file directly (see the last recipe below).

## Use

Add two lines to the top of `main.js` and annotate `activate`:

```js
// @ts-check
/// <reference types="@alicoding/mill-plugin-sdk" />

/** @param {import('@alicoding/mill-plugin-sdk').MillPluginAPI} api */
export function activate(api) {
	api.registerCommand({ id: 'my-plugin.hello', label: 'Say hello', run: () => api.notify({ text: 'Hello.' }) })
}
```

Your editor now completes every `api` member. To check the whole plugin
from the command line:

```
npx tsc --noEmit --allowJs --checkJs --lib es2020,dom main.js
```

Without npm, reference the file by path instead of by package name:

```js
// @ts-check
/// <reference path="../mill/frontend/plugin-sdk/index.d.ts" />

/** @param {import('../mill/frontend/plugin-sdk/index.d.ts').MillPluginAPI} api */
export function activate(api) {}
```

## What the types cover

`MillPluginAPI` is the one object a plugin ever holds. Everything it can
reach hangs off it: `registerCommand`, `registerCanvasObject`,
`registerView`, `registerCapture`, `settings`, `storage`, `notify`,
`query`, `on`, `fetch`, `content`, `files`, `convert`, and
`requestGuardedAction`. Capabilities arrive through that object; a
plugin never imports one.

A prose reference for every type, generated from these same
definitions, is published alongside Mill's other documentation.
