[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasToolPhase

# Type Alias: CanvasToolPhase

```ts
type CanvasToolPhase = "down" | "move" | "up" | "cancel" | "fade";
```

The pointer phases Mill drives a tool through: 'down' opens the
gesture, 'move' arrives once per frame, 'up' ends it, and 'cancel'
abandons it (Escape, or the pointer leaving). 'fade' arrives once per
frame after 'up' for a tool declaring fadeMs, until its trail has
aged out.
