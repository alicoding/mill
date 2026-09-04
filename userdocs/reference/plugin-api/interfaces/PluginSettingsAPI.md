[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginSettingsAPI

# Interface: PluginSettingsAPI

PluginSettingsAPI (goal 0258 slice 1): the plugin's own declared
settings (manifest `contributes.settings`), served back typed. The
host renders the controls and stores the values -- a plugin never
builds a settings UI. get() answers the stored value or the
manifest default; onChange() fires whenever the user changes that
key (a face that depends on a setting re-renders itself from here
-- renderFace re-runs on object DATA changes only) and returns the
unsubscribe function. An undeclared key throws, naming the plugin.
A secretRef setting answers the picked vault entry's TITLE ('' when
none is picked or it no longer exists) -- never the value.

## Properties

### get

```ts
get: (key) => string | number | boolean;
```

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

#### Parameters

##### key

`string`

##### fn

(`value`) => `void`

#### Returns

() => `void`
