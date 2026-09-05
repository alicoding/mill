[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / SecretSourcePathKind

# Type Alias: SecretSourcePathKind

```ts
type SecretSourcePathKind = "file" | "folder" | "none";
```

How a source's path field renders: `"file"` asks for one file,
`"folder"` for a folder to read inside, `"none"` for a store that
needs no path at all.
