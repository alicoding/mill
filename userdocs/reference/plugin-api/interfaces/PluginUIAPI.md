[**Mill plugin API**](../index.md)

***

[Mill plugin API](../index.md) / PluginUIAPI

# Interface: PluginUIAPI

## Properties

### el

```ts
el: <K>(tag, attrs?, children?) => HTMLElementTagNameMap[K];
```

Builds one DOM element the safe way, in the same document `el`
this SDK call runs in — a face's own document for a canvas
object, Mill's document for a same-DOM plugin's other UI. attrs'
values become attribute strings (never `innerHTML`); an `on*` key
whose value is a function adds that event listener instead; a
`style` object assigns onto the element's own style. A string
child becomes a text node, never markup, so nothing you pass can
inject anything; a `null`/`undefined` child is skipped. Returns
the built element unattached — append it yourself.

#### Type Parameters

##### K

`K` *extends* keyof `HTMLElementTagNameMap`

#### Parameters

##### tag

`K`

##### attrs?

[`PluginElAttrs`](../type-aliases/PluginElAttrs.md)

##### children?

[`PluginElChild`](../type-aliases/PluginElChild.md)[]

#### Returns

`HTMLElementTagNameMap`\[`K`\]

***

### renderOutput

```ts
renderOutput: (el, value, options?) => () => void;
```

Draws a value into `el` the way Mill draws every other piece of
output: a tree for JSON, a table for rows, a numbered log with
ANSI colours for text, a sandboxed frame for HTML and Markdown, an
error block with copyable details for a failure — with Raw always
one click away, plus Find, Copy, Wrap and Open in full.

The element's existing children are replaced. Returns a function
that removes the viewer again; a view that redraws itself should
call it before drawing over the same element.

Read-only by construction: there is no editable control anywhere
in it, so a plugin can hand a user output without also handing
them a text box that pretends to be one.

#### Parameters

##### el

`HTMLElement`

##### value

`unknown`

##### options?

[`PluginOutputOptions`](PluginOutputOptions.md)

#### Returns

() => `void`
