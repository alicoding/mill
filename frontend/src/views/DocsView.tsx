import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import { DocsService } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { writeClipboardText } from '../shared/clipboardWrite'
import { openExternalUrl } from '../shared/openExternal'
import { resolveDocLink } from './docLinks'
import { adjacentPages, groupDocsIndex, groupOf, groupTitleKey, type DocsIndexEntry } from './docsGroups'
import { CHECK_ICON_SVG, COPY_ICON_SVG, injectCodeCopyButtons } from './docsCodeCopy'
import { injectHeadingAnchors, parseHeadings } from './docsHeadings'
import { useDocsScrollSpy } from './useDocsScrollSpy'
import { usePrefersReducedMotion } from '../shared/usePrefersReducedMotion'
import DocsNav from './DocsNav'
import DocsPrevNext from './DocsPrevNext'
import DocsToc from './DocsToc'
import styles from './DocsView.module.css'

// Matches CopyDiagnosisButton's own confirm window (shared/CopyDiagnosisButton.tsx)
// -- the house pattern for "brief confirmed state" every copy action in
// the app already uses.
const CODE_COPY_CONFIRM_MS = 1500

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
        const list = (entries ?? []).map((e) => ({ rel: e.rel, title: e.title, note: e.note, kind: e.kind }))
        setIndex(list)
        if (!initialPage && list.length > 0) setPage(list[0].rel)
      })
      .catch((err) => setError(String(err)))
  }, [initialPage])

  // A landing that arrives while DocsView is ALREADY mounted (goal
  // 0235 S2's docs.search: pick a different page without leaving the
  // Docs surface) changes the initialPage PROP, not the component's
  // key -- React doesn't resync state from a changed prop on its own,
  // so this effect is the resync. The functional setPage form reads
  // no outer `page` binding, so it never fights goTo's own setPage on
  // an in-page cross-link click (goTo also calls setView, which
  // round-trips back here as the same value the state already holds).
  useEffect(() => {
    if (!initialPage) return
    setPage((current) => (initialPage === current ? current : initialPage))
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
  const currentGroup = currentEntry ? groupOf(currentEntry) : ''
  const currentSectionKey = groupTitleKey(currentGroup)

  const headings = useMemo(() => parseHeadings(html), [html])
  const htmlWithAnchors = useMemo(
    () => injectHeadingAnchors(html, styles.headingAnchor, (heading) => t('docs.headingAnchorLabel', { heading })),
    [html, t],
  )
  const htmlWithCopyButtons = useMemo(
    () => injectCodeCopyButtons(htmlWithAnchors, styles.codeBlockWrapper, styles.codeCopyButton, t('docs.codeCopyAriaLabel')),
    [htmlWithAnchors, t],
  )
  const reducedMotion = usePrefersReducedMotion()
  const { activeId: activeHeadingId, scrollToHeading } = useDocsScrollSpy(headings, reducedMotion)

  const goTo = (rel: string) => {
    setPage(rel)
    setView({ kind: 'docs', page: rel })
  }

  return (
    <div className={styles.docs} data-testid="docs-view">
      <DocsNav groups={groups} currentPage={page} onSelect={goTo} />
      <div className={styles.content}>
        <div className={styles.contentGrid}>
          <div className={styles.mainColumn}>
            {currentEntry && (
              <header className={styles.pageHeader} data-testid="docs-breadcrumb">
                <span className={styles.pageHeaderSection}>
                  {currentSectionKey ? t(currentSectionKey) : currentGroup}
                </span>
                <h1 className={styles.pageHeaderTitle}>{currentEntry.title}</h1>
              </header>
            )}
            {error && <Text className={styles.error} data-testid="docs-error">{error}</Text>}
            {!error && (
              // Same trusted-render reasoning as the Atlas mirror preview:
              // the HTML comes from Mill's own markdown renderer over
              // repository-authored content embedded in the binary.
              // Anchor clicks are intercepted (docLinks.ts): a raw click
              // would navigate the app's own webview away from Mill --
              // external URLs go to the system browser, .md cross-links
              // stay in-app, and a heading anchor's "#id" href scrolls
              // within this same page instead of a real navigation.
              <article
                className={styles.article}
                data-testid="docs-content"
                onClick={(ev) => {
                  const target = ev.target as HTMLElement
                  const copyButton = target.closest<HTMLButtonElement>('[data-testid="docs-code-copy"]')
                  if (copyButton) {
                    ev.preventDefault()
                    const code = copyButton.parentElement?.querySelector('pre code')
                    void writeClipboardText(code?.textContent ?? '').then(() => {
                      copyButton.innerHTML = CHECK_ICON_SVG
                      copyButton.setAttribute('aria-label', t('docs.codeCopiedAriaLabel'))
                      copyButton.classList.add(styles.codeCopyButtonCopied)
                      window.setTimeout(() => {
                        copyButton.innerHTML = COPY_ICON_SVG
                        copyButton.setAttribute('aria-label', t('docs.codeCopyAriaLabel'))
                        copyButton.classList.remove(styles.codeCopyButtonCopied)
                      }, CODE_COPY_CONFIRM_MS)
                    })
                    return
                  }
                  const anchor = target.closest('a')
                  const href = anchor?.getAttribute('href')
                  if (!href) return
                  ev.preventDefault()
                  if (href.startsWith('#')) {
                    scrollToHeading(href.slice(1))
                    return
                  }
                  const link = resolveDocLink(page, href)
                  if (link.kind === 'external') void openExternalUrl(link.url)
                  if (link.kind === 'page' && index.some((e) => e.rel === link.rel)) goTo(link.rel)
                }}
                dangerouslySetInnerHTML={{ __html: htmlWithCopyButtons }}
              />
            )}
            {!error && <DocsPrevNext prev={prev} next={next} onNavigate={goTo} />}
          </div>
          {!error && <DocsToc headings={headings} activeId={activeHeadingId} onSelect={scrollToHeading} />}
        </div>
      </div>
    </div>
  )
}

export default DocsView
