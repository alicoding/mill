import { useMemo } from 'react'
import Anser from 'anser'
import { OutputHighlight } from './OutputHighlight'
import styles from './OutputViewer.module.css'

// The Log view (goal 0326): stdout as a terminal shows it -- monospace,
// numbered lines, colours preserved, wrapping the reader controls.
//
// ANSI parsing is adopted, not hand-rolled: anser (MIT, zero
// dependencies) is the parser the JavaScript tooling world converged
// on for exactly this. ansiToJson with use_classes gives structured
// chunks carrying CLASS names rather than an HTML string, so every
// chunk renders as a React span and no output ever reaches
// dangerouslySetInnerHTML.

interface Chunk {
  content: string
  className: string
}

function chunksOf(line: string): Chunk[] {
  const entries = Anser.ansiToJson(line, { json: true, use_classes: true, remove_empty: true })
  return entries.map((entry) => ({
    content: entry.content,
    // anser's use_classes mode already answers a class name
    // ("ansi-green"), not a colour, so the foreground is used verbatim;
    // only the decorations arrive as bare words. A background colour is
    // deliberately dropped: a terminal paints its own ground, and a
    // block of it inside a themed panel reads as damage rather than as
    // emphasis.
    className: [entry.fg ?? '', ...(entry.decorations ?? []).map((d) => `ansi-${d}`)].filter(Boolean).join(' '),
  }))
}

export function OutputLogView({ text, query = '', wrap, testId }: { text: string; query?: string; wrap: boolean; testId?: string }) {
  const lines = useMemo(() => text.split('\n').map(chunksOf), [text])
  return (
    <div className={`${styles.log} ${wrap ? styles.wrapOn : styles.wrapOff}`} data-scroll-region="output-log" data-testid={testId}>
      <ol className={styles.logLines}>
        {lines.map((chunks, index) => (
          // Line order IS the content: nothing reorders or inserts, so
          // the line number is this row's stable identity.
          <li key={index} className={styles.logLine} data-testid="output-log-line">
            {chunks.map((chunk, ci) => (
              <span key={ci} className={chunk.className}>
                <OutputHighlight text={chunk.content} query={query} />
              </span>
            ))}
          </li>
        ))}
      </ol>
    </div>
  )
}
