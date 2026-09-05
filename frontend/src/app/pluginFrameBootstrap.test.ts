import { describe, expect, it } from 'vitest'
import { buildFrameSrcdoc, millTokenCss } from './pluginFrameBootstrap'

// What Mill prepends to a plugin's page is what makes the frame safe
// and themed: the policy, the folder base, the tokens, the bootstrap.

const BASE = 'http://mill.test/plugins/mill-index/'

const init = { theme: { mode: 'light' as const, scheme: 'light' as const }, state: undefined, context: {} }

describe('buildFrameSrcdoc', () => {
  it('prepends the base, the policy, the tokens and the bootstrap inside the page head', () => {
    const doc = buildFrameSrcdoc(BASE, '<!doctype html><html><head><title>x</title></head><body></body></html>', init, ':root{--fgColor-default:#111}')
    expect(doc).toContain('<base href="')
    expect(doc).toContain('/plugins/mill-index/')
    expect(doc).toContain('http-equiv="Content-Security-Policy"')
    expect(doc).toContain('<style id="mill-tokens">:root{--fgColor-default:#111}</style>')
    expect(doc).toContain('acquireMillApi')
    expect(doc).toContain('acquireVsCodeApi')
    // Injected before the page's own head content, so the policy covers
    // everything the page brings.
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<title>x</title>'))
  })

  it('scopes every source list to the plugin folder and forbids network calls', () => {
    const doc = buildFrameSrcdoc(BASE, '<html><head></head><body></body></html>', init, '')
    const policy = /content="([^"]+)"/.exec(doc)?.[1] ?? ''
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("frame-src 'none'")
    for (const directive of ['script-src', 'style-src', 'img-src', 'font-src']) {
      expect(policy).toMatch(new RegExp(`${directive} [^;]*/plugins/mill-index/`))
    }
  })

  it('gives a page with no head of its own one to carry Mill\'s pieces', () => {
    const doc = buildFrameSrcdoc('http://mill.test/plugins/probe/', '<div>bare</div>', init, '')
    expect(doc.startsWith('<head>')).toBe(true)
    expect(doc).toContain('<div>bare</div>')
  })

  it('escapes the injected init so it cannot close its own script element', () => {
    const doc = buildFrameSrcdoc('http://mill.test/plugins/probe/', '<html><head></head></html>', { ...init, state: '</script><script>stolen()' }, '')
    expect(doc).not.toContain('</script><script>stolen()')
    expect(doc).toContain('\\u003c/script')
  })
})

describe('millTokenCss', () => {
  it('writes the documented tokens the host resolved as one declaration block, skipping the ones it could not', () => {
    const css = millTokenCss((name) => (name === '--fgColor-default' ? ' rgb(1, 2, 3) ' : ''))
    expect(css).toBe(':root{--fgColor-default:rgb(1, 2, 3)}')
  })
})
