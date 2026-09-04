[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginSettingsAPI

# Interface: PluginSettingsAPI

## Properties

### get

```ts
get: (key) => string | number | boolean;
```

Answers the stored value, or the manifest's declared default when
nothing has been set yet. Throws for a key the manifest does not
declare, naming the plugin. A secretRef setting answers the picked
vault entry's TITLE ('' when none is picked, or it no longer
exists) — never the value itself.

#### Parameters

##### key

`string`

#### Returns

`string` \| `number` \| `boolean`

***

### onChange

```ts
onChange: (key, fn) => () => void;
```

Fires fn whenever the user changes this key, and returns the
unsubscribe function. Use it to redraw a face that depends on a
setting — renderFace itself only re-runs on the object's own data
changing.

#### Parameters

##### key

`string`

##### fn

(`value`) => `void`

#### Returns

() => `void`
