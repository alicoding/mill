import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavList, Text } from '@primer/react'
import { DocsService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import mirrorStyles from '../atlas/AtlasCardMirrorPreview.module.css'
import styles from './DocsView.module.css'

// The in-app Docs surface (goal 0125 phase 1): the same userdocs tree
// the repository publishes and llms.txt indexes, embedded in the
// binary and rendered through the shared markdown path. Nav order is
// the canonical reading order (DocsIndex == the llms index), so the
// human surface and the AI surface can never disagree.
interface IndexEntry {
  rel: string
  title: string
  note: string
}

function DocsView({ initialPage }: { initialPage?: string }) {
  const { t } = useTranslation('views')
  const setView = useAppStore((s) => s.setView)
  const [index, setIndex] = useState<IndexEntry[]>([])
  const [page, setPage] = useState(initialPage ?? '')
  const [html, setHtml] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    DocsService.DocsIndex()
      .then((entries) => {
        const list = (entries ?? []).map((e) => ({ rel: e.rel, title: e.title, note: e.note }))
        setIndex(list)
        if (!initialPage && list.length > 0) setPage(list[0].rel)
      })
      .catch((err) => setError(String(err)))
  }, [initialPage])

  useEffect(() => {
    if (!page) return
    setError('')
    DocsService.DocPageHTML(page)
      .then(setHtml)
      .catch((err) => setError(String(err)))
  }, [page])

  return (
    <div className={styles.docs} data-testid="docs-view">
      <nav className={styles.nav} aria-label={t('docs.navAriaLabel')}>
        <NavList>
          {index.map((e) => (
            <NavList.Item
              key={e.rel}
              href="#"
              aria-current={e.rel === page ? 'page' : undefined}
              onClick={(ev) => {
                ev.preventDefault()
                setPage(e.rel)
                setView({ kind: 'docs', page: e.rel })
              }}
              data-testid="docs-nav-item"
            >
              {e.title}
            </NavList.Item>
          ))}
        </NavList>
      </nav>
      <div className={styles.content}>
        {error && <Text className={styles.error} data-testid="docs-error">{error}</Text>}
        {!error && (
          // Same trusted-render reasoning as the Atlas mirror preview:
          // the HTML comes from Mill's own markdown renderer over
          // repository-authored content embedded in the binary.
          <article
            className={mirrorStyles.markdownBody}
            data-testid="docs-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}

export default DocsView
