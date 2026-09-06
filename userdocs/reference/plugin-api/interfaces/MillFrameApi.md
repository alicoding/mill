[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / MillFrameApi

# Interface: MillFrameApi

What `window.acquireMillApi()` answers inside an entry page.

The page runs sandboxed with no same-origin access, under a policy
that loads scripts, styles, fonts and images from your own plugin
folder only, and makes no network requests of its own: use
`call('fetch', url, init)`, which goes through the same declared
hosts and the same approval every plugin request does. Script must
arrive as a file the page loads with `<script src>`; an inline
`<script>` and an `onclick` attribute never run.

The page also answers `window.acquireVsCodeApi()`, returning
`postMessage`, `getState` and `setState` under the names a webview
written for that editor already calls, so such a page drops in
unchanged. Acquiring it twice throws, as it does there.

## Properties

### call

```ts
call: (method, ...args) => Promise<unknown>;
```

Calls one plugin door and resolves with its answer. The doors a
page may call are `settings.get`, `notify`, `storage.get`,
`storage.set`, `storage.delete`, `query`, `fetch`,
`content.createNote`, `content.createCard`, `content.updateCard`,
`content.appendListRow`, `content.createList`, `files.list`,
`convert.htmlToMarkdown`, `requestGuardedAction`, `runCommand`,
in a capture, `capture.done` and `capture.cancel`, and in a canvas
object's face, `object.updatePayload` (merge a patch into this
object's payload; an empty string deletes a key) and
`object.setEditing` (true while your editor is open). Anything
else rejects, saying so by name.

#### Parameters

##### method

`string`

##### args

...`unknown`[]

#### Returns

`Promise`\<`unknown`\>

***

### context

```ts
readonly context: Record<string, unknown>;
```

The surface's context, always current: a capture's chosen
destination, a view's own ids.

***

### getState

```ts
getState: () => unknown;
```

The value this page last stored with setState, or undefined the
first time it opens.

#### Returns

`unknown`

***

### on

```ts
on: (event, handler) => () => void;
```

Subscribes to one host event. Returns the unsubscribe function.

#### Parameters

##### event

[`MillFrameEvent`](../type-aliases/MillFrameEvent.md)

##### handler

(`payload`) => `void`

#### Returns

() => `void`

***

### onMessage

```ts
onMessage: (handler) => () => void;
```

Receives what the plugin sent with its view or capture handle.
Returns the unsubscribe function.

#### Parameters

##### handler

(`message`) => `void`

#### Returns

() => `void`

***

### postMessage

```ts
postMessage: (message) => void;
```

Sends a value to the plugin's own `onMessage` handler.

#### Parameters

##### message

`unknown`

#### Returns

`void`

***

### setState

```ts
setState: (state) => unknown;
```

Remembers one value for this surface. It is kept in the plugin's
own storage, so it survives closing the tab and restarting Mill.

#### Parameters

##### state

`unknown`

#### Returns

`unknown`

***

### theme

```ts
readonly theme: PluginTheme;
```

The appearance the page is drawn under, always current.
