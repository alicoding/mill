[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginViewCtx

# Interface: PluginViewCtx

PluginViewDecl (goal 0290): a plugin-owned work tab. id must match a
view the manifest declares under contributes.views (which carries
the tab's title); render draws into a host-owned div sized to the
panel, plain DOM like renderFace, and runs once per mount -- the
panel stays mounted while its tab is hidden, and mounts again after
an app reload restores the tab. Opening the view is a registry
command, view.open.<plugin>.<id>, palette-reachable and callable
from the plugin's own commands.

## Properties

### pluginId

```ts
pluginId: string;
```

***

### viewId

```ts
viewId: string;
```
