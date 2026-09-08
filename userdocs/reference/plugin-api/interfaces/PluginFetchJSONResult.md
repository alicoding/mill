[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginFetchJSONResult

# Interface: PluginFetchJSONResult\<T\>

api.fetchJSON's answer: never throws, not for a denied request, a
non-2xx status, or a body that isn't JSON. Check ok before reading
data; it carries the same non-throwing contract PluginFetchResult
itself does. errorText names what went wrong when ok is false: the
rule that denied the request, the status, or that the body wasn't
valid JSON.

## Type Parameters

### T

`T` = `unknown`

## Properties

### data?

```ts
optional data?: T;
```

***

### errorText?

```ts
optional errorText?: string;
```

***

### ok

```ts
ok: boolean;
```

***

### status

```ts
status: number;
```
