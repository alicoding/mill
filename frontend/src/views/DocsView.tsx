import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Browser } from '@wailsio/runtime'
import { Text } from '@primer/react'
import { DocsService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { resolveDocLink } from './docLinks'
import { adjacentPages, groupDocsIndex, sectionTitleKey, type DocsIndexEntry } from './docsGroups'
import DocsNav from './DocsNav'
import DocsPrevNext from './DocsPrevNext'
import styles from './DocsView.module.css'

function dirOf(rel: string): string {
  const slash = rel.indexOf('/')
  return slash === -1 ? '' : rel.slice(0, slash)
}

// The in-app Docs surface (goal 0125 phase 1, restructured by goal
// 0235 S1): the same userdocs tree the repository publishes and
// llms.txt indexes, embedded in the binary and rendered through the
// shared markdown path. Nav order is the canonical reading order
// (DocsIndex == the llms index), so the human surface and the AI
// surface can never disagree.
function DocsView({ initialPage }: { initialPage?: string }) {
  const { t } = useTranslation('views')
  const setView = useAppStore((s) => s.setView)
  const [index, setIndex] = useState<DocsIndexEntry[]>([])
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

  const groups = useMemo(() => groupDocsIndex(index), [index])
  const { prev, next } = useMemo(() => adjacentPages(index, page), [index, page])
  const currentEntry = index.find((e) => e.rel === page)
  const currentSectionKey = sectionTitleKey(dirOf(page))

  const goTo = (rel: string) => {
    setPage(rel)
    setView({ kind: 'docs', page: rel })
  }

  return (
    <div className={styles.docs} data-testid="docs-view">
      <DocsNav groups={groups} currentPage={page} onSelect={goTo} />
      <div className={styles.content}>
        {currentEntry && (
          <header className={styles.pageHeader} data-testid="docs-breadcrumb">
            <span className={styles.pageHeaderSection}>
              {currentSectionKey ? t(currentSectionKey) : dirOf(page)}
            </span>
            <h1 className={styles.pageHeaderTitle}>{currentEntry.title}</h1>
          </header>
        )}
        {error && <Text className={styles.error} data-testid="docs-error">{error}</Text>}
        {!error && (
          // Same trusted-render reasoning as the Atlas mirror preview:
          // the HTML comes from Mill's own markdown renderer over
          // repository-authored content embedded in the binary. Anchor
          // clicks are intercepted (docLinks.ts): a raw click would
          // navigate the app's own webview away from Mill -- external
          // URLs go to the system browser, .md cross-links stay in-app.
          <article
            className={styles.article}
            data-testid="docs-content"
            onClick={(ev) => {
              const anchor = (ev.target as HTMLElement).closest('a')
              const href = anchor?.getAttribute('href')
              if (!href) return
              ev.preventDefault()
              const link = resolveDocLink(page, href)
              if (link.kind === 'external') void Browser.OpenURL(link.url)
              if (link.kind === 'page' && index.some((e) => e.rel === link.rel)) goTo(link.rel)
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
        {!error && <DocsPrevNext prev={prev} next={next} onNavigate={goTo} />}
      </div>
    </div>
  )
}

export default DocsView
