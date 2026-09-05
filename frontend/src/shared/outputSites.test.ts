import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The migration pin (goal 0326): output is PRESENTED, never typed, so
// no surface renders a run's answer, a response body, a schema or a
// failure as a slab of preformatted text. A `<pre>` in a .tsx is how
// that regresses, and it regresses quietly -- one new panel, one
// `<pre className={styles.result}>`, and the app has two output
// grammars again.
//
// So every remaining `<pre>` is listed here WITH its reason. A new one
// fails this test, and the fix is either the shared viewer or a line
// below saying, in one sentence, why this content is not output.

const ALLOWED: Record<string, string> = {
  'app/AppErrorBoundary.tsx':
    "the app's own crash detail, rendered by the boundary that catches it: it must not depend on the store, i18n or the command registry, any of which may be what just failed",
  'app/ClipboardHistoryDetail.tsx':
    'a captured clipboard entry is content the user copied, not output a step produced',
  'atlas/AtlasCardMirrorPreview.tsx':
    "a mirrored file's own content, on the Atlas content plane",
  'atlas/AtlasUnitMermaidPage.tsx':
    "a pre/code string that IS the diagram renderer's required input shape, not a rendering choice",
}

const SRC = fileURLToPath(new URL('..', import.meta.url))

function tsxFiles(dir: string, prefix = '', out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) tsxFiles(join(dir, entry.name), rel, out)
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) out.push(rel)
  }
  return out
}

describe('output is presented, never typed', () => {
  it('has no preformatted output block outside the viewer and its listed exceptions', () => {
    const offenders = tsxFiles(SRC)
      .filter((rel) => !rel.startsWith('shared/Output'))
      .filter((rel) => readFileSync(join(SRC, rel), 'utf8').includes('<pre'))
      .filter((rel) => !(rel in ALLOWED))
    expect(offenders).toEqual([])
  })

  it('keeps every listed exception real, so the list cannot outlive what it excuses', () => {
    const stale = Object.keys(ALLOWED).filter((rel) => !readFileSync(join(SRC, rel), 'utf8').includes('<pre'))
    expect(stale).toEqual([])
  })

  it('gives every exception a reason', () => {
    expect(Object.values(ALLOWED).filter((why) => why.length < 20)).toEqual([])
  })
})
