[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasEditRoute

# Type Alias: CanvasEditRoute

```ts
type CanvasEditRoute = "inline" | "external-app" | "none";
```

What a gesture's own callbacks may reach -- deliberately narrow
(docs/goals/0252 S1): the conversion into board space, the tool's
own current style values, and the one creation door, scoped to this
plugin's own kind. Kernel internals (other objects' boxes, deletion,
selection) are not part of this surface.
