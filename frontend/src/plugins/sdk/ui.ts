// Host-drawn UI a plugin asks for rather than builds (renderOutput),
// plus the one safe way to build the rest of its own layout (el) --
// a plugin owns its own layout, but not the surfaces Mill has already
// settled, and not the one way markup can turn into an injection.

/** The kind of thing this output IS, when the plugin knows. Omit it and
 * Mill works the shape out from the value and says so on screen, which
 * a reader can override. `rows` means an array of objects. */
export type PluginOutputShape = 'json' | 'rows' | 'text' | 'html' | 'markdown' | 'error' | 'binary'

export interface PluginOutputOptions {
  /** What the value is. Prefer declaring it: an inferred shape is a
   * guess, a declared one is a fact. */
  shape?: PluginOutputShape
  /** The value's media type, if a response gave you one. Used when
   * `shape` is absent — `application/json` picks the tree, `text/html`
   * the rendered view, and so on. */
  mime?: string
  /** A short name for what this output is, used as the viewer's
   * accessible label and as its title when opened full. */
  title?: string
}

export interface PluginUIAPI {
  /** Draws a value into `el` the way Mill draws every other piece of
   * output: a tree for JSON, a table for rows, a numbered log with
   * ANSI colours for text, a sandboxed frame for HTML and Markdown, an
   * error block with copyable details for a failure — with Raw always
   * one click away, plus Find, Copy, Wrap and Open in full.
   *
   * The element's existing children are replaced. Returns a function
   * that removes the viewer again; a view that redraws itself should
   * call it before drawing over the same element.
   *
   * Read-only by construction: there is no editable control anywhere
   * in it, so a plugin can hand a user output without also handing
   * them a text box that pretends to be one. */
  renderOutput: (el: HTMLElement, value: unknown, options?: PluginOutputOptions) => () => void
  /** Builds one DOM element the safe way, in the same document `el`
   * this SDK call runs in — a face's own document for a canvas
   * object, Mill's document for a same-DOM plugin's other UI. attrs'
   * values become attribute strings (never `innerHTML`); an `on*` key
   * whose value is a function adds that event listener instead; a
   * `style` object assigns onto the element's own style. A string
   * child becomes a text node, never markup, so nothing you pass can
   * inject anything; a `null`/`undefined` child is skipped. Returns
   * the built element unattached — append it yourself. */
  el: <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: PluginElAttrs, children?: PluginElChild[]) => HTMLElementTagNameMap[K]
}

/** el's attrs bag: a string/number/boolean becomes that attribute's
 * value (a boolean of `false` omits the attribute entirely); an `on*`
 * key (`onclick`, `oninput`, …) with a function value adds that event
 * listener; `style` with an object value assigns onto the element's
 * own `style`, property by property. */
export type PluginElAttrs = Record<string, string | number | boolean | ((event: Event) => void) | Record<string, string> | undefined>

/** el's children: a string becomes a text node, an existing Node is
 * appended as-is, and `null`/`undefined` is skipped — so a conditional
 * child reads as `condition ? el(...) : null`. */
export type PluginElChild = string | Node | null | undefined
