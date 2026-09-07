import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The top-level document's own Content-Security-Policy (goal 0375 S1a):
// unlike pluginFrameBootstrap.test.ts's policy (built at runtime for
// every plugin frame), this one is static markup in frontend/index.html
// -- read and parsed here rather than exercised through a component, the
// same static-source-audit shape atlasBoardSurfaceConformance.test.ts
// documents for a policy that has no runtime call site of its own.

const INDEX_HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html')

function readPolicy(): string {
  const html = readFileSync(INDEX_HTML_PATH, 'utf-8')
  const metaTag = /<meta\s+http-equiv="Content-Security-Policy"[^>]*>/.exec(html)?.[0]
  if (!metaTag) throw new Error('index.html carries no Content-Security-Policy meta tag')
  const content = /content="([^"]*)"/.exec(metaTag)?.[1]
  if (content === undefined) throw new Error('the Content-Security-Policy meta tag has no content attribute')
  return content
}

describe('index.html Content-Security-Policy', () => {
  it('is the first element in <head>', () => {
    const html = readFileSync(INDEX_HTML_PATH, 'utf-8')
    const headOpen = /<head[^>]*>/.exec(html)
    const metaTagStart = html.indexOf('<meta http-equiv="Content-Security-Policy"')
    expect(headOpen).not.toBeNull()
    expect(metaTagStart).toBeGreaterThan(-1)
    // Nothing but the head's own opening tag and this file's leading
    // comments may sit between <head> and the policy tag itself: any
    // other element there would load ungoverned by it. Strip HTML
    // comments first, then require no "<" survives at all -- an
    // element-name allowlist reads as an HTML tag filter to static
    // analysis, which correctly flags a filter regex as unsound for
    // untrusted input; this file is Mill's own, so the sound check is
    // "no element of any kind", not "none of these particular names".
    const between = html.slice((headOpen?.index ?? 0) + (headOpen?.[0].length ?? 0), metaTagStart)
    const withoutComments = between.replace(/<!--[\s\S]*?-->/g, '')
    expect(withoutComments).not.toContain('<')
  })

  it('never grants unsafe-eval', () => {
    const policy = readPolicy()
    expect(policy).not.toContain('unsafe-eval')
  })

  it('closes plugin/object embedding the way pluginFrameBootstrap.ts closes a frame', () => {
    const policy = readPolicy()
    expect(policy).toContain("object-src 'none'")
  })

  it('declares default-src, base-uri and form-action so an unlisted directive fails closed', () => {
    const policy = readPolicy()
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("base-uri 'self'")
    expect(policy).toContain("form-action 'self'")
  })
})
