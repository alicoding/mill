[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / SecretSourceDecl

# Interface: SecretSourceDecl

One source's implementation. `list` and `resolve` are required and
must match the "list" and "resolve" capabilities the manifest
declares; add `discover` or `import` only alongside their own
declared capability.

## Properties

### discover?

```ts
optional discover?: (ctx) => object[];
```

Offers stores found under the configured folder, so a user can
add them as sources of their own. Only for a folder-shaped or
pathless source.

#### Parameters

##### ctx

[`SecretSourceCtx`](SecretSourceCtx.md)

#### Returns

`object`[]

***

### import?

```ts
optional import?: (ctx, keys) => Record<string, string>;
```

Returns several names' values at once, for the one case reading
them one at a time would re-read the same file repeatedly.

#### Parameters

##### ctx

[`SecretSourceCtx`](SecretSourceCtx.md)

##### keys

`string`[]

#### Returns

`Record`\<`string`, `string`\>

***

### list

```ts
list: (ctx) => string[];
```

Returns the NAMES this source holds — never a value. A name is
what a user picks in a secret picker, so make it readable
("api.example.com/password").

#### Parameters

##### ctx

[`SecretSourceCtx`](SecretSourceCtx.md)

#### Returns

`string`[]

***

### resolve

```ts
resolve: (ctx, key) => string;
```

Returns one name's value. Return an empty string when the source
does not hold that name.

#### Parameters

##### ctx

[`SecretSourceCtx`](SecretSourceCtx.md)

##### key

`string`

#### Returns

`string`
