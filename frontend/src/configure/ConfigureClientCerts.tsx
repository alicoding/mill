import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, IconButton, Stack, Text, TextInput } from '@primer/react'
import { PencilIcon, PlusIcon, ShieldLockIcon, TrashIcon } from '@primer/octicons-react'
import { DataTable } from '@primer/react/experimental'
import { StatusStamp } from '../shared/StatusStamp'
import { ResizableTableContainer, TruncatedCell } from '../shared/ResizableTable'
import { ConfigureService } from '../shared/bindings'
import type { ClientCertificate } from '../../bindings/github.com/alicoding/mill/internal/domain/clientcert/models'
import { Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/secret/models'
import { refreshClientCerts, useConfigureEntityStore } from '../shared/configureEntityStore'
import { useViewMode } from '../shared/viewMode'
import { InventoryList, type InventoryItem } from '../shared/InventoryList'
import { ENTITY_ICON } from '../shared/entityIcons'
import { formatUpdated, sortByUpdatedDesc } from '../shared/inventorySort'
import { useUISignalStore } from '../shared/uiSignalStore'
import { SecretPicker } from '../shared/SecretPicker'
import { useSecretTitles } from '../shared/secretTitleCache'
import { toEntryID } from '../shared/secretReference'
import { secretTitleFor } from './secretTitleFor'
import { AdvancedDisclosure } from './AdvancedDisclosure'
import { ConfigureEntityPage } from './ConfigureEntityPage'
import { clientCertStatusText, clientCertStatusVariant, isWildcardHost } from './clientCertStatus'
import { messageFor } from '../shared/userError'
import styles from '../shared/ListCard.module.css'

const EMPTY = { label: '', host: '', certRef: '', keyRef: '', passphraseRef: '', caRef: '', notes: '' }

// Configure's Certificates section (goal 0306 S1): which client
// certificate Mill presents to which host. A certificate is configured
// once per host and applies to every request Mill makes there, so
// nothing about it lives on an individual request.
//
// Every credential field is a picker over the secret store: the entity
// names an entry, the material never passes through this form. The
// private key disappears once the chosen certificate is a bundle,
// because a bundle already carries one.
export function ConfigureClientCerts() {
  const { t } = useTranslation('configure')
  const certs = useConfigureEntityStore((s) => s.clientCerts)
  const statuses = useConfigureEntityStore((s) => s.clientCertStatuses)
  const { kinds: entryKinds } = useSecretTitles()
  const [viewMode, setViewMode] = useViewMode('mill-view-clientcerts')
  const [formOpen, setFormOpen] = useState(false)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [values, setValues] = useState(EMPTY)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState('')
  const [testing, setTesting] = useState(false)

  const refetch = () => { void refreshClientCerts() }
  useEffect(() => {
    refetch()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only fetch, same reasoning every sibling Configure page's identical effect documents
  }, [])

  const startCreate = (host = '') => {
    setEditingID(null)
    setValues({ ...EMPTY, host })
    setFormOpen(true)
    setError('')
    setTestResult('')
  }

  const configureCreateRequest = useUISignalStore((s) => s.configureCreateRequest)
  const configureCreatePrefill = useUISignalStore((s) => s.configureCreatePrefill)
  const consumeConfigureCreate = useUISignalStore((s) => s.consumeConfigureCreate)
  useEffect(() => {
    if (configureCreateRequest !== 'certificates') return
    startCreate(configureCreatePrefill ?? '')
    consumeConfigureCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startCreate/consumeConfigureCreate deliberately excluded, same reasoning every sibling Configure page's identical effect documents
  }, [configureCreateRequest, configureCreatePrefill])

  const startEdit = (c: ClientCertificate) => {
    setEditingID(c.ID)
    setValues({
      label: c.Label, host: c.Host, certRef: c.CertRef, keyRef: c.KeyRef,
      passphraseRef: c.PassphraseRef, caRef: c.CARef, notes: c.Notes,
    })
    setFormOpen(true)
    setError('')
    setTestResult('')
  }

  const configureEditRequest = useUISignalStore((s) => s.configureEditRequest)
  const consumeConfigureEdit = useUISignalStore((s) => s.consumeConfigureEdit)
  useEffect(() => {
    if (configureEditRequest?.tab !== 'certificates' || certs === null) return
    const target = certs.find((x) => x.ID === configureEditRequest.id)
    consumeConfigureEdit()
    if (target) startEdit(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startEdit/consumeConfigureEdit deliberately excluded, same reasoning as the create effect above
  }, [configureEditRequest, certs])

  const setValue = (key: keyof typeof EMPTY, value: string) => setValues((prev) => ({ ...prev, [key]: value }))

  const save = async () => {
    setError('')
    try {
      if (editingID) {
        await ConfigureService.UpdateClientCertificate(editingID, values.label, values.host, values.certRef, values.keyRef, values.passphraseRef, values.caRef, values.notes)
      } else {
        await ConfigureService.CreateClientCertificate(values.label, values.host, values.certRef, values.keyRef, values.passphraseRef, values.caRef, values.notes)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(messageFor(err, t))
    }
  }

  const runTest = async () => {
    if (!editingID) return
    setTesting(true)
    setTestResult('')
    try {
      await ConfigureService.TestClientCertificate(editingID)
      setTestResult(t('configureClientCerts.handshakeSucceeded'))
    } catch (err) {
      setTestResult(messageFor(err, t))
    } finally {
      setTesting(false)
    }
  }

  const sorted = useMemo(() => sortByUpdatedDesc(certs ?? [], (c) => c.UpdatedAt), [certs])
  const statusFor = (c: ClientCertificate) => clientCertStatusText(statuses[c.ID], t)

  const items: InventoryItem[] = sorted.map((c) => ({
    id: c.ID,
    entity: 'clientcert',
    icon: ENTITY_ICON.clientcert,
    label: c.Label,
    updatedLabel: formatUpdated(c.UpdatedAt),
    builtIn: c.BuiltIn,
    updatedAt: c.UpdatedAt,
    createdAt: c.CreatedAt,
    description: c.Host,
    labelBadges: (
      <StatusStamp variant={clientCertStatusVariant(statuses[c.ID])} data-testid={`clientcert-status-${c.ID}`}>
        {statusFor(c)}
      </StatusStamp>
    ),
    onOpen: () => startEdit(c),
    menuActions: [
      { commandId: 'clientcert.edit', ctx: { kind: 'entity', entity: 'clientcert', id: c.ID } },
      { commandId: 'clientcert.duplicate', ctx: { kind: 'entity', entity: 'clientcert', id: c.ID } },
      { commandId: 'clientcert.delete', ctx: { kind: 'entity', entity: 'clientcert', id: c.ID }, danger: true },
    ],
  }))

  // A bundle carries its own key, so the key field is not merely
  // optional there: it has nothing to point at.
  const bundleChosen = values.certRef !== '' && entryKinds[toEntryID(values.certRef)] === Kind.KindFile

  return (
    <ConfigureEntityPage
      pageTestId="configure-clientcerts"
      headingId="clientcerts-heading"
      headingText={t('configureClientCerts.heading')}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      primaryLabel={t('configureClientCerts.newClientCert')}
      primaryTestId="new-clientcert"
      onPrimary={() => startCreate()}
      formOpen={formOpen}
      formContent={(
        <Stack direction="vertical" gap="condensed">
          <FormControl>
            <FormControl.Label>{t('configureClientCerts.label')}</FormControl.Label>
            <TextInput value={values.label} onChange={(e) => setValue('label', e.target.value)} block data-testid="clientcert-label" />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('configureClientCerts.host')}</FormControl.Label>
            <FormControl.Caption>{t('configureClientCerts.hostCaption')}</FormControl.Caption>
            <TextInput value={values.host} onChange={(e) => setValue('host', e.target.value)} block data-testid="clientcert-host" />
          </FormControl>
          <FormControl>
            <FormControl.Label>{t('configureClientCerts.certificate')}</FormControl.Label>
            <FormControl.Caption>{t('configureClientCerts.certificateCaption')}</FormControl.Caption>
            <SecretPicker
              value={values.certRef}
              onChange={(ref) => setValue('certRef', ref)}
              kinds={[Kind.KindCertificate, Kind.KindFile]}
              newEntryTitle={secretTitleFor(values.label, t('configureClientCerts.certificate'))}
              ariaLabel={t('configureClientCerts.certificate')}
              testID="clientcert-cert-picker"
            />
          </FormControl>
          {!bundleChosen && (
            <FormControl>
              <FormControl.Label>{t('configureClientCerts.privateKey')}</FormControl.Label>
              <FormControl.Caption>{t('configureClientCerts.privateKeyCaption')}</FormControl.Caption>
              <SecretPicker
                value={values.keyRef}
                onChange={(ref) => setValue('keyRef', ref)}
                kinds={[Kind.KindKey]}
                newEntryTitle={secretTitleFor(values.label, t('configureClientCerts.privateKey'))}
                ariaLabel={t('configureClientCerts.privateKey')}
                testID="clientcert-key-picker"
              />
            </FormControl>
          )}
          <AdvancedDisclosure open={values.passphraseRef !== '' || values.caRef !== '' || values.notes !== ''} testId="clientcert-advanced">
            <FormControl>
              <FormControl.Label>{t('configureClientCerts.passphrase')}</FormControl.Label>
              <FormControl.Caption>{t('configureClientCerts.passphraseCaption')}</FormControl.Caption>
              <SecretPicker
                value={values.passphraseRef}
                onChange={(ref) => setValue('passphraseRef', ref)}
                kinds={[Kind.KindText]}
                newEntryTitle={secretTitleFor(values.label, t('configureClientCerts.passphrase'))}
                ariaLabel={t('configureClientCerts.passphrase')}
                testID="clientcert-passphrase-picker"
              />
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('configureClientCerts.caCertificate')}</FormControl.Label>
              <FormControl.Caption>{t('configureClientCerts.caCertificateCaption')}</FormControl.Caption>
              <SecretPicker
                value={values.caRef}
                onChange={(ref) => setValue('caRef', ref)}
                kinds={[Kind.KindCertificate]}
                newEntryTitle={secretTitleFor(values.label, t('configureClientCerts.caCertificate'))}
                ariaLabel={t('configureClientCerts.caCertificate')}
                testID="clientcert-ca-picker"
              />
            </FormControl>
            <FormControl>
              <FormControl.Label>{t('configureClientCerts.notes')}</FormControl.Label>
              <TextInput value={values.notes} onChange={(e) => setValue('notes', e.target.value)} block data-testid="clientcert-notes" />
            </FormControl>
          </AdvancedDisclosure>
          {error && <Text as="p" size="small" className={styles.error} data-testid="clientcert-error">{error}</Text>}
          {testResult && <Text as="p" size="small" className={styles.muted} data-testid="clientcert-test-result">{testResult}</Text>}
          <Stack direction="horizontal" gap="condensed">
            <Button variant="primary" size="small" onClick={save} data-testid="save-clientcert">{t('configureClientCerts.saveClientCert')}</Button>
            {editingID !== null && (
              <Button
                size="small"
                onClick={runTest}
                disabled={testing || isWildcardHost(values.host)}
                data-testid="test-clientcert"
              >
                {t('configureClientCerts.test')}
              </Button>
            )}
            <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>{t('entityRefField.cancel')}</Button>
          </Stack>
        </Stack>
      )}
      loading={certs === null}
      showTable={certs !== null && viewMode === 'table' && certs.length > 0}
      tableContent={(
        <ResizableTableContainer storageKey="mill-cols-clientcerts">
          <DataTable
            aria-labelledby="clientcerts-heading"
            data={sorted.map((c) => ({ ...c, id: c.ID }))}
            columns={[
              { header: t('configureClientCerts.columns.label'), field: 'Label', rowHeader: true, sortBy: 'alphanumeric' },
              { header: t('configureClientCerts.columns.host'), id: 'host', width: 'growCollapse', minWidth: '160px', renderCell: (c) => <TruncatedCell text={c.Host} mono /> },
              { header: t('configureClientCerts.columns.status'), id: 'status', renderCell: (c) => <StatusStamp variant={clientCertStatusVariant(statuses[c.ID])}>{statusFor(c)}</StatusStamp> },
              {
                header: '', id: 'actions', width: 'auto', align: 'end',
                renderCell: (c) => (
                  <Stack direction="horizontal" gap="condensed">
                    <IconButton icon={PencilIcon} aria-label={t('configureClientCerts.editAriaLabel', { label: c.Label })} size="small" variant="invisible" onClick={() => startEdit(c)} />
                    <IconButton icon={TrashIcon} aria-label={t('configureClientCerts.deleteAriaLabel', { label: c.Label })} size="small" variant="invisible" onClick={() => { void ConfigureService.DeleteClientCertificate(c.ID).then(refetch) }} />
                  </Stack>
                ),
              },
            ]}
          />
        </ResizableTableContainer>
      )}
      showRows={certs !== null && viewMode === 'rows' && !(formOpen && certs.length === 0)}
      rowsContent={(
        <InventoryList
          listId="configure.clientcerts"
          items={items}
          searchPlaceholder={t('configureClientCerts.searchPlaceholder')}
          emptyState={{
            icon: ShieldLockIcon,
            heading: t('configureClientCerts.emptyHeading'),
            description: t('configureClientCerts.emptyDescription'),
            action: <Button leadingVisual={PlusIcon} variant="primary" onClick={() => startCreate()}>{t('configureClientCerts.newClientCert')}</Button>,
          }}
        />
      )}
    />
  )
}
