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

function loadMermaid() {
  mermaidModule ??= import('mermaid')
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

export function useMermaidRendering(ref: RefObject<HTMLElement | null>, contentKey: string | null) {
  useEffect(() => {
    const host = ref.current
    if (!host) return
    const fences = Array.from(host.querySelectorAll('code.language-mermaid'))
    if (fences.length === 0) return
    let cancelled = false
    void loadMermaid().then(async ({ default: mermaid }) => {
      if (cancelled) return
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: themeVariables() })
      for (const code of fences) {
        const pre = code.closest('pre')
        if (!pre || !pre.parentNode) continue
        const source = code.textContent ?? ''
        try {
          const { svg } = await mermaid.render(`mill-mermaid-${++renderSeq}`, source)
          if (cancelled) return
          const wrapper = document.createElement('div')
          wrapper.setAttribute('data-testid', 'atlas-mermaid-diagram')
          wrapper.className = 'atlas-mermaid-diagram'
          wrapper.innerHTML = svg
          pre.replaceWith(wrapper)
        } catch {
          // Parse failure: the original code block stays visible as-is.
          // mermaid.render leaves an orphaned error element on <body> in
          // some failure modes -- sweep it so nothing leaks outside the
          // preview.
          document.getElementById(`mill-mermaid-${renderSeq}`)?.remove()
        }
      }
    })
    return () => { cancelled = true }
  }, [ref, contentKey])
}
