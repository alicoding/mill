// Host-drawn UI a plugin asks for rather than builds. A plugin owns
// its own layout, but not the surfaces Mill has already settled: those
// arrive as one call, so every plugin's version of them is the app's
// version of them.

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
}
