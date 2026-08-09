import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Heading, IconButton, Label, Select, Stack, Text } from '@primer/react'
import { PencilIcon, CopyIcon, TrashIcon } from '@primer/octicons-react'
import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import type { Field, Operation, OperationRef } from '../../bindings/github.com/alicoding/mill/internal/adapters/openapispec/models'
import { RequestTestPanel } from './RequestTestPanel'
import { headersToRows, rowsToHeaders } from './requestHeaders'
import { parseOpenAPIToOperations } from './openapiSynth'
import { AUTH_LABEL, AUTH_UNIMPLEMENTED } from './authTypeLabels'
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
  const [operations, setOperations] = useState<OperationRef[] | string | null>(null)
  const [selectedOp, setSelectedOp] = useState('')
  const [fields, setFields] = useState<Operation | string | null>(null)

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
  const testOperations = request.OpenAPISpec ? parseOpenAPIToOperations(request.OpenAPISpec).operations : []

  return (
    <PageContainer variant="narrow">
    <div className={styles.card} data-testid="request-summary">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Stack direction="horizontal" gap="condensed" align="center">
          <Heading as="h2" variant="small">{request.Label}</Heading>
          {request.BuiltIn && <Label variant="secondary" size="small">built-in</Label>}
        </Stack>
        <Stack direction="horizontal" gap="condensed">
          <Button size="small" leadingVisual={PencilIcon} onClick={onEdit} data-testid="summary-edit">Edit</Button>
          <IconButton icon={CopyIcon} aria-label="Duplicate" size="small" variant="invisible" onClick={onDuplicate} />
          <IconButton icon={TrashIcon} aria-label="Delete" size="small" variant="invisible" onClick={onDelete} />
        </Stack>
      </Stack>

      <Tabs defaultValue="details">
        <TabList aria-label="Request summary">
          <TabItem value="details">Details</TabItem>
          <TabItem value="attributes">Available attributes</TabItem>
          <TabItem value="input">Input parameters</TabItem>
          <TabItem value="test">Testing</TabItem>
        </TabList>

        <TabPanel value="details">
          <Stack direction="vertical" gap="condensed">
            {request.Description && <DetailRow label="Description" value={request.Description} />}
            <DetailRow label="Method" value={request.Method || 'GET'} />
            <DetailRow label="Base URL" value={request.BaseURL} />
            {request.Body !== '' && <DetailRow label="Body" value={request.Body} />}
            <DetailRow
              label="Auth type"
              value={AUTH_LABEL[request.AuthType] ?? request.AuthType}
              suffix={AUTH_UNIMPLEMENTED.has(request.AuthType)
                ? <Label variant="attention" size="small">not yet implemented</Label>
                : undefined}
            />
            <DetailRow
              label="Headers"
              value={request.Headers && Object.keys(request.Headers).length > 0
                ? Object.entries(request.Headers).map(([k, v]) => `${k}: ${v}`).join(', ')
                : '(none)'}
            />
            <DetailRow label="Schema" value={request.OpenAPISpec ? 'Declared' : 'Not declared'} />
            <DetailRow
              label="JOSE encryption"
              value={request.JOSE?.Enabled
                ? `Enabled${request.JOSE.DecryptResponse ? ' (decrypts responses)' : ''}`
                : 'Disabled'}
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
            renderFields={(f) => <SchemaFieldList label="Output" fields={f.OutputFields} />}
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
                <SchemaFieldList label="Parameters (path / query / header)" fields={(f.InputFields ?? []).filter((x) => x.In !== 'body')} />
                <SchemaFieldList label="Request body" fields={(f.InputFields ?? []).filter((x) => x.In === 'body')} />
              </>
            )}
          />
        </TabPanel>

        <TabPanel value="test">
          <RequestTestPanel
            operations={testOperations}
            effectiveSpec={request.OpenAPISpec}
            baseURL={request.BaseURL}
            authType={request.AuthType}
            auth={request.Auth}
            jose={request.JOSE}
            josePrivateKeyPEM=""
            headers={rowsToHeaders(headersToRows(request.Headers))}
            secret=""
            requestID={request.ID}
          />
        </TabPanel>
      </Tabs>
    </div>
    </PageContainer>
  )
}

function DetailRow({ label, value, suffix }: { label: string; value: string; suffix?: ReactNode }) {
  return (
    <Stack direction="horizontal" gap="condensed" align="center">
      <Text size="small" weight="semibold" style={{ minWidth: '100px' }}>{label}</Text>
      <Text size="small" className={styles.muted}>{value}</Text>
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
  if (operations === null) return <Text as="p" size="small" className={styles.muted}>No schema declared for this request.</Text>
  if (typeof operations === 'string') return <Text as="p" size="small" className={styles.error}>{operations}</Text>
  if (opsList.length === 0) return <Text as="p" size="small" className={styles.muted}>This spec declares no operations.</Text>

  return (
    <Stack direction="vertical" gap="normal">
      {opsList.length > 1 ? (
        <Select aria-label="Operation" value={selectedOp} onChange={(e) => onSelectOp(e.target.value)}>
          <Select.Option value="">Select an operation…</Select.Option>
          {opsList.map((op) => {
            const key = `${op.Method} ${op.Path}`
            return <Select.Option key={key} value={key}>{key}</Select.Option>
          })}
        </Select>
      ) : (
        <Stack direction="horizontal" gap="condensed" align="center">
          <Text size="small" weight="semibold">Operation</Text>
          <Label variant="secondary" size="small">{`${opsList[0].Method} ${opsList[0].Path}`}</Label>
        </Stack>
      )}
      {typeof fields === 'string' && <Text as="p" size="small" className={styles.error}>{fields}</Text>}
      {fields !== null && typeof fields !== 'string' && renderFields(fields)}
    </Stack>
  )
}

function SchemaFieldList({ label, fields }: { label: string; fields: Field[] | null | undefined }) {
  const list = fields ?? []
  if (list.length === 0) return null
  return (
    <Stack direction="vertical" gap="condensed">
      <Text size="small" weight="semibold">{label}</Text>
      {list.map((f) => (
        <Stack key={f.Name} direction="horizontal" gap="condensed" align="center">
          <Text size="small">{f.Alias ? `${f.Alias} (${f.Name})` : f.Name}</Text>
          <Label variant="secondary" size="small">{f.In}</Label>
          <Label variant="secondary" size="small">{f.Type}</Label>
          {f.Required && <Label size="small">required</Label>}
          {f.IsSecret && <Label variant="danger" size="small">secret</Label>}
          {f.Path && <Label variant="accent" size="small">path: {f.Path}</Label>}
          {f.Default && <Label variant="accent" size="small">default: {f.Default}</Label>}
          {f.EnumValues && f.EnumValues.length > 0 && <Label variant="accent" size="small">enum: {f.EnumValues.join(', ')}</Label>}
        </Stack>
      ))}
      {list.some((f) => f.Description) && (
        <Stack direction="vertical" gap="condensed">
          {list.filter((f) => f.Description).map((f) => (
            <Text key={f.Name} as="p" size="small" className={styles.muted}>{f.Name}: {f.Description}</Text>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
