[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginCaptureCtx

# Interface: PluginCaptureCtx

MillPluginAPI is the one object a plugin ever holds -- handed to its
exported activate(api), frozen by the host.
A capture (goal 0309): a quick-capture face the host shows in the
floating capture window, summoned from the Quick Panel or the
palette away from the canvas. render draws the face into el (a
host-owned div); the plugin writes through the content doors with
ctx.destinationId as the parent, then calls ctx.done() -- or
ctx.cancel() to close without writing. Declared in the manifest's
contributes.captures (id, label) so the Quick Panel can offer it
without running plugin code.

## Properties

### cancel

```ts
cancel: () => void;
```

#### Returns

`void`

***

### destinationId

```ts
destinationId: string;
```

destinationId is the card the user chose to land the capture in
("" for the top level) -- pass it as parentId to a content door.

***

### done

```ts
done: () => void;
```

#### Returns

`void`
