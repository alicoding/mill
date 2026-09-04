[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginViewDecl

# Interface: PluginViewDecl

id must match a view the manifest declares under contributes.views
(which carries the tab's title). render draws into an element sized
to the panel, plain DOM like a canvas object's face, and runs once
per mount — the panel stays mounted while its tab is hidden, and
mounts again after a reload restores the tab. Opening the view is a
registry command, view.open.<plugin>.<id>, reachable from the
palette and callable from the plugin's own commands.

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

[`PluginViewCtx`](PluginViewCtx.md)

#### Returns

`void`
