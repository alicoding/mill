import { useEffect, useRef, useState } from 'react'
import { Button, Heading, IconButton, Label, Stack, Text } from '@primer/react'
import { DownloadIcon, PlusIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { RequestForm } from './RequestForm'
import { RequestSummary } from './RequestSummary'
import { loadPersistedTabs, savePersistedTabs } from '../shared/persistedTabs'
import { downloadJSON } from '../shared/downloadJSON'
import styles from '../shared/ListCard.module.css'

const AUTH_LABEL: Record<string, string> = {
  [AuthType.AuthNone]: 'None',
  [AuthType.AuthAPIKey]: 'API key',
  [AuthType.AuthBearer]: 'Bearer token',
}

const LIST_TAB = 'list'
const TABS_STORAGE_KEY = 'mill-configure-request-tabs'

// One open tab per request currently being viewed or edited -- mirrors
// CompositionView.tsx's own EditorTab/tabs/activeTab shape exactly
// (docs/adr/0014): the request list is the pinned tab, viewing or
// editing a request opens (or reuses) its own tab. `mode` is 'view'
// (RequestSummary, read-only) or 'edit' (RequestForm, covers
// new/edit/duplicate -- see RequestForm's own editingRequest/
// duplicateFrom props for how those three cases differ).
interface RequestTab {
  key: string
  requestId: string | null // null only for a brand-new request
  mode: 'view' | 'edit'
  duplicateFromId: string | null
}

// Configure's Integration section (docs/SPEC.md §3.5): CRUD over
// ConfigureService's HTTPRequests -- renamed from Connector by
// ADR-0016. docs/adr/0014: the list here stays a pinned tab; viewing
// (RequestSummary.tsx) and editing (RequestForm.tsx) both open as
// their own pinned tabs rather than an inline card on this page.
export function ConfigureRequests() {
  const [requests, setRequests] = useState<HTTPRequest[] | null>(null)
  const [tabs, setTabs] = useState<RequestTab[]>([])
  const [activeTab, setActiveTab] = useState(LIST_TAB)
  // Guards the one-shot restore effect below from re-firing on every
  // later refetch, same reasoning as CompositionView.tsx's own
  // restoredTabs ref.
  const restoredTabs = useRef(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const refetch = () => {
    ConfigureService.HTTPRequests().then((list) => setRequests(list ?? [])).catch(console.error)
  }

  // Never carries a secret -- ExportHTTPRequest's own contract
  // (configureservice_export.go), same "the write-only secret design
  // means export has nothing secret to leak" reasoning ADR-0013's
  // Duplicate already relies on for cloning a request.
  const exportRequest = (id: string, label: string) => {
    ConfigureService.ExportHTTPRequest(id)
      .then((json) => downloadJSON(`${label.trim() || 'request'}.json`, json))
      .catch((err) => setImportError(String(err)))
  }

  const openImportPicker = () => {
    setImportError(null)
    importInputRef.current?.click()
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text()
      .then((text) => ConfigureService.ImportHTTPRequest(text))
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }

  useEffect(refetch, [])

  // Restores which request tabs were open (docs/SPEC.md §3.7's
  // Update), once the real request list is in -- only 'view' tabs (a
  // read-only summary), never 'edit': re-opening straight into an
  // edit form with any unsaved in-progress typing already gone would
  // look like it's "still open," misleadingly. Filters out any
  // persisted ID for a request deleted since last session.
  useEffect(() => {
    if (requests === null || restoredTabs.current) return
    restoredTabs.current = true
    const persisted = loadPersistedTabs(TABS_STORAGE_KEY)
    const validIds = persisted.ids.filter((id) => requests.some((r) => r.ID === id))
    if (validIds.length === 0) return
    const restored = validIds.map((requestId) => ({
      key: crypto.randomUUID(), requestId, mode: 'view' as const, duplicateFromId: null,
    }))
    setTabs(restored)
    const active = restored.find((t) => t.requestId === persisted.activeId)
    setActiveTab(active ? active.key : LIST_TAB)
  }, [requests])

  // Persists the open, saved-request 'view' tab set on every change.
  // Gated on restoredTabs.current -- see CompositionView.tsx's own
  // identical guard for why: this effect also fires on the very first
  // mount, before the restore effect above resolves its async fetch,
  // and an unguarded write would overwrite the previous session's
  // persisted tabs with the empty initial state first.
  useEffect(() => {
    if (!restoredTabs.current) return
    const savedTabs = tabs.filter((t): t is RequestTab & { requestId: string } => t.mode === 'view' && t.requestId !== null)
    const activeSaved = savedTabs.find((t) => t.key === activeTab)
    savePersistedTabs(TABS_STORAGE_KEY, {
      ids: savedTabs.map((t) => t.requestId),
      activeId: activeSaved ? activeSaved.requestId : null,
    })
  }, [tabs, activeTab])

  const closeTab = (key: string) => {
    setTabs((prev) => prev.filter((t) => t.key !== key))
    setActiveTab((current) => (current === key ? LIST_TAB : current))
  }

  const openNewTab = () => {
    const key = crypto.randomUUID()
    setTabs((prev) => [...prev, { key, requestId: null, mode: 'edit', duplicateFromId: null }])
    setActiveTab(key)
  }

  // Viewing or editing the same request twice reuses its existing tab
  // instead of opening a duplicate over the same data (matches
  // CompositionView.tsx's openEditTab precedent).
  const openTab = (requestId: string, mode: 'view' | 'edit') => {
    const existing = tabs.find((t) => t.requestId === requestId && t.mode === mode)
    if (existing) {
      setActiveTab(existing.key)
      return
    }
    const key = crypto.randomUUID()
    setTabs((prev) => [...prev, { key, requestId, mode, duplicateFromId: null }])
    setActiveTab(key)
  }

  const openDuplicateTab = (r: HTTPRequest) => {
    const key = crypto.randomUUID()
    setTabs((prev) => [...prev, { key, requestId: null, mode: 'edit', duplicateFromId: r.ID }])
    setActiveTab(key)
  }

  const remove = (id: string) => {
    ConfigureService.DeleteHTTPRequest(id).then(() => {
      refetch()
      setTabs((prev) => prev.filter((t) => t.requestId !== id))
      setActiveTab((current) => (tabs.find((t) => t.key === current)?.requestId === id ? LIST_TAB : current))
    }).catch(console.error)
  }

  return (
    <Tabs value={activeTab} onValueChange={({ value }) => setActiveTab(value)}>
      <TabList aria-label="Requests">
        <TabItem value={LIST_TAB}>Requests</TabItem>
        {tabs.map((t) => (
          <TabItem key={t.key} value={t.key} onClose={() => closeTab(t.key)}>
            {t.requestId ? (requests?.find((r) => r.ID === t.requestId)?.Label ?? 'Request') : 'New request'}
          </TabItem>
        ))}
      </TabList>

      <TabPanel value={LIST_TAB}>
        <div className={styles.page} data-testid="configure-requests">
          <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
            <Heading as="h2" variant="small">Requests</Heading>
            <Stack direction="horizontal" gap="condensed">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                data-testid="import-request-input"
                style={{ display: 'none' }}
                onChange={handleImportFile}
              />
              <Button leadingVisual={UploadIcon} size="small" onClick={openImportPicker} data-testid="import-request">
                Import
              </Button>
              <Button leadingVisual={PlusIcon} size="small" onClick={openNewTab} data-testid="new-request">
                New request
              </Button>
            </Stack>
          </Stack>
          {importError && (
            <Text as="p" size="small" className={styles.error} data-testid="import-request-error">{importError}</Text>
          )}

          {requests === null && <Text as="p" className={styles.muted}>Loading…</Text>}
          {requests !== null && requests.length === 0 && (
            <Text as="p" className={styles.muted}>No requests yet.</Text>
          )}
          {requests !== null && (
            <Stack direction="vertical" gap="condensed">
              {requests.map((r) => (
                <div key={r.ID} className={styles.card} data-testid="request-row">
                  <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openTab(r.ID, 'view')}
                      onKeyDown={(e) => { if (e.key === 'Enter') openTab(r.ID, 'view') }}
                      style={{ cursor: 'pointer' }}
                    >
                      <Stack direction="horizontal" gap="condensed" align="center">
                        <Text weight="semibold">{r.Label}</Text>
                        <Label variant="secondary" size="small">{AUTH_LABEL[r.AuthType] ?? r.AuthType}</Label>
                        {/* No !r.BuiltIn guard on Delete below -- a seeded
                            example is ordinary and fully editable/deletable
                            from the moment it exists, same pattern
                            CompositionView.tsx already uses for wf.BuiltIn
                            (docs/SPEC.md §2.2's Update note). BuiltIn only
                            drives this informational badge. */}
                        {r.BuiltIn && <Label variant="secondary" size="small">built-in</Label>}
                      </Stack>
                      <Text as="p" size="small" className={styles.muted}>{r.BaseURL}</Text>
                      {r.Description && <Text as="p" size="small" className={styles.muted}>{r.Description}</Text>}
                      <Text as="p" size="small" className={styles.muted}>ID: {r.ID}</Text>
                    </div>
                    <Stack direction="horizontal" gap="condensed">
                      <IconButton
                        icon={DownloadIcon}
                        aria-label={`Export ${r.Label}`}
                        size="small"
                        variant="invisible"
                        onClick={() => exportRequest(r.ID, r.Label)}
                      />
                      <IconButton icon={TrashIcon} aria-label={`Delete ${r.Label}`} size="small" variant="invisible" onClick={() => remove(r.ID)} />
                    </Stack>
                  </Stack>
                </div>
              ))}
            </Stack>
          )}
        </div>
      </TabPanel>

      {requests !== null && tabs.map((t) => {
        const request = t.requestId ? (requests.find((r) => r.ID === t.requestId) ?? null) : null
        const duplicateFrom = t.duplicateFromId ? (requests.find((r) => r.ID === t.duplicateFromId) ?? null) : null
        return (
          <TabPanel key={t.key} value={t.key}>
            {t.mode === 'view' && request && (
              <RequestSummary
                request={request}
                onEdit={() => openTab(t.requestId!, 'edit')}
                onDuplicate={() => openDuplicateTab(request)}
                onDelete={() => remove(request.ID)}
              />
            )}
            {t.mode === 'edit' && (
              <RequestForm
                editingRequest={request}
                duplicateFrom={duplicateFrom}
                onSaved={() => { refetch(); closeTab(t.key) }}
                onCancel={() => closeTab(t.key)}
              />
            )}
          </TabPanel>
        )
      })}
    </Tabs>
  )
}
