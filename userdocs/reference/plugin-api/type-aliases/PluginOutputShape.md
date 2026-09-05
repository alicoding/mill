[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginOutputShape

# Type Alias: PluginOutputShape

```ts
type PluginOutputShape = "json" | "rows" | "text" | "html" | "markdown" | "error" | "binary";
```

The kind of thing this output IS, when the plugin knows. Omit it and
Mill works the shape out from the value and says so on screen, which
a reader can override. `rows` means an array of objects.
