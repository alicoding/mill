import { Fragment } from 'react'
import { findMatches } from './outputShape'
import styles from './OutputViewer.module.css'

// One find-hit renderer for every view that draws its own text (goal
// 0326's Tree, Log and Table). A <mark> per hit, nothing else: the
// browser's own semantic for "this is what you searched for", so the
// highlight survives a theme change and reads to a screen reader.
export function OutputHighlight({ text, query }: { text: string; query: string }) {
  if (query === '') return <>{text}</>
  const hits = findMatches(text, query)
  if (hits.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let cursor = 0
  hits.forEach((at, index) => {
    if (at > cursor) parts.push(<Fragment key={`t${index}`}>{text.slice(cursor, at)}</Fragment>)
    parts.push(<mark key={`m${index}`} className={styles.hit}>{text.slice(at, at + query.length)}</mark>)
    cursor = at + query.length
  })
  if (cursor < text.length) parts.push(<Fragment key="tail">{text.slice(cursor)}</Fragment>)
  return <>{parts}</>
}
