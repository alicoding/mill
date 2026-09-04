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

Mill's closed style vocabulary, restated as plain data so the SDK
never needs a build step to describe it. Each field's `key` names
the value that arrives on a gesture's styleValues and a face's
ctx.object payload once placed; `label` is the picker row's
accessible name (defaults to "<tool label> <key>"). 'shape-kind'
options name their icons from the same glyph set
CanvasObjectDecl.icon accepts.
