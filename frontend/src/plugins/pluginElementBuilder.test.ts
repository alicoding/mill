// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { buildElement } from './pluginElementBuilder'

describe('buildElement (api.ui.el)', () => {
  it('sets string/number attrs and appends text children, never markup', () => {
    const el = buildElement(document, 'div', { 'data-testid': 'probe', tabindex: 0 }, ['<b>not html</b>'])
    expect(el.tagName).toBe('DIV')
    expect(el.getAttribute('data-testid')).toBe('probe')
    expect(el.getAttribute('tabindex')).toBe('0')
    expect(el.textContent).toBe('<b>not html</b>')
    expect(el.querySelector('b')).toBeNull()
  })

  it('omits a false-valued attr entirely', () => {
    const el = buildElement(document, 'input', { disabled: false, required: true })
    expect(el.hasAttribute('disabled')).toBe(false)
    expect(el.getAttribute('required')).toBe('true')
  })

  it('wires an on* function as a real event listener, not an attribute', () => {
    const onClick = vi.fn()
    const el = buildElement(document, 'button', { onclick: onClick })
    expect(el.hasAttribute('onclick')).toBe(false)
    el.dispatchEvent(new MouseEvent('click'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('assigns a style object onto the element style', () => {
    const el = buildElement(document, 'div', { style: { color: 'red', display: 'flex' } })
    expect(el.style.color).toBe('red')
    expect(el.style.display).toBe('flex')
  })

  it('appends an existing Node child and skips null/undefined children', () => {
    const span = document.createElement('span')
    const el = buildElement(document, 'div', undefined, [span, null, undefined, 'text'])
    expect(el.children).toHaveLength(1)
    expect(el.firstChild).toBe(span)
    expect(el.textContent).toBe('text')
  })
})
