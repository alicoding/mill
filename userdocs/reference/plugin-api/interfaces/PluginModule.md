[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginModule

# Interface: PluginModule

A plugin's main.js default-exports (or named-exports) activate:
export function activate(api) { api.registerCanvasObject({...}) }

## Properties

### activate?

```ts
optional activate?: (api) => 
  | PluginExports
| Promise<PluginExports>;
```

#### Parameters

##### api

[`MillPluginAPI`](MillPluginAPI.md)

#### Returns

  \| [`PluginExports`](../type-aliases/PluginExports.md)
  \| `Promise`\<[`PluginExports`](../type-aliases/PluginExports.md)\>

***

### default?

```ts
optional default?: 
  | {
  activate?: (api) => 
     | PluginExports
    | Promise<PluginExports>;
}
  | ((api) => 
  | PluginExports
  | Promise<PluginExports>);
```
