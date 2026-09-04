import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Dialog, Stack, Text } from '@primer/react'
import { FilteredActionList } from '@primer/react/experimental'
import { PinIcon } from '@primer/octicons-react'
import { ClipboardHistoryService, type ClipboardHistoryEntry } from '../shared/bindings'
import { useAppStore } from '../shared/store'
import { useUISignalStore } from '../shared/uiSignalStore'
import { ClipboardHistoryDetail } from './ClipboardHistoryDetail'
import styles from './ClipboardHistoryDialog.module.css'
import { searchInputTextAssistOff } from '../shared/searchInputProps'
import { background } from '../shared/background'

const PREVIEW_LINE_CAP = 80

// previewLine is the row's one-line preview: the entry's first line,
// truncated -- goal 0234's design contract ("each row a one-line
// preview").
function previewLine(text: string): string {
  const firstLine = (text.split('\n')[0] ?? '').trim()
  if (!firstLine) return ''
  return firstLine.length > PREVIEW_LINE_CAP ? firstLine.slice(0, PREVIEW_LINE_CAP) + '…' : firstLine
}

// The seeded workflow's own id (builtinworkflows_cliphistory.go) --
// the empty state's door opens ITS editor specifically, matching the
// NodePalette.tsx precedent of a direct openWorkTab call for a
// navigation action parameterized by one specific runtime entity
// (architecture.md's command-registry rule: this isn't a repeatable
// global action).
const CLIPBOARD_HISTORY_WORKFLOW_ID = 'clipboard-history-workflow'

// ClipboardHistoryDialog (goal 0234): app-level chrome mounted once,
// same shape as WhatsNewDialog/CommandPalette, rendering off
// uiSignalStore's clipboardHistoryOpen flag. Raycast-shaped: a
// keyboard-first searchable list (FilteredActionList, newest-first,
// pinned entries floating to the top per the service's own
// ListClipboardHistory ordering) with the selected row's full content
// previewed via ClipboardHistoryDetail, whose Copy/Pin/Delete act on
// that selection.
export function ClipboardHistoryDialog() {
  const { t } = useTranslation('app')
  const open = useUISignalStore((s) => s.clipboardHistoryOpen)
  const close = useUISignalStore((s) => s.closeClipboardHistory)

  const [entries, setEntries] = useState<ClipboardHistoryEntry[]>([])
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = () => {
    void background(ClipboardHistoryService.ListClipboardHistory()
      .then((result) => {
        const list = result ?? []
        setEntries(list)
        setSelectedId((current) => (current && list.some((e) => e.ID === current) ? current : (list[0]?.ID ?? null)))
      }), 'clipboardHistory.listClipboardHistory')
  }

  useEffect(() => {
    if (open) refresh()
    else setQuery('')
  }, [open])

  if (!open) return null

  const filtered = query.trim()
    ? entries.filter((e) => e.Text.toLowerCase().includes(query.trim().toLowerCase()))
    : entries
  const selected = entries.find((e) => e.ID === selectedId) ?? null

  const items = filtered.map((e) => ({
    id: e.ID,
    text: previewLine(e.Text) || t('clipboardHistory.emptyPreview'),
    leadingVisual: e.Pinned ? PinIcon : undefined,
    selected: e.ID === selectedId,
    onAction: () => setSelectedId(e.ID),
  }))

  const openSeededWorkflow = () => {
    close()
    useAppStore.getState().openWorkTab({ kind: 'workflow-edit', workflowId: CLIPBOARD_HISTORY_WORKFLOW_ID, mode: 'view' })
  }

  return (
    <Dialog
      title={t('clipboardHistory.title')}
      subtitle={t('clipboardHistory.subtitle')}
      onClose={close}
      width="large"
      height="large"
      data-component="clipboard-history"
    >
      {entries.length === 0 ? (
        <Stack direction="horizontal" gap="condensed" align="center" className={styles.empty} data-testid="clipboard-history-empty">
          <Text size="small">{t('clipboardHistory.empty')}</Text>
          <Button size="small" onClick={openSeededWorkflow} data-testid="clipboard-history-open-workflow">
            {t('clipboardHistory.openWorkflow')}
          </Button>
        </Stack>
      ) : (
        <div className={styles.layout}>
          <FilteredActionList
            className={styles.list}
            items={items}
            selectionVariant="single"
            filterValue={query}
            onFilterChange={setQuery}
            placeholderText={t('clipboardHistory.searchPlaceholder')}
            textInputProps={searchInputTextAssistOff}
            showItemDividers
            messageText={{ title: t('search.noMatchesTitle'), description: t('search.noMatchesDescription', { query }) }}
          />
          <div className={styles.detail} data-testid="clipboard-history-detail">
            <ClipboardHistoryDetail entry={selected} onChanged={refresh} />
          </div>
        </div>
      )}
    </Dialog>
  )
}
