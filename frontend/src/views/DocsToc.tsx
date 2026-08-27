import { useTranslation } from 'react-i18next'
import { NavList } from '@primer/react'
import type { DocsHeading } from './docsHeadings'
import styles from './DocsView.module.css'

interface DocsTocProps {
  headings: DocsHeading[]
  activeId: string
  onSelect: (id: string) => void
}

// The on-page TOC rail (goal 0235 S2): NavList again -- this list IS
// real in-page navigation (each row's href is the heading's own
// anchor), the same fit test DocsNav.tsx already applied to the
// sidebar. `aria-current="location"` (not "page") marks the
// scroll-spied heading -- the reader hasn't left the page, just
// scrolled within it. Absent entirely for a page with no h2/h3 (most
// start-here/concepts pages): S1's centered single-column layout stays
// pixel-identical rather than reserving empty rail space.
export default function DocsToc({ headings, activeId, onSelect }: DocsTocProps) {
  const { t } = useTranslation('views')
  if (headings.length === 0) return null
  return (
    <nav className={styles.toc} aria-label={t('docs.tocAriaLabel')} data-testid="docs-toc">
      <NavList>
        {headings.map((h) => (
          <NavList.Item
            key={h.id}
            href={`#${h.id}`}
            aria-current={h.id === activeId ? 'location' : undefined}
            className={h.level === 3 ? styles.tocItemNested : undefined}
            onClick={(ev) => {
              ev.preventDefault()
              onSelect(h.id)
            }}
            data-testid="docs-toc-item"
          >
            {h.text}
          </NavList.Item>
        ))}
      </NavList>
    </nav>
  )
}
