[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginCommandDecl

# Interface: PluginCommandDecl

## Properties

### enabled?

```ts
optional enabled?: () => boolean;
```

enabled (goal 0258 slice 1, the same "when" clause built-in
commands carry): omit for an always-valid command; provide a
predicate when the command only makes sense in a state -- the
palette omits a disabled command entirely rather than showing
something that does nothing. Never guard inside run() and return
silently. A default keybinding is deliberately NOT part of this
declaration: a shortcut for third-party code is assigned by the
user in Settings, never shipped by the plugin.

#### Returns

`boolean`

***

### id

```ts
id: string;
```

id is this command's slug. Declaring the SAME id in the manifest's
`contributes.commands` is what lets a manifest tool name it.

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
