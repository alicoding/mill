[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginViewHandle

# Interface: PluginViewHandle

What registerView answers: the plugin's end of the two-way channel
to its own entry page. postMessage delivers a value to the page's
`onMessage` handlers, and the page's own `postMessage` arrives at the
`onMessage` this declaration carries. On a view that renders into
Mill's document instead of a page, postMessage has nowhere to
deliver and does nothing.

## Properties

### postMessage

```ts
postMessage: (message) => void;
```

#### Parameters

##### message

`unknown`

#### Returns

`void`
