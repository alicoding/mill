import type { PluginElAttrs, PluginElChild } from './sdk'

/** api.ui.el's implementation: every bookmark/clipper/index-shaped
 * plugin hand-rolled this exact createElement/setAttribute/textContent
 * sequence (goal 0386 S1's own inventory). doc is a parameter, not
 * document, so the same builder works in a canvas object's own
 * document as it does in Mill's: never innerHTML, so nothing passed
 * through attrs or children can inject markup. */
export function buildElement<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, attrs?: PluginElAttrs, children?: PluginElChild[]): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag)
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === false) continue
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      continue
    }
    if (key === 'style' && value && typeof value === 'object') {
      Object.assign(el.style, value)
      continue
    }
    el.setAttribute(key, String(value))
  }
  for (const child of children ?? []) {
    if (child == null) continue
    el.append(typeof child === 'string' ? doc.createTextNode(child) : child)
  }
  return el
}
