[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginElChild

# Type Alias: PluginElChild

```ts
type PluginElChild = string | Node | null | undefined;
```

el's children: a string becomes a text node, an existing Node is
appended as-is, and `null`/`undefined` is skipped — so a conditional
child reads as `condition ? el(...) : null`.
