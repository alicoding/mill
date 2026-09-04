[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasStyleFieldDecl

# Type Alias: CanvasStyleFieldDecl

```ts
type CanvasStyleFieldDecl = 
  | {
  default: string;
  key: string;
  label?: string;
  options: readonly string[];
  type: "color";
}
  | {
  key: string;
  label?: string;
  options: readonly string[];
  type: "color-or-none";
}
  | {
  default: number;
  key: string;
  label?: string;
  options: readonly number[];
  render?: "line" | "dot";
  type: "stroke-width";
}
  | {
  default: string;
  key: string;
  label?: string;
  options: readonly object[];
  type: "shape-kind";
};
```

Mill's closed style vocabulary (the same shapes built-in tools
declare) -- restated as plain data for the SDK's compile-time
independence; the host validates and fills the panel's own
accessibility/test plumbing at registration time. Each field's
`key` doubles as its picker's testid suffix
(`atlas-<toolId>-<key>-<option>`); `label` is the row's verbatim
accessible name (defaults to "<tool label> <key>"). 'shape-kind'
options name their icons from the same named glyph set
CanvasObjectDecl.icon accepts (goal 0252 S2).
