[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginConvertAPI

# Interface: PluginConvertAPI

Pure transforms Mill already implements, offered to a plugin as-is.
htmlToMarkdown is the exact conversion every paste and every
workflow convert step uses. No capability required -- a transform
reaches nothing outside the input you pass it.

## Properties

### htmlToMarkdown

```ts
htmlToMarkdown: (html) => Promise<string>;
```

#### Parameters

##### html

`string`

#### Returns

`Promise`\<`string`\>
