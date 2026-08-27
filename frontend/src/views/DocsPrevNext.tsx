import { useTranslation } from 'react-i18next'
import type { DocsIndexEntry } from './docsGroups'
import styles from './DocsView.module.css'

interface DocsPrevNextProps {
  prev?: DocsIndexEntry
  next?: DocsIndexEntry
  onNavigate: (rel: string) => void
}

// The prev/next footer (goal 0235 S1): derived from DocsIndex's flat
// reading order, hidden at whichever end has no neighbor -- there is
// no "previous" before the first page or "next" after the last.
export default function DocsPrevNext({ prev, next, onNavigate }: DocsPrevNextProps) {
  const { t } = useTranslation('views')
  if (!prev && !next) return null
  return (
    <div className={styles.prevNext}>
      {prev ? (
        <a
          href="#"
          className={`${styles.prevNextCard} ${styles.prevNextCardPrev}`}
          onClick={(ev) => { ev.preventDefault(); onNavigate(prev.rel) }}
          data-testid="docs-prev-link"
        >
          <span className={styles.prevNextLabel}>{t('docs.previous')}</span>
          <span className={styles.prevNextTitle}>{prev.title}</span>
        </a>
      ) : <span />}
      {next ? (
        <a
          href="#"
          className={`${styles.prevNextCard} ${styles.prevNextCardNext}`}
          onClick={(ev) => { ev.preventDefault(); onNavigate(next.rel) }}
          data-testid="docs-next-link"
        >
          <span className={styles.prevNextLabel}>{t('docs.next')}</span>
          <span className={styles.prevNextTitle}>{next.title}</span>
        </a>
      ) : <span />}
    </div>
  )
}
