[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasPreviewDecl

# Interface: CanvasPreviewDecl

preview declares what Mill draws while the drag is live, instead of
mounting the object's face for every pointer move. `from` names the
data key carrying the geometry:
- 'rect'/'ellipse': "x,y,width,height"
- 'line': "x1,y1,x2,y2"
- 'path': an SVG path, the same `d` an <svg> takes
- 'shapes': a JSON list of CanvasPreviewShape, for a preview whose
  parts each carry their own paint (a trail whose points fade
  independently)
`fill`, `stroke`, `strokeWidth` and `opacity` each name a data key
carrying that paint value; a key you leave out is not painted, and
for 'shapes' each part carries its own instead.

## Properties

### fill?

```ts
optional fill?: string;
```

***

### from

```ts
from: string;
```

***

### kind

```ts
kind: CanvasPreviewKind;
```

***

### opacity?

```ts
optional opacity?: string;
```

***

### stroke?

```ts
optional stroke?: string;
```

***

### strokeWidth?

```ts
optional strokeWidth?: string;
```
