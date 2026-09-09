[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasToolPointerEvent

# Interface: CanvasToolPointerEvent

What a tool's handler receives. `point` is the newest sample;
`coalesced` carries the samples Mill folded into the same frame,
oldest first, so a freehand stroke loses no detail. `zoom` is the
board's current scale — divide a screen-constant width by it to keep
a trail the same thickness at every zoom.

## Properties

### coalesced

```ts
coalesced: CanvasToolPoint[];
```

***

### modifiers

```ts
modifiers: object;
```

#### alt

```ts
alt: boolean;
```

#### ctrl

```ts
ctrl: boolean;
```

#### meta

```ts
meta: boolean;
```

#### shift

```ts
shift: boolean;
```

***

### phase

```ts
phase: CanvasToolPhase;
```

***

### point

```ts
point: CanvasToolPoint;
```

***

### target?

```ts
optional target?: string;
```

The board object under the pointer, when there is one.

***

### zoom

```ts
zoom: number;
```
