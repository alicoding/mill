// Link resolution for the rendered docs article. The markdown is
// authored for the repository (relative .md cross-links, absolute
// https URLs), but it renders inside the app's webview -- a raw anchor
// click would navigate the webview itself away from Mill. Every click
// is classified here instead: external URLs open in the system
// browser, .md cross-links resolve to another indexed docs page.

export type DocLink =
  | { kind: 'external'; url: string }
  | { kind: 'page'; rel: string }
  | { kind: 'ignore' }

// resolveDocLink classifies an anchor's raw href as authored in the
// markdown, resolving relative .md paths against the current page's
// directory (e.g. "../concepts/guardrails.md" from
// "start-here/first-workflow.md" -> "concepts/guardrails.md").
export function resolveDocLink(currentRel: string, href: string): DocLink {
  if (/^https?:\/\//i.test(href)) return { kind: 'external', url: href }
  if (!href.endsWith('.md')) return { kind: 'ignore' }
  const baseDir = currentRel.includes('/') ? currentRel.slice(0, currentRel.lastIndexOf('/')) : ''
  const parts = (baseDir === '' ? [] : baseDir.split('/')).concat(href.split('/'))
  const out: string[] = []
  for (const p of parts) {
    if (p === '' || p === '.') continue
    if (p === '..') {
      if (out.length === 0) return { kind: 'ignore' }
      out.pop()
      continue
    }
    out.push(p)
  }
  return { kind: 'page', rel: out.join('/') }
}
