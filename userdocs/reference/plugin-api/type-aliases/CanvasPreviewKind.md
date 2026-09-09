[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasPreviewKind

# Type Alias: CanvasPreviewKind

```ts
type CanvasPreviewKind = "rect" | "ellipse" | "line" | "path" | "shapes";
```

The shapes Mill can draw for a tool's live preview, from the
in-progress object's own data. Geometry is board coordinates, so a
preview stays pinned to the board while it is being drawn.
