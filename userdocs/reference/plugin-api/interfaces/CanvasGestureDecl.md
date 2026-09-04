[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / CanvasGestureDecl

# Interface: CanvasGestureDecl

## Properties

### fadeMs?

```ts
optional fadeMs?: number;
```

For an ephemeral-drag tool: accumulated points age out over this
many milliseconds instead of clearing at pointer-up.

***

### onEnd

```ts
onEnd: (points, ctx) => void;
```

Called once at pointer-up with the FULL point list -- a stray
click included, so deciding what counts as a real gesture (a
distance threshold, a point count) is your own call.

#### Parameters

##### points

[`CanvasGesturePoint`](CanvasGesturePoint.md)[]

##### ctx

[`CanvasGestureCtx`](CanvasGestureCtx.md)

#### Returns

`void`

***

### onPoint?

```ts
optional onPoint?: (pt, ctx) => void;
```

Called for each accumulated point while the drag is live.

#### Parameters

##### pt

[`CanvasGesturePoint`](CanvasGesturePoint.md)

##### ctx

[`CanvasGestureCtx`](CanvasGestureCtx.md)

#### Returns

`void`

***

### renderPreview?

```ts
optional renderPreview?: (el, points, now) => void;
```

Draws the live in-drag preview into el (an overlay element
spanning the board) -- called on every point and, for an
ephemeral-drag tool, on every fade frame. el's contents are yours
to manage between calls.

#### Parameters

##### el

`HTMLElement`

##### points

[`CanvasGesturePoint`](CanvasGesturePoint.md)[]

##### now

`number`

#### Returns

`void`
