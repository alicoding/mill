import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Heading, IconButton, Label, Select, Stack, Text } from '@primer/react'
import { StatusStamp } from '../shared/StatusStamp'
import monoStyles from '../shared/monoText.module.css'
import { PencilIcon, CopyIcon, TrashIcon } from '@primer/octicons-react'
import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { ConfigureService } from '../shared/bindings'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import type { Field, Operation, OperationRef } from '../../bindings/github.com/alicoding/mill/internal/adapters/openapispec/models'
import { RequestTestPanel } from './RequestTestPanel'
import { headersToRows, rowsToHeaders } from './requestHeaders'
import { parseOpenAPIToOperations } from './openapiSynth'
import { authLabelFor, AUTH_UNIMPLEMENTED } from './authTypeLabels'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

// docs/adr/0014: the read-only view of a saved request -- four tabs
// (Details/Available attributes/Input parameters/Testing), matching
// the reference platform's own inspect-vs-edit split (SPEC.md §3.2's
// Update: "tab the saved-record summary, never the act of authoring").
// "Available attributes" vs. "Input parameters" is a real, stated
// interpretation, not a verified fact -- the research explicitly
// flagged their exact relationship as unresolved even after a fuller
// review (SPEC.md §10). This maps them onto Mill's own existing
// Input/Output field split (an operation's declared OutputFields are
// what becomes "available" to reference downstream; InputFields are
// what you send) -- the most defensible reading given what's already
// built, not a guess at the reference platform's own internal model.
export function RequestSummary({ request, onEdit, onDuplicate, onDelete }: {
  request: HTTPRequest
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('configure')
  const AUTH_LABEL_MAP = authLabelFor(t)
  const [operations, setOperations] = useState<OperationRef[] | string | null>(null)
  const [selectedOp, setSelectedOp] = useState('')
  const [fields, setFields] = useState<Operation | string | null>(null)
  // Button-semantics convention (.claude/rules/frontend.md): the bare

  useEffect(() => {
    setOperations(null)
    setSelectedOp('')
    setFields(null)
    if (!request.OpenAPISpec) return
    ConfigureService.ListHTTPRequestOperations(request.ID)
      .then((ops) => {
        const list = ops ?? []
        setOperations(list)
        // Auto-select when there's exactly one operation -- same "no UI
        // for a decision that doesn't exist" reasoning as
        // RequestTestPanel.tsx's own identical fix.
        if (list.length === 1) setSelectedOp(`${list[0].Method} ${list[0].Path}`)
      })
      .catch((err) => setOperations(String(err)))
  }, [request.ID, request.OpenAPISpec])

  useEffect(() => {
    setFields(null)
    if (!selectedOp) return
    const [method, path] = selectedOp.split(' ', 2)
    ConfigureService.HTTPRequestOperationFields(request.ID, path, method)
      .then(setFields)
      .catch((err) => setFields(String(err)))
  }, [request.ID, selectedOp])

  const opsList = Array.isArray(operations) ? operations : []
  const testOperations = request.OpenAPISpec ? parseOpenAPIToOperations(t, request.OpenAPISpec).operations : []

  return (
    <PageContainer variant="narrow">
    <div className={styles.card} data-testid="request-summary">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Heading as="h2" variant="small">{request.Label}</Heading>
          {request.BuiltIn && <StatusStamp variant="identity">{t('builtIn')}</StatusStamp>}
        </Stack>
        <Stack direction="horizontal" gap="condensed">
          <Button size="small" leadingVisual={PencilIcon} onClick={onEdit} data-testid="summary-edit">{t('edit')}</Button>
          <IconButton icon={CopyIcon} aria-label={t('duplicate')} size="small" variant="invisible" onClick={onDuplicate} />
          <IconButton icon={TrashIcon} aria-label={t('delete')} size="small" variant="invisible" onClick={onDelete} />
        </Stack>
      </Stack>

      <Tabs defaultValue="details">
        <TabList aria-label={t('requestSummary.requestSummaryAriaLabel')}>
          <TabItem value="details">{t('requestSummary.details')}</TabItem>
          <TabItem value="attributes">{t('requestSummary.availableAttributes')}</TabItem>
          <TabItem value="input">{t('requestSummary.inputParameters')}</TabItem>
          <TabItem value="test">{t('requestSummary.testing')}</TabItem>
        </TabList>

        <TabPanel value="details">
          <Stack direction="vertical" gap="condensed">
            {request.Description && <DetailRow label={t('requestSummary.description')} value={request.Description} />}
            <DetailRow label={t('requestSummary.method')} value={request.Method || 'GET'} mono />
            <DetailRow label={t('requestSummary.url')} value={request.BaseURL} mono />
            {request.Body !== '' && <DetailRow label={t('requestSummary.body')} value={request.Body} />}
            <DetailRow
              label={t('requestSummary.authType')}
              value={AUTH_LABEL_MAP[request.AuthType] ?? request.AuthType}
              suffix={AUTH_UNIMPLEMENTED.has(request.AuthType)
                ? <StatusStamp variant="caution">{t('requestSummary.notYetImplemented')}</StatusStamp>
                : undefined}
            />
            <DetailRow
              label={t('requestSummary.headers')}
              value={request.Headers && Object.keys(request.Headers).length > 0
                ? Object.entries(request.Headers).map(([k, v]) => `${k}: ${v}`).join(', ')
                : t('requestSummary.none')}
            />
            <DetailRow label={t('requestSummary.schema')} value={request.OpenAPISpec ? t('requestSummary.declared') : t('requestSummary.notDeclared')} />
            <DetailRow
              label={t('requestSummary.joseEncryption')}
              value={request.JOSE?.Enabled
                ? `${t('requestSummary.enabled')}${request.JOSE.DecryptResponse ? t('requestSummary.decryptsResponses') : ''}`
                : t('requestSummary.disabled')}
            />
          </Stack>
        </TabPanel>

        <TabPanel value="attributes">
          <OperationFieldsTab
            requestID={request.ID}
            operations={operations}
            opsList={opsList}
            selectedOp={selectedOp}
            onSelectOp={setSelectedOp}
            fields={fields}
            renderFields={(f) => <SchemaFieldList label={t('requestSummary.outputFieldsLabel')} fields={f.OutputFields} />}
          />
        </TabPanel>

        <TabPanel value="input">
          <OperationFieldsTab
            requestID={request.ID}
            operations={operations}
            opsList={opsList}
            selectedOp={selectedOp}
            onSelectOp={setSelectedOp}
            fields={fields}
            renderFields={(f) => (
              <>
                <SchemaFieldList label={t('requestSummary.parametersLabel')} fields={(f.InputFields ?? []).filter((x) => x.In !== 'body')} />
                <SchemaFieldList label={t('requestSummary.requestBodyLabel')} fields={(f.InputFields ?? []).filter((x) => x.In === 'body')} />
              </>
            )}
          />
        </TabPanel>

        <TabPanel value="test">
          <RequestTestPanel
            operations={testOperations}
            effectiveSpec={request.OpenAPISpec}
            label={request.Label}
            baseURL={request.BaseURL}
            authType={request.AuthType}
            auth={request.Auth}
            jose={request.JOSE}
            headers={rowsToHeaders(headersToRows(request.Headers))}
            secretRef={request.SecretRef}
            requestID={request.ID}
          />
        </TabPanel>
      </Tabs>
    </div>
    </PageContainer>
  )
}

function DetailRow({ label, value, suffix, mono }: { label: string; value: string; suffix?: ReactNode; mono?: boolean }) {
  return (
    <Stack direction="horizontal" gap="condensed" align="center">
      <Text size="small" weight="semibold" style={{ minWidth: '100px' }}>{label}</Text>
      <Text size="small" className={`${styles.muted} ${mono ? monoStyles.mono : ''}`}>{value}</Text>
      {suffix}
    </Stack>
  )
}

function OperationFieldsTab({ operations, opsList, selectedOp, onSelectOp, fields, renderFields }: {
  requestID: string
  operations: OperationRef[] | string | null
  opsList: OperationRef[]
  selectedOp: string
  onSelectOp: (v: string) => void
  fields: Operation | string | null
  renderFields: (f: Operation) => React.ReactNode
}) {
  const { t } = useTranslation('configure')
  if (operations === null) return <Text as="p" size="small" className={styles.muted}>{t('requestSummary.noSchemaDeclared')}</Text>
  if (typeof operations === 'string') return <Text as="p" size="small" className={styles.error}>{operations}</Text>
  if (opsList.length === 0) return <Text as="p" size="small" className={styles.muted}>{t('requestSummary.noOperationsInSpec')}</Text>

  return (
    <Stack direction="vertical" gap="normal">
      {opsList.length > 1 ? (
        <Select aria-label={t('requestSummary.operationAriaLabel')} value={selectedOp} onChange={(e) => onSelectOp(e.target.value)}>
          <Select.Option value="">{t('requestSummary.selectOperation')}</Select.Option>
          {opsList.map((op) => {
            const key = `${op.Method} ${op.Path}`
            return <Select.Option key={key} value={key}>{key}</Select.Option>
          })}
        </Select>
      ) : (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text size="small" weight="semibold">{t('requestSummary.operation')}</Text>
          <Label variant="secondary" size="small">{`${opsList[0].Method} ${opsList[0].Path}`}</Label>
        </Stack>
      )}
      {typeof fields === 'string' && <Text as="p" size="small" className={styles.error}>{fields}</Text>}
      {fields !== null && typeof fields !== 'string' && renderFields(fields)}
    </Stack>
  )
}

function SchemaFieldList({ label, fields }: { label: string; fields: Field[] | null | undefined }) {
  const { t } = useTranslation('configure')
  const list = fields ?? []
  if (list.length === 0) return null
  return (
    <Stack direction="vertical" gap="condensed">
      <Text size="small" weight="semibold">{label}</Text>
      {list.map((f) => (
        <Stack key={f.Key} direction="horizontal" gap="condensed" align="center">
          <Text size="small">{f.Label ? `${f.Label} (${f.Key})` : f.Key}</Text>
          <Label variant="secondary" size="small">{f.In}</Label>
          <Label variant="secondary" size="small">{f.Type}</Label>
          {f.Required && <Label size="small">{t('required')}</Label>}
          {f.Secret && <Label variant="danger" size="small">{t('secret')}</Label>}
          {f.Path && <Label variant="accent" size="small">{t('requestSummary.pathLabel', { path: f.Path })}</Label>}
          {f.Default && <Label variant="accent" size="small">{t('requestSummary.defaultLabel', { value: f.Default })}</Label>}
          {f.Options && f.Options.length > 0 && <Label variant="accent" size="small">{t('requestSummary.enumLabel', { values: f.Options.join(', ') })}</Label>}
        </Stack>
      ))}
      {list.some((f) => f.Description) && (
        <Stack direction="vertical" gap="condensed">
          {list.filter((f) => f.Description).map((f) => (
            <Text key={f.Key} as="p" size="small" className={styles.muted}>{f.Key}: {f.Description}</Text>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
