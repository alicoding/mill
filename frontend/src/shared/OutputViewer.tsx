import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Text } from '@primer/react'
import { CodeEditor, type CodeEditorLanguage } from './CodeEditor'
import { JsonTree } from './JsonTree'
import { OutputErrorView } from './OutputErrorView'
import { OutputLogView } from './OutputLogView'
import { OutputMediaView, binaryFrom } from './OutputMediaView'
import { OutputRenderedView } from './OutputRenderedView'
import { OutputTableView, tableTsv } from './OutputTableView'
import { OutputViewerToolbar } from './OutputViewerToolbar'
import { downloadBlob } from './downloadBlob'
import { runCommand } from './commands'
import { useOutputFocusStore } from './outputFocusStore'
import { stashOutput } from './outputTabStore'
import { useAppStore } from './store'
import type { DiagnosisContext } from './diagnosis'
import {
  CAP_BYTES,
  CAP_ROWS,
  capText,
  outputText,
  resolveShape,
  readStoredView,
  tableFrom,
  writeStoredView,
  type OutputShape,
  type OutputView,
} from './outputShape'
import styles from './OutputViewer.module.css'

// The ONE output surface (goal 0326). Output is PRESENTED, never typed:
// no surface in Mill renders a run's answer, an HTTP response, a
// schema or a failure as a slab of text again, and none of them is
// editable -- selection is text selection, nothing more.
//
// The producer declares its shape; the viewer picks the richest view
// that shape supports and offers the rest one click away, Raw always
// among them. Structural inference is the fallback for a plain string
// whose producer said nothing, and the switch says "Detected as …" so
// an automatic choice is never silent.
//
// Split by view (JsonTree, OutputLogView, OutputTableView,
// OutputRenderedView, OutputErrorView, OutputMediaView) so no single
// file owns every rendering concern; this one owns the shape decision,
// the toolbar's state, the render budget and the focus handle every
// output.* command acts through.

export interface OutputViewerProps {
  value: unknown
  shape?: OutputShape
  mime?: string
  title?: string
  // Which surface this viewer is: the key the reader's view choice is
  // remembered under for the session, and the prefix of every test id.
  site: string
  // Extra lines a copied failure carries (goal 0127's diagnosis
  // composer). Error shape only.
  context?: DiagnosisContext
  // Set by the full-view work tab, which has nothing bigger to open
  // into.
  full?: boolean
  testId?: string
}

const RAW_LANGUAGE: Record<OutputShape, CodeEditorLanguage> = {
  json: 'json',
  rows: 'json',
  text: 'text',
  html: 'html',
  markdown: 'markdown',
  error: 'text',
  binary: 'text',
}

export function OutputViewer({ value, shape, mime, title, site, context, full, testId }: OutputViewerProps) {
  const { t } = useTranslation('common')
  const viewerId = useId()
  const openWorkTab = useAppStore((s) => s.openWorkTab)
  const setFocused = useOutputFocusStore((s) => s.setFocused)
  const clearFocused = useOutputFocusStore((s) => s.clearFocused)

  const resolved = useMemo(() => resolveShape({ value, shape, mime }), [value, shape, mime])
  const text = useMemo(() => outputText(value), [value])
  const [showAll, setShowAll] = useState(false)
  const [view, setView] = useState<OutputView>(() => readStoredView(site, resolved.views) ?? resolved.views[0])
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [wrap, setWrap] = useState(true)
  const [expandToken, setExpandToken] = useState(0)
  const [collapseToken, setCollapseToken] = useState(0)

  // A viewer handed a different value can land on a view its new shape
  // does not offer (a JSON response replaced by a plain-text one).
  useEffect(() => {
    setView((current) => (resolved.views.includes(current) ? current : resolved.views[0]))
  }, [resolved.views])

  const table = useMemo(() => (view === 'table' ? tableFrom(resolved.parsed, showAll ? Number.MAX_SAFE_INTEGER : CAP_ROWS) : null), [view, resolved.parsed, showAll])
  const capped = useMemo(() => (showAll ? { text, truncated: false, total: text.length } : capText(text, CAP_BYTES)), [text, showAll])

  const copyText = useCallback(() => {
    if (view === 'table' && table) return tableTsv(table)
    if (view === 'tree') {
      try {
        return JSON.stringify(resolved.parsed, null, 2)
      } catch {
        return text
      }
    }
    return text
  }, [view, table, resolved.parsed, text])

  const openFull = useCallback(() => {
    const id = stashOutput({ title: title ?? t('output.title'), value, shape, mime, site })
    openWorkTab({ kind: 'output', outputId: id })
  }, [openWorkTab, title, value, shape, mime, site, t])

  const textual = view === 'log' || view === 'raw' || view === 'source'
  const findable = view === 'tree' || view === 'log' || view === 'table' || view === 'error'

  // The handle every output.* command acts through, republished
  // whenever what it would do changes.
  const publish = useCallback(() => {
    setFocused({
      id: viewerId,
      copyText,
      toggleFind: () => setFindOpen((open) => !open),
      toggleWrap: textual ? () => setWrap((w) => !w) : undefined,
      openFull: full ? undefined : openFull,
    })
  }, [setFocused, viewerId, copyText, textual, full, openFull])

  useEffect(() => () => clearFocused(viewerId), [clearFocused, viewerId])

  const invoke = (commandId: string) => {
    publish()
    void runCommand(commandId)
  }

  const changeView = (next: OutputView) => {
    setView(next)
    writeStoredView(site, next)
  }

  const save = () => {
    const name = `${site}.txt`
    downloadBlob(name, new Blob([text], { type: mime ?? 'text/plain' }))
  }

  const id = testId ?? `${site}-output`

  if (text.trim() === '' && resolved.shape !== 'binary') {
    return <Text as="p" size="small" className={styles.empty} data-testid={`${id}-empty`}>{t('output.empty')}</Text>
  }

  return (
    <section
      className={styles.viewer}
      data-testid={id}
      data-shape={resolved.shape}
      data-full={full ? 'true' : undefined}
      data-view={view}
      aria-label={title ?? t('output.title')}
      onFocus={publish}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) clearFocused(viewerId) }}
    >
      <OutputViewerToolbar
        views={resolved.views}
        view={view}
        onViewChange={changeView}
        detectedView={resolved.detected ? resolved.views[0] : null}
        findOpen={findOpen}
        query={query}
        onQueryChange={setQuery}
        onCloseFind={() => { setFindOpen(false); setQuery('') }}
        wrap={wrap}
        showWrap={textual}
        showFind={findable}
        showExpand={view === 'tree'}
        showSave={resolved.shape === 'binary'}
        showOpenFull={!full}
        onExpandAll={() => setExpandToken((n) => n + 1)}
        onCollapseAll={() => setCollapseToken((n) => n + 1)}
        onSave={save}
        invoke={invoke}
      />

      {resolved.parseFailed && (
        <Text as="p" size="small" className={styles.notice} data-testid={`${id}-parse-fallback`}>{t('output.parseFallback')}</Text>
      )}

      {/* tabIndex makes the viewer itself a focus target, so Find's own
          shortcut has an owner the moment a reader clicks into output. */}
      <div className={styles.body} tabIndex={0} data-testid={`${id}-body`}>
        {view === 'tree' && (
          <JsonTree value={resolved.parsed} query={query} expandAllToken={expandToken} collapseAllToken={collapseToken} ariaLabel={title ?? t('output.title')} testId={`${id}-tree`} />
        )}
        {view === 'table' && table && (
          <OutputTableView data={table} query={query} ariaLabel={title ?? t('output.title')} testId={`${id}-table`} />
        )}
        {view === 'log' && <OutputLogView text={capped.text} query={query} wrap={wrap} testId={`${id}-log`} />}
        {(view === 'raw' || view === 'source') && (
          <CodeEditor
            value={capped.text}
            language={RAW_LANGUAGE[resolved.shape]}
            ariaLabel={title ?? t('output.title')}
            minHeightRows={4}
            wrap={wrap}
            testId={`${id}-raw`}
          />
        )}
        {view === 'rendered' && (
          <OutputRenderedView text={capped.text} markdown={resolved.shape === 'markdown'} ariaLabel={title ?? t('output.title')} testId={`${id}-rendered`} />
        )}
        {view === 'error' && <OutputErrorView text={text} query={query} context={context} testId={`${id}-error`} />}
        {view === 'media' && <OutputMediaView binary={binaryFrom(value, mime)} ariaLabel={title ?? t('output.title')} testId={`${id}-media`} />}
      </div>

      {(table?.truncated || (textual && capped.truncated)) && (
        <div className={styles.capLine} data-testid={`${id}-cap`}>
          <Text size="small" className={styles.notice}>
            {table?.truncated
              ? t('output.showingRows', { shown: table.rows.length.toLocaleString(), total: table.total.toLocaleString() })
              : t('output.showingRows', { shown: countLines(capped.text).toLocaleString(), total: countLines(text).toLocaleString() })}
          </Text>
          <Button size="small" variant="invisible" onClick={() => setShowAll(true)} data-testid={`${id}-show-all`}>{t('output.showAll')}</Button>
        </div>
      )}
    </section>
  )
}

function countLines(text: string): number {
  if (text === '') return 0
  let count = 1
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) count += 1
  return count
}
