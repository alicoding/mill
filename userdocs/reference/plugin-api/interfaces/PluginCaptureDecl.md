[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginCaptureDecl

# Interface: PluginCaptureDecl

id and label are declared in the manifest's contributes.captures,
so the Quick Panel can offer the capture without running any plugin
code. render draws the face into an element the capture window owns;
write through the content doors with ctx.destinationId as the
parent, then call ctx.done() -- or ctx.cancel() to close without
writing.

## Properties

### id

```ts
id: string;
```

***

### render

```ts
render: (el, ctx) => void;
```

#### Parameters

##### el

`HTMLElement`

##### ctx

[`PluginCaptureCtx`](PluginCaptureCtx.md)

#### Returns

`void`
