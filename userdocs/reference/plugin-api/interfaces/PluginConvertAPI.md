[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginConvertAPI

# Interface: PluginConvertAPI

PluginConvertAPI (goal 0282): pure transforms Mill already owns,
offered to a plugin as-is. htmlToMarkdown is the same conversion
every workflow convert step and every paste uses. No capability --
a transform reaches nothing outside its own input.

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
