import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Heading, IconButton, Label, Select, Stack, Text } from '@primer/react'
import { PencilIcon, CopyIcon, TrashIcon } from '@primer/octicons-react'
import { Tabs } from '@primer/react/experimental'
import { TabItem, TabList, TabPanel } from '../shared/Tabs'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { Connector } from '../../bindings/github.com/alicoding/mill/internal/domain/connector/models'
import type { Field, Operation, OperationRef } from '../../bindings/github.com/alicoding/mill/internal/adapters/openapispec/models'
import { ConnectorTestPanel } from './ConnectorTestPanel'
import { headersToRows, rowsToHeaders } from './connectorHeaders'
import { parseOpenAPIToOperations } from './openapiSynth'
import { AUTH_LABEL, AUTH_UNIMPLEMENTED } from './authTypeLabels'
import styles from '../shared/ListCard.module.css'

// docs/adr/0014: the read-only view of a saved connector -- four tabs
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
export function ConnectorSummary({ connector, onEdit, onDuplicate, onDelete }: {
  connector: Connector
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
    if (!connector.OpenAPISpec) return
    ConfigureService.ListConnectorOperations(connector.ID)
      .then((ops) => setOperations(ops ?? []))
      .catch((err) => setOperations(String(err)))
  }, [connector.ID, connector.OpenAPISpec])

  useEffect(() => {
    setFields(null)
    if (!selectedOp) return
    const [method, path] = selectedOp.split(' ', 2)
    ConfigureService.ConnectorOperationFields(connector.ID, path, method)
      .then(setFields)
      .catch((err) => setFields(String(err)))
  }, [connector.ID, selectedOp])

  const opsList = Array.isArray(operations) ? operations : []
  const testOperations = connector.OpenAPISpec ? parseOpenAPIToOperations(connector.OpenAPISpec).operations : []

  return (
    <div className={styles.card} data-testid="connector-summary">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small">{connector.Label}</Heading>
        <Stack direction="horizontal" gap="condensed">
          <Button size="small" leadingVisual={PencilIcon} onClick={onEdit} data-testid="summary-edit">Edit</Button>
          <IconButton icon={CopyIcon} aria-label="Duplicate" size="small" variant="invisible" onClick={onDuplicate} />
          <IconButton icon={TrashIcon} aria-label="Delete" size="small" variant="invisible" onClick={onDelete} />
        </Stack>
      </Stack>

      <Tabs defaultValue="details">
        <TabList aria-label="Connector summary">
          <TabItem value="details">Details</TabItem>
          <TabItem value="attributes">Available attributes</TabItem>
          <TabItem value="input">Input parameters</TabItem>
          <TabItem value="test">Testing</TabItem>
        </TabList>

        <TabPanel value="details">
          <Stack direction="vertical" gap="condensed">
            <DetailRow label="Base URL" value={connector.BaseURL} />
            <DetailRow
              label="Auth type"
              value={AUTH_LABEL[connector.AuthType] ?? connector.AuthType}
              suffix={AUTH_UNIMPLEMENTED.has(connector.AuthType)
                ? <Label variant="attention" size="small">not yet implemented</Label>
                : undefined}
            />
            <DetailRow
              label="Headers"
              value={connector.Headers && Object.keys(connector.Headers).length > 0
                ? Object.entries(connector.Headers).map(([k, v]) => `${k}: ${v}`).join(', ')
                : '(none)'}
            />
            <DetailRow label="Schema" value={connector.OpenAPISpec ? 'Declared' : 'Not declared'} />
          </Stack>
        </TabPanel>

        <TabPanel value="attributes">
          <OperationFieldsTab
            connectorID={connector.ID}
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
            connectorID={connector.ID}
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
          <ConnectorTestPanel
            operations={testOperations}
            effectiveSpec={connector.OpenAPISpec}
            baseURL={connector.BaseURL}
            authType={connector.AuthType}
            auth={connector.Auth}
            headers={rowsToHeaders(headersToRows(connector.Headers))}
            secret=""
            connectorID={connector.ID}
          />
        </TabPanel>
      </Tabs>
    </div>
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
  connectorID: string
  operations: OperationRef[] | string | null
  opsList: OperationRef[]
  selectedOp: string
  onSelectOp: (v: string) => void
  fields: Operation | string | null
  renderFields: (f: Operation) => React.ReactNode
}) {
  if (operations === null) return <Text as="p" size="small" className={styles.muted}>No schema declared for this connector.</Text>
  if (typeof operations === 'string') return <Text as="p" size="small" className={styles.error}>{operations}</Text>
  if (opsList.length === 0) return <Text as="p" size="small" className={styles.muted}>This spec declares no operations.</Text>

  return (
    <Stack direction="vertical" gap="normal">
      <Select aria-label="Operation" value={selectedOp} onChange={(e) => onSelectOp(e.target.value)}>
        <Select.Option value="">Select an operation…</Select.Option>
        {opsList.map((op) => {
          const key = `${op.Method} ${op.Path}`
          return <Select.Option key={key} value={key}>{key}</Select.Option>
        })}
      </Select>
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
