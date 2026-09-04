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

fetch performs a guarded HTTP request (goal 0288); see
PluginFetchInit for the contract.

#### Parameters

##### url

`string`

##### init?

[`PluginFetchInit`](PluginFetchInit.md)

#### Returns

`Promise`\<[`PluginFetchResult`](PluginFetchResult.md)\>

***

### files

```ts
files: PluginFilesAPI;
```

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

notify shows a notice and returns its dismiss function.

#### Parameters

##### input

[`PluginNoticeInput`](PluginNoticeInput.md)

#### Returns

() => `void`

***

### on

```ts
on: <K>(event, handler) => () => void;
```

on subscribes to a host event and returns the unsubscribe function.

#### Type Parameters

##### K

`K` *extends* `"contents:changed"`

#### Parameters

##### event

`K`

##### handler

(`payload`) => `void`

#### Returns

() => `void`

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

query lists the board's contents (goal 0278); always the current
state, never a cache.

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
registerCapture: (decl) => void;
```

#### Parameters

##### decl

[`PluginCaptureDecl`](PluginCaptureDecl.md)

#### Returns

`void`

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
registerView: (decl) => void;
```

#### Parameters

##### decl

[`PluginViewDecl`](PluginViewDecl.md)

#### Returns

`void`

***

### requestGuardedAction

```ts
requestGuardedAction: (kind, attributes, description) => Promise<GuardedActionResult>;
```

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
