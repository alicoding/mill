[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginNoticeInput

# Interface: PluginNoticeInput

## Properties

### action?

```ts
optional action?: object;
```

Names one of this plugin's OWN registered commands (the id given
to registerCommand) as a secondary link on the notice.

#### commandId

```ts
commandId: string;
```

#### label

```ts
label: string;
```

***

### level?

```ts
optional level?: "info" | "success" | "warning" | "error";
```

Defaults to 'info'. info/success dismiss themselves after a few
seconds; warning/error stay until the person dismisses them.

***

### text

```ts
text: string;
```
