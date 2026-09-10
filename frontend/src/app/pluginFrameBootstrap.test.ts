// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { buildFrameSrcdoc, millTokenCss } from './pluginFrameBootstrap'

// What Mill prepends to a plugin's page is what makes the frame safe
// and themed: the policy, the folder base, the tokens, the bootstrap.

const BASE = 'http://mill.test/plugins/mill-index/'
const BOOTSTRAP = 'http://mill.test/plugin-frame/bootstrap.js'

const init = { theme: { mode: 'light' as const, scheme: 'light' as const }, state: undefined, context: {}, paletteBindings: [] }

describe('buildFrameSrcdoc', () => {
  it('prepends the base, the policy, the tokens and the bootstrap inside the page head', () => {
    const doc = buildFrameSrcdoc(BASE, [BOOTSTRAP], '<!doctype html><html><head><title>x</title></head><body></body></html>', init, ':root{--fgColor-default:#111}')
    expect(doc).toContain('<base href="')
    expect(doc).toContain('/plugins/mill-index/')
    expect(doc).toContain('http-equiv="Content-Security-Policy"')
    expect(doc).toContain('<style id="mill-tokens">:root{--fgColor-default:#111}</style>')
    // The bootstrap is a served file, never inline script: a srcdoc
    // document inherits Mill's own policy, which forbids inline script.
    expect(doc).toContain(`<script src="${BOOTSTRAP}" crossorigin="anonymous"></script>`)
    expect(doc).toContain('<meta name="mill-frame-init"')
    const parsed = new DOMParser().parseFromString(doc, 'text/html')
    expect(JSON.parse(parsed.querySelector('meta[name="mill-frame-init"]')?.getAttribute('content') ?? '{}')).toMatchObject({ paletteBindings: [] })
    // Injected before the page's own head content, so the policy covers
    // everything the page brings.
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<title>x</title>'))
  })

  it('scopes every source list to the plugin folder and forbids network calls', () => {
    const doc = buildFrameSrcdoc(BASE, [BOOTSTRAP], '<html><head></head><body></body></html>', init, '')
    const parsed = new DOMParser().parseFromString(doc, 'text/html')
    const policy = parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? ''
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("frame-src 'none'")
    for (const directive of ['script-src', 'style-src', 'img-src', 'font-src']) {
      const rule = policy
        .split(';')
        .map((d) => d.trim())
        .find((d) => d.startsWith(`${directive} `))
      expect(rule).toContain('/plugins/mill-index/')
    }
    // Only Mill's own bootstrap joins the folder in script-src; a page
    // cannot run script from anywhere else, inline included.
    expect(policy).toContain(`script-src ${BASE} ${BOOTSTRAP}`)
    expect(policy).not.toContain("script-src 'unsafe-inline'")
  })

  it('gives a page with no head of its own one to carry Mill\'s pieces', () => {
    const doc = buildFrameSrcdoc('http://mill.test/plugins/probe/', [BOOTSTRAP], '<div>bare</div>', init, '')
    const parsed = new DOMParser().parseFromString(doc, 'text/html')
    expect(parsed.querySelector('base')).not.toBeNull()
    expect(parsed.body.innerHTML).toContain('<div>bare</div>')
  })

  it('escapes the injected init so it cannot close its own attribute or element', () => {
    const doc = buildFrameSrcdoc('http://mill.test/plugins/probe/', [BOOTSTRAP], '<html><head></head></html>', { ...init, state: '"><script>stolen()</script>' }, '')
    const parsed = new DOMParser().parseFromString(doc, 'text/html')
    // The embedded quote never closes the attribute: exactly one meta
    // carries the whole JSON blob, parseable back to the original
    // value, and no extra element (a live <script> included) exists.
    const metas = parsed.querySelectorAll('meta[name="mill-frame-init"]')
    expect(metas).toHaveLength(1)
    const initBack: { state: string } = JSON.parse(metas[0].getAttribute('content') ?? '')
    expect(initBack.state).toBe('"><script>stolen()</script>')
    expect(parsed.querySelectorAll('script')).toHaveLength(1)
  })
})

describe('millTokenCss', () => {
  it('writes the documented tokens the host resolved as one declaration block, skipping the ones it could not', () => {
    const css = millTokenCss((name) => (name === '--fgColor-default' ? ' rgb(1, 2, 3) ' : ''))
    expect(css).toBe(':root{--fgColor-default:rgb(1, 2, 3)}')
  })
})
