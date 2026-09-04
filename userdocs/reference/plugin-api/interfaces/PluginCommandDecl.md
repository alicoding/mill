[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginCommandDecl

# Interface: PluginCommandDecl

## Properties

### enabled?

```ts
optional enabled?: () => boolean;
```

enabled: omit for an always-valid command; provide a predicate
when the command only makes sense in a particular state -- the
palette leaves a disabled command out entirely rather than showing
something that does nothing. Never guard inside run() and return
silently instead. A default keybinding is deliberately NOT part of
this declaration: a shortcut for a command is assigned by the user
in Settings, never shipped by the plugin itself.

#### Returns

`boolean`

***

### id

```ts
id: string;
```

id is this command's slug: "<your plugin id>.<verb>".

***

### label

```ts
label: string;
```

***

### run

```ts
run: () => void;
```

#### Returns

`void`
