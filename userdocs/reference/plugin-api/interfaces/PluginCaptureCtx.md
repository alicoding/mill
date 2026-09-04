[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginCaptureCtx

# Interface: PluginCaptureCtx

## Properties

### cancel

```ts
cancel: () => void;
```

Closes the capture window without writing anything.

#### Returns

`void`

***

### destinationId

```ts
destinationId: string;
```

The card the user chose to land the capture in ("" for the top
level) — pass it as parentId to a content door.

***

### done

```ts
done: () => void;
```

#### Returns

`void`

***

### onThemeChange

```ts
onThemeChange: PluginThemeSubscribe;
```

Subscribes to every later appearance change.

***

### theme

```ts
theme: PluginTheme;
```

The appearance this capture is rendering under.
