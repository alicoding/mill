[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginNoticeInput

# Interface: PluginNoticeInput

PluginNoticeInput (goal 0277): a one-call transient message Mill
renders in its own notice surface (the footer pill), labelled with
the plugin's name. level defaults to 'info'; info/success leave on
their own after a few seconds, warning/error stay until dismissed.
action names one of THIS plugin's own registered commands (the id
given to registerCommand) as a secondary link.

## Properties

### action?

```ts
optional action?: object;
```

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

***

### text

```ts
text: string;
```
