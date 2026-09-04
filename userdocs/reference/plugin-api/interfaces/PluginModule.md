[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginModule

# Interface: PluginModule

A plugin's main.js default-exports (or named-exports) activate:
export function activate(api) { api.registerCanvasObject({...}) }

## Properties

### activate?

```ts
optional activate?: (api) => void | Promise<void>;
```

#### Parameters

##### api

[`MillPluginAPI`](MillPluginAPI.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### default?

```ts
optional default?: 
  | {
  activate?: (api) => void | Promise<void>;
}
  | ((api) => void | Promise<void>);
```
