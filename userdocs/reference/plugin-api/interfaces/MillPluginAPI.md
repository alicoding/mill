[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / MillPluginAPI

# Interface: MillPluginAPI

## Properties

### content

```ts
content: PluginContentAPI;
```

***

### convert

```ts
convert: PluginConvertAPI;
```

***

### fetch

```ts
fetch: (url, init?) => Promise<PluginFetchResult>;
```

Performs a guarded HTTP request; see PluginFetchInit for the full
contract.

#### Parameters

##### url

`string`

##### init?

[`PluginFetchInit`](PluginFetchInit.md)

#### Returns

`Promise`\<[`PluginFetchResult`](PluginFetchResult.md)\>

***

### fetchJSON

```ts
fetchJSON: <T>(url, init?) => Promise<PluginFetchJSONResult<T>>;
```

Sugar over fetch for a JSON API: parses the body and never
throws, not even for a denied request, a non-2xx status or a body
that isn't JSON — see PluginFetchJSONResult.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### url

`string`

##### init?

[`PluginFetchInit`](PluginFetchInit.md)

#### Returns

`Promise`\<[`PluginFetchJSONResult`](PluginFetchJSONResult.md)\<`T`\>\>

***

### files

```ts
files: PluginFilesAPI;
```

***

### formatDate

```ts
formatDate: (iso, style?) => string;
```

Formats an ISO timestamp the way Mill's own interface does:
'relative' (the default) reads "2m ago"/"yesterday", falling back
to a short date beyond about a week; 'short' is a locale date;
'long' is a locale date and time. An unparseable iso answers
'—'.

#### Parameters

##### iso

`string`

##### style?

`"relative"` \| `"short"` \| `"long"`

#### Returns

`string`

***

### kinds

```ts
kinds: () => Promise<KindInfo[]>;
```

Lists the board's card kinds: the schema each card's own `fields`
values read against.

#### Returns

`Promise`\<[`KindInfo`](KindInfo.md)[]\>

***

### millVersion

```ts
millVersion: string;
```

***

### notify

```ts
notify: (input) => () => void;
```

Shows a notice and returns its dismiss function.

#### Parameters

##### input

[`PluginNoticeInput`](PluginNoticeInput.md)

#### Returns

() => `void`

***

### on

```ts
on: <K>(event, handler, filter?) => () => void;
```

Subscribes to a host event and returns the unsubscribe function.
filter narrows delivery: a 'contents:changed' filter { kinds }
delivers only changes of those kinds ('card' changes, say), so a
view re-querying on every change pays only for its own.

#### Type Parameters

##### K

`K` *extends* `"contents:changed"`

#### Parameters

##### event

`K`

##### handler

(`payload`) => `void`

##### filter?

###### kinds?

`string`[]

#### Returns

() => `void`

***

### open

```ts
open: (cardId) => void;
```

Opens one card the way a projection's own card click does: the
board view, with that card's page on top of it.

#### Parameters

##### cardId

`string`

#### Returns

`void`

***

### pluginId

```ts
pluginId: string;
```

***

### query

```ts
query: (q?) => Promise<ContentEntry[]>;
```

Lists the board's contents — always the current state, never a
cache.

#### Parameters

##### q?

[`ContentQuery`](ContentQuery.md)

#### Returns

`Promise`\<[`ContentEntry`](ContentEntry.md)[]\>

***

### registerCanvasObject

```ts
registerCanvasObject: (decl) => void;
```

#### Parameters

##### decl

[`CanvasObjectDecl`](CanvasObjectDecl.md)

#### Returns

`void`

***

### registerCapture

```ts
registerCapture: (decl) => PluginCaptureHandle;
```

#### Parameters

##### decl

[`PluginCaptureDecl`](PluginCaptureDecl.md)

#### Returns

[`PluginCaptureHandle`](PluginCaptureHandle.md)

***

### registerCommand

```ts
registerCommand: (decl) => void;
```

#### Parameters

##### decl

[`PluginCommandDecl`](PluginCommandDecl.md)

#### Returns

`void`

***

### registerView

```ts
registerView: (decl) => PluginViewHandle;
```

#### Parameters

##### decl

[`PluginViewDecl`](PluginViewDecl.md)

#### Returns

[`PluginViewHandle`](PluginViewHandle.md)

***

### requestGuardedAction

```ts
requestGuardedAction: (kind, attributes, description) => Promise<GuardedActionResult>;
```

Asks Mill to perform an action the plugin cannot perform itself.
See CanvasObjectFaceCtx's own requestGuardedAction for the full
contract — this is the same door, callable outside a face.

#### Parameters

##### kind

`string`

##### attributes

`Record`\<`string`, `string`\>

##### description

`string`

#### Returns

`Promise`\<[`GuardedActionResult`](GuardedActionResult.md)\>

***

### settings

```ts
settings: PluginSettingsAPI;
```

***

### storage

```ts
storage: PluginStorageAPI;
```

***

### ui

```ts
ui: PluginUIAPI;
```
