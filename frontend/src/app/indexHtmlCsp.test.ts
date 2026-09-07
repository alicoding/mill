// @vitest-environment jsdom
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
// Parsed with DOMParser, never a regexp over the markup: structured
// text gets a real parser, and a regexp matching HTML element/attribute
// syntax reads as an (unsound, for untrusted input) HTML filter to
// static analysis regardless of how this file actually uses the match.

const INDEX_HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'index.html')

function parseIndexHtml(): Document {
  const html = readFileSync(INDEX_HTML_PATH, 'utf-8')
  return new DOMParser().parseFromString(html, 'text/html')
}

function cspMeta(doc: Document): HTMLMetaElement {
  // The attribute-value selector's "i" flag matches an http-equiv
  // written in any case -- CSS selector syntax, not a hand-rolled
  // pattern over the markup.
  const meta = doc.head.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy" i]')
  if (!meta) throw new Error('index.html carries no Content-Security-Policy meta tag')
  return meta
}

// The policy's own directive-list grammar (";"-separated, each
// "name value..."), not markup -- splitting it is a grammar-level
// parse, not an HTML match.
function directives(policy: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const part of policy.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) continue
    map.set(tokens[0], tokens.slice(1))
  }
  return map
}

function readPolicy(): string {
  return cspMeta(parseIndexHtml()).content
}

describe('index.html Content-Security-Policy', () => {
  it('is the first element in <head>', () => {
    const doc = parseIndexHtml()
    const meta = cspMeta(doc)
    // Nothing may sit ahead of the policy tag in <head> -- any earlier
    // element there would load ungoverned by it.
    expect(doc.head.firstElementChild).toBe(meta)
  })

  it('never grants unsafe-eval', () => {
    const scriptSrc = directives(readPolicy()).get('script-src') ?? []
    expect(scriptSrc).not.toContain("'unsafe-eval'")
    expect(scriptSrc).not.toContain("'wasm-unsafe-eval'")
  })

  it('closes plugin/object embedding the way pluginFrameBootstrap.ts closes a frame', () => {
    const objectSrc = directives(readPolicy()).get('object-src') ?? []
    expect(objectSrc).toEqual(["'none'"])
  })

  it('declares default-src, base-uri and form-action so an unlisted directive fails closed', () => {
    const policy = directives(readPolicy())
    expect(policy.get('default-src')).toEqual(["'self'"])
    expect(policy.get('base-uri')).toEqual(["'self'"])
    expect(policy.get('form-action')).toEqual(["'self'"])
  })
})
