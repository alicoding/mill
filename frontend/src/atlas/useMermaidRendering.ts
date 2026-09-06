import { useEffect } from 'react'
import type { RefObject } from 'react'

// Renders ```mermaid fences inside server-rendered markdown (the
// mirror preview's goldmark HTML) as inline SVG diagrams. The mermaid
// package is bundled (no CDN -- offline and no-phone-home constraints)
// but loaded lazily via dynamic import, so its weight is a separate
// chunk that never loads unless a mermaid fence is actually on screen.
// A fence that fails to parse keeps its original code block -- an
// honest fallback, never a broken half-diagram.

let mermaidModule: Promise<typeof import('mermaid')> | null = null

// A rejected import must never be cached: the memo below would hand the
// same rejection to every later render for the page's lifetime, so one
// transient chunk fetch failure would permanently stop diagrams.
function loadMermaid() {
  mermaidModule ??= import('mermaid').catch((err: unknown) => {
    mermaidModule = null
    throw err
  })
  return mermaidModule
}

// Reads Primer tokens at render time so diagrams follow the app theme
// (including a live light/dark switch -- initialize() is re-applied per
// render pass with the tokens' current values).
function themeVariables() {
  const tokens = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => tokens.getPropertyValue(name).trim() || fallback
  const bg = read('--bgColor-default', '#ffffff')
  const fg = read('--fgColor-default', '#1f2328')
  const border = read('--borderColor-default', '#d1d9e0')
  const accentBg = read('--bgColor-accent-muted', '#ddf4ff')
  return {
    background: bg,
    primaryColor: accentBg,
    primaryTextColor: fg,
    primaryBorderColor: border,
    secondaryColor: bg,
    tertiaryColor: bg,
    lineColor: border,
    textColor: fg,
    fontFamily: tokens.getPropertyValue('--fontStack-sansSerif').trim() || 'sans-serif',
  }
}

let renderSeq = 0

// The engine is a lazy chunk, so a host holding fences is NOT finished
// when it mounts. data-mermaid-state is the settled signal anything
// observing the rendered output waits on: 'pending' while the chunk
// loads and the fences render, then 'settled' once every fence has
// either become a diagram or honestly kept its code block. A host with
// no fences is 'settled' immediately. data-mermaid-error carries the
// first fence's failure text so a silent engine fault is diagnosable
// rather than indistinguishable from a slow load. The host's caller is
// responsible for the subtree surviving in between: React re-assigns
// innerHTML on any re-render of an inline-literal dangerouslySetInnerHTML
// prop, so the host renders behind a memo boundary (MirrorMarkdownHost,
// MermaidDiagramHost) and this hook re-derives everything from
// contentKey, never from stale child nodes.
const STATE_ATTR = 'data-mermaid-state'
const ERROR_ATTR = 'data-mermaid-error'

export function useMermaidRendering(ref: RefObject<HTMLElement | null>, contentKey: string | null) {
  useEffect(() => {
    const host = ref.current
    if (!host) return
    const fences = Array.from(host.querySelectorAll('code.language-mermaid'))
    host.removeAttribute(ERROR_ATTR)
    if (fences.length === 0) {
      host.setAttribute(STATE_ATTR, 'settled')
      return
    }
    host.setAttribute(STATE_ATTR, 'pending')
    let cancelled = false
    const settle = () => { if (!cancelled) host.setAttribute(STATE_ATTR, 'settled') }
    const recordError = (err: unknown) => {
      if (cancelled) return
      const prior = host.getAttribute(ERROR_ATTR)
      host.setAttribute(ERROR_ATTR, prior ? `${prior} | ${String(err)}` : String(err))
    }
    void loadMermaid().then(async ({ default: mermaid }) => {
      if (cancelled) return
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: themeVariables() })
      for (const code of fences) {
        const pre = code.closest('pre')
        // A re-render can swap the host's subtree between capturing the
        // fences and the engine finishing; a captured fence whose pre is
        // no longer in this host is re-found by the next effect run, so
        // skip it honestly rather than writing into detached DOM.
        if (!pre || !pre.parentNode || !host.contains(pre)) continue
        const source = code.textContent ?? ''
        const id = `mill-mermaid-${++renderSeq}`
        try {
          const { svg } = await mermaid.render(id, source)
          if (cancelled) return
          const wrapper = document.createElement('div')
          wrapper.setAttribute('data-testid', 'atlas-mermaid-diagram')
          wrapper.className = 'atlas-mermaid-diagram'
          wrapper.innerHTML = svg
          pre.replaceWith(wrapper)
        } catch (err) {
          // Parse failure: the original code block stays visible as-is.
          // mermaid.render leaves an orphaned element on <body> in some
          // failure modes -- sweep it so nothing leaks outside the
          // preview. mermaid prefixes the id it inserts with 'd'.
          recordError(err)
          document.getElementById(id)?.remove()
          document.getElementById(`d${id}`)?.remove()
        }
      }
      settle()
    }).catch((err: unknown) => {
      recordError(err)
      settle()
    })
    return () => { cancelled = true }
  }, [ref, contentKey])
}
