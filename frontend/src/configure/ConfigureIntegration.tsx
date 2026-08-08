import { useEffect, useState } from 'react'
import { Button, Heading, IconButton, Label, Stack, Text } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { Connector } from '../../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import { ConnectorForm } from './ConnectorForm'
import { ConnectorSummary } from './ConnectorSummary'
import styles from '../shared/ListCard.module.css'

const AUTH_LABEL: Record<string, string> = {
  [AuthType.AuthNone]: 'None',
  [AuthType.AuthAPIKey]: 'API key',
  [AuthType.AuthBearer]: 'Bearer token',
}

const LIST_TAB = 'list'

// One open tab per connector currently being viewed or edited --
// mirrors CompositionView.tsx's own EditorTab/tabs/activeTab shape
// exactly (docs/adr/0014): the connector list is the pinned tab,
// viewing or editing a connector opens (or reuses) its own tab. `mode`
// is 'view' (ConnectorSummary, read-only) or 'edit' (ConnectorForm,
// covers new/edit/duplicate -- see ConnectorForm's own editingConnector/
// duplicateFrom props for how those three cases differ).
interface ConnectorTab {
  key: string
  connectorId: string | null // null only for a brand-new connector
  mode: 'view' | 'edit'
  duplicateFromId: string | null
}

// Configure's Integration section (docs/SPEC.md §3.5): CRUD over
// ConfigureService's Connectors. Type is fixed to "http" -- the only
// connector Type built today (§3.2's incremental-extensibility
// principle). docs/adr/0014: the list here stays a pinned tab; viewing
// (ConnectorSummary.tsx) and editing (ConnectorForm.tsx) both open as
// their own pinned tabs rather than an inline card on this page.
export function ConfigureIntegration() {
  const [connectors, setConnectors] = useState<Connector[] | null>(null)
  const [tabs, setTabs] = useState<ConnectorTab[]>([])
  const [activeTab, setActiveTab] = useState(LIST_TAB)

  const refetch = () => {
    ConfigureService.Connectors().then((list) => setConnectors(list ?? [])).catch(console.error)
  }

  useEffect(refetch, [])

  const closeTab = (key: string) => {
    setTabs((prev) => prev.filter((t) => t.key !== key))
    setActiveTab((current) => (current === key ? LIST_TAB : current))
  }

  const openNewTab = () => {
    const key = crypto.randomUUID()
    setTabs((prev) => [...prev, { key, connectorId: null, mode: 'edit', duplicateFromId: null }])
    setActiveTab(key)
  }

  // Viewing or editing the same connector twice reuses its existing
  // tab instead of opening a duplicate over the same data (matches
  // CompositionView.tsx's openEditTab precedent).
  const openTab = (connectorId: string, mode: 'view' | 'edit') => {
    const existing = tabs.find((t) => t.connectorId === connectorId && t.mode === mode)
    if (existing) {
      setActiveTab(existing.key)
      return
    }
    const key = crypto.randomUUID()
    setTabs((prev) => [...prev, { key, connectorId, mode, duplicateFromId: null }])
    setActiveTab(key)
  }

  const openDuplicateTab = (c: Connector) => {
    const key = crypto.randomUUID()
    setTabs((prev) => [...prev, { key, connectorId: null, mode: 'edit', duplicateFromId: c.ID }])
    setActiveTab(key)
  }

  const remove = (id: string) => {
    ConfigureService.DeleteConnector(id).then(() => {
      refetch()
      setTabs((prev) => prev.filter((t) => t.connectorId !== id))
      setActiveTab((current) => (tabs.find((t) => t.key === current)?.connectorId === id ? LIST_TAB : current))
    }).catch(console.error)
  }

  return (
    <Tabs value={activeTab} onValueChange={({ value }) => setActiveTab(value)}>
      <TabList aria-label="Connectors">
        <TabItem value={LIST_TAB}>Connectors</TabItem>
        {tabs.map((t) => (
          <TabItem key={t.key} value={t.key} onClose={() => closeTab(t.key)}>
            {t.connectorId ? (connectors?.find((c) => c.ID === t.connectorId)?.Label ?? 'Connector') : 'New connector'}
          </TabItem>
        ))}
      </TabList>

      <TabPanel value={LIST_TAB}>
        <div className={styles.page} data-testid="configure-integration">
          <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
            <Heading as="h2" variant="small">Connectors</Heading>
            <Button leadingVisual={PlusIcon} size="small" onClick={openNewTab} data-testid="new-connector">
              New connector
            </Button>
          </Stack>

          {connectors === null && <Text as="p" className={styles.muted}>Loading…</Text>}
          {connectors !== null && connectors.length === 0 && (
            <Text as="p" className={styles.muted}>No connectors yet.</Text>
          )}
          {connectors !== null && (
            <Stack direction="vertical" gap="condensed">
              {connectors.map((c) => (
                <div key={c.ID} className={styles.card} data-testid="connector-row">
                  <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => openTab(c.ID, 'view')}
                      onKeyDown={(e) => { if (e.key === 'Enter') openTab(c.ID, 'view') }}
                      style={{ cursor: 'pointer' }}
                    >
                      <Stack direction="horizontal" gap="condensed" align="center">
                        <Text weight="semibold">{c.Label}</Text>
                        <Label variant="secondary" size="small">{AUTH_LABEL[c.AuthType] ?? c.AuthType}</Label>
                      </Stack>
                      <Text as="p" size="small" className={styles.muted}>{c.BaseURL}</Text>
                      <Text as="p" size="small" className={styles.muted}>ID: {c.ID}</Text>
                    </div>
                    <IconButton icon={TrashIcon} aria-label={`Delete ${c.Label}`} size="small" variant="invisible" onClick={() => remove(c.ID)} />
                  </Stack>
                </div>
              ))}
            </Stack>
          )}
        </div>
      </TabPanel>

      {connectors !== null && tabs.map((t) => {
        const connector = t.connectorId ? (connectors.find((c) => c.ID === t.connectorId) ?? null) : null
        const duplicateFrom = t.duplicateFromId ? (connectors.find((c) => c.ID === t.duplicateFromId) ?? null) : null
        return (
          <TabPanel key={t.key} value={t.key}>
            {t.mode === 'view' && connector && (
              <ConnectorSummary
                connector={connector}
                onEdit={() => openTab(t.connectorId!, 'edit')}
                onDuplicate={() => openDuplicateTab(connector)}
                onDelete={() => remove(connector.ID)}
              />
            )}
            {t.mode === 'edit' && (
              <ConnectorForm
                editingConnector={connector}
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
