[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginExtensionsAPI

# Interface: PluginExtensionsAPI

A bounded, declared-dependency-only door onto another installed
extension's own activate() return value, gated by the callee's own
manifest `exports` allowlist. Never a live handle into another
extension's internals.

## Properties

### get

```ts
get: (id) => Promise<Record<string, unknown> | undefined>;
```

Resolves the declared dependency's export surface: its plain
(non-function) properties, plus one callable async function per
allowlisted method name — framed or not, calling one always
returns a Promise. Resolves to `undefined` when `id` is not in
THIS plugin's own manifest `dependencies`, or the dependency has
not activated (not installed, disabled, or still loading).
Calling a method the dependency does not list in its own manifest
`exports` rejects with "Method {m} is not exported by {id}."

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\> \| `undefined`\>
