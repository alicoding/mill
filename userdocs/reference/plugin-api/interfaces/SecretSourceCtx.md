[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / SecretSourceCtx

# Interface: SecretSourceCtx

The doors one source call receives. There is no other way to reach
the machine from a source: no network, no command, no path outside
the one the user configured.

## Properties

### listFiles

```ts
listFiles: (pattern?) => string[];
```

Lists the folder's own files, optionally narrowed by a glob such
as `"*.env"`. Folder-shaped sources only.

#### Parameters

##### pattern?

`string`

#### Returns

`string`[]

***

### path

```ts
path: string;
```

The file or folder the user configured this source with.

***

### readFile

```ts
readFile: (relative?) => string;
```

Reads the configured file. For a folder-shaped source, pass a
name inside that folder; anything that would leave the folder is
refused.

#### Parameters

##### relative?

`string`

#### Returns

`string`
