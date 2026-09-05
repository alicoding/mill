import { useMemo, useSyncExternalStore } from 'react'
import { marked } from 'marked'
import { readResolvedTheme, subscribeResolvedTheme } from './appearance'
import styles from './OutputViewer.module.css'

// The Rendered view (goal 0326): HTML and Markdown output shown as the
// document it is.
//
// The frame is the security boundary, not a sanitizer allowlist.
// sandbox="" grants NOTHING -- no scripts, no forms, no same-origin, no
// top-level navigation -- and the document's own CSP grants no network
// at all, so an <img> pointing at a tracker cannot fire and inline
// script cannot run. Output arrives from an HTTP response, a shell
// step, or a plugin: it is never trusted, and it is never given a way
// to reach back into the app.
//
// Markdown becomes HTML through the already-adopted marked parser and
// then enters the SAME frame, so the two shapes share one boundary
// instead of each growing its own.

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:"

// A sandboxed frame is a separate document: none of the app's custom
// properties resolve inside it. The two colours it needs are read as
// COMPUTED values from the host root and inlined, re-read whenever the
// resolved appearance changes.
function frameColors(): { fg: string; bg: string } {
  if (typeof window === 'undefined') return { fg: '#1f2328', bg: '#ffffff' }
  const root = getComputedStyle(document.documentElement)
  return {
    fg: root.getPropertyValue('--fgColor-default').trim() || '#1f2328',
    bg: root.getPropertyValue('--bgColor-default').trim() || '#ffffff',
  }
}

export function documentFor(body: string, fg: string, bg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><style>
html,body{margin:0;padding:8px 12px;color:${fg};background:${bg};font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;word-break:break-word}
img,table{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid currentColor;padding:2px 6px}
pre,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
pre{overflow-x:auto;padding:8px;border-radius:6px;background:rgba(127,127,127,0.12)}
</style></head><body>${body}</body></html>`
}

export function OutputRenderedView({ text, markdown, ariaLabel, testId }: { text: string; markdown: boolean; ariaLabel: string; testId?: string }) {
  const theme = useSyncExternalStore(subscribeResolvedTheme, themeKey, () => 'light')
  const srcDoc = useMemo(() => {
    const body = markdown ? String(marked.parse(text, { async: false })) : text
    // The colours are read from the document root imperatively, so the
    // resolved appearance is what this memo actually depends on.
    void theme
    const { fg, bg } = frameColors()
    return documentFor(body, fg, bg)
  }, [text, markdown, theme])
  return (
    <iframe
      className={styles.frame}
      // An empty sandbox is the point: every capability stays revoked.
      sandbox=""
      srcDoc={srcDoc}
      title={ariaLabel}
      data-testid={testId}
    />
  )
}

// useSyncExternalStore compares snapshots by identity, so the theme is
// read as one string rather than a fresh object per call.
function themeKey(): string {
  const resolved = readResolvedTheme()
  return `${resolved.mode}/${resolved.scheme}`
}
