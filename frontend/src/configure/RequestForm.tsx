import { useState } from 'react'
import { Button, FormControl, Heading, IconButton, Select, Stack, Text, TextInput, Textarea } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { ManualSchemaEditor } from './ManualSchemaEditor'
import { SchemaIntake, type IntakeResult } from './SchemaIntake'
import { RequestAuthSections } from './RequestAuthSections'
import { RequestTestPanel } from './RequestTestPanel'
import { headersToRows, rowsToHeaders } from './requestHeaders'
import { parseOpenAPIToOperations, synthesizeOpenAPISpec, type ManualOperation } from './openapiSynth'
import { EMPTY_DRAFT, authConfigFrom, draftFrom, joseConfigFrom, type HeaderRow, type RequestDraft } from './requestDraft'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

// Kept as re-exports for existing importers (requestHeaders.ts's own
// HeaderRow import moved to requestDraft.ts directly).
export type { HeaderRow, RequestDraft }

// Same open set integration-http's own method field suggests (ADR-0016,
// internal/domain/composition/integration.go) -- autocomplete hints on
// rendered as a Select by direct user decision (wire stays open).
const METHOD_SUGGESTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'QUERY']
// The subset OpenAPI 3.x can actually express as a PathItem field --
// used only when synthesizing the schema document, never to restrict
// what the request itself sends (ADR-0016: kin-openapi's PathItem has
// no QUERY/custom-verb field, so a non-representable method's schema
// operation synthesizes as POST while execution still sends the real
// method).
const OPENAPI_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']

function emptyOperation(): ManualOperation {
  return { path: '', method: 'GET', summary: '', inputFields: [], outputFields: [] }
}

// docs/adr/0014: the request create/edit form -- one continuous guided
// scroll (General -> Auth -> Headers -> Schema -> Test, as Heading
// section breaks), replacing the previous Primer-Tabs layout. Matches
// the reference platform's own precedent: tab the saved-record summary
// (RequestSummary.tsx), never the act of authoring. Owns its own
// draft/headerRows/error state internally (seeded once from props,
// same "own state, keyed remount" shape CompositionCanvas.tsx already
// uses for Composition's own tabbed multi-editing) rather than being
// controlled from the parent list page -- required for correctness
// once more than one request tab can be open at once, not just a
// style preference. Renamed from ConnectorForm by ADR-0016.
export function RequestForm({
  editingRequest, duplicateFrom, onSaved, onCancel,
}: {
  // Non-null => Save calls UpdateHTTPRequest against this request's ID.
  // Null (whether brand-new or a Duplicate) => Save calls CreateHTTPRequest.
  editingRequest: HTTPRequest | null
  // Set only for the Duplicate case -- seeds the initial draft/headers
  // from an existing request without editing it (docs/adr/0013 §7).
  duplicateFrom: HTTPRequest | null
  onSaved: () => void
  onCancel: () => void
}) {
  const seed = editingRequest ?? duplicateFrom
  const [draft, setDraft] = useState<RequestDraft>(() => {
    if (editingRequest) return draftFrom(editingRequest)
    if (duplicateFrom) return { ...draftFrom(duplicateFrom), label: `${duplicateFrom.Label} copy` }
    return EMPTY_DRAFT
  })
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => headersToRows(seed?.Headers))
  const [error, setError] = useState('')
  const isEditing = editingRequest !== null

  // The manual editor is the one always-visible schema representation
  // (the previous Paste-OpenAPI/Manual mode switch is gone) -- seeded
  // from the existing spec's parse, or one blank implicit operation
  // for a new request. schemaDirty tracks whether the user actually
  // changed the schema (an editor edit or an intake load): while
  // false, Save keeps the stored spec byte-verbatim, so opening and
  // re-saving a request whose pasted vendor spec contains shapes the
  // bounded parse skips (ADR-0011) never silently rewrites it.
  const [manualOperations, setManualOperations] = useState<ManualOperation[]>(() => {
    const spec = seed?.OpenAPISpec ?? ''
    if (spec.trim() === '') return [emptyOperation()]
    const { operations } = parseOpenAPIToOperations(spec)
    return operations.length > 0 ? operations : [emptyOperation()]
  })
  const [schemaDirty, setSchemaDirty] = useState(false)
  const [rawSpecOpen, setRawSpecOpen] = useState(false)

  const updateHeaderRow = (i: number, field: 'key' | 'value', value: string) => {
    setHeaderRows(headerRows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)))
  }

  const editOperations = (ops: ManualOperation[]) => {
    setManualOperations(ops)
    setSchemaDirty(true)
  }

  // An intake load (SchemaIntake.tsx): an OpenAPI document or CSV
  // replaces the whole operation set; a JSON sample appends its
  // inferred fields to the first operation's chosen side.
  const applyIntake = (result: IntakeResult) => {
    if (result.kind === 'sample') {
      setManualOperations((ops) => {
        const base = ops.length > 0 ? ops : [emptyOperation()]
        return base.map((op, i) => {
          if (i !== 0) return op
          return result.target === 'body'
            ? { ...op, inputFields: [...op.inputFields, ...result.fields] }
            : { ...op, outputFields: [...op.outputFields, ...result.fields] }
        })
      })
    } else {
      setManualOperations(result.operations)
    }
    setSchemaDirty(true)
  }

  // The schema document synthesized from the editor: a lone operation
  // takes the request's own Method (clamped to what OpenAPI can
  // express -- see OPENAPI_METHODS) and defaults its path to "/";
  // multi-operation sets keep their own per-operation method/path.
  const requestMethodUpper = (draft.method.trim() || 'GET').toUpperCase()
  const schemaOpMethod = OPENAPI_METHODS.includes(requestMethodUpper) ? requestMethodUpper : 'POST'
  const toSchemaOps = (ops: ManualOperation[]): ManualOperation[] => ops.map((op) => ({
    ...op,
    path: op.path.trim() === '' ? '/' : op.path,
    method: ops.length === 1 ? schemaOpMethod : op.method,
  }))
  const opsHaveContent = manualOperations.some(
    (op) => op.inputFields.length > 0 || op.outputFields.length > 0 || op.path.trim() !== '' || op.responseExtractPath,
  )
  // A method change on a request whose single declared operation came
  // from its stored spec also regenerates the spec -- otherwise the
  // schema operation would keep the old method while the request sends
  // the new one, and the two would silently disagree.
  const seedMethodUpper = (seed?.Method || 'GET').toUpperCase()
  const effectiveDirty = schemaDirty
    || (manualOperations.length === 1 && draft.openAPISpec.trim() !== '' && requestMethodUpper !== seedMethodUpper)
  // Computed into a local value and used directly at Save, never
  // round-tripped through setState first -- setState isn't synchronous
  // (.claude/rules/testing.md's own documented bug pattern).
  const effectiveSpec = effectiveDirty
    ? (opsHaveContent ? synthesizeOpenAPISpec(toSchemaOps(manualOperations)) : '')
    : draft.openAPISpec
  const effectiveOperations = effectiveDirty
    ? (opsHaveContent ? toSchemaOps(manualOperations) : [])
    : parseOpenAPIToOperations(draft.openAPISpec).operations

  // Direct raw-spec editing (the disclosure textarea below) makes the
  // raw text authoritative again and re-seeds the editor from it.
  const editRawSpec = (specText: string) => {
    setDraft({ ...draft, openAPISpec: specText })
    setSchemaDirty(false)
    const { operations } = parseOpenAPIToOperations(specText)
    setManualOperations(operations.length > 0 ? operations : [emptyOperation()])
  }

  const handleSave = async () => {
    const finalDraft = { ...draft, openAPISpec: effectiveSpec }
    setError('')
    try {
      const headers = rowsToHeaders(headerRows)
      const auth = authConfigFrom(finalDraft)
      const jose = joseConfigFrom(finalDraft)
      const saved = editingRequest
        ? await ConfigureService.UpdateHTTPRequest(editingRequest.ID, finalDraft.label, finalDraft.baseURL, finalDraft.method, finalDraft.body, finalDraft.authType, headers, finalDraft.openAPISpec, auth, jose, finalDraft.description)
        : await ConfigureService.CreateHTTPRequest(finalDraft.label, finalDraft.baseURL, finalDraft.method, finalDraft.body, finalDraft.authType, headers, finalDraft.openAPISpec, auth, jose, finalDraft.description)
      if (finalDraft.authType === AuthType.AuthOAuth1) {
        if (finalDraft.oauth1ConsumerSecret || finalDraft.oauth1TokenSecret) {
          await ConfigureService.SetHTTPRequestOAuth1Secret(saved.ID, finalDraft.oauth1ConsumerSecret, finalDraft.oauth1TokenSecret)
        }
      } else if (finalDraft.secret) {
        await ConfigureService.SetHTTPRequestSecret(saved.ID, finalDraft.secret)
      }
      if (finalDraft.joseEnabled && finalDraft.joseDecryptResponse && finalDraft.josePrivateKeyPEM) {
        await ConfigureService.SetHTTPRequestJOSEPrivateKey(saved.ID, finalDraft.josePrivateKeyPEM)
      }
      onSaved()
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <PageContainer variant="narrow">
    <div className={styles.card}>
      <Stack direction="vertical" gap="normal">
        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>General</Heading>
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>Label</FormControl.Label>
              <TextInput value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} block />
            </FormControl>
            {/* Method + URL side by side, the first thing after the
                label -- Postman/Bruno's own request row (ADR-0016
                Phase B). A real Select, not free text, by direct user
                decision ("METHOD should not be free form text") -- the
                wire format stays open (any persisted value renders as
                an extra option rather than breaking), only the UI
                presents a typed choice. */}
            <Stack direction="horizontal" gap="condensed" align="end">
              <FormControl>
                <FormControl.Label>Method</FormControl.Label>
                <Select
                  value={draft.method || 'GET'}
                  onChange={(e) => setDraft({ ...draft, method: e.target.value })}
                  data-testid="request-method"
                >
                  {(METHOD_SUGGESTIONS.includes(draft.method || 'GET')
                    ? METHOD_SUGGESTIONS
                    : [...METHOD_SUGGESTIONS, draft.method]
                  ).map((m) => <Select.Option key={m} value={m}>{m}</Select.Option>)}
                </Select>
              </FormControl>
              <FormControl style={{ flexGrow: 1 }}>
                <FormControl.Label>Base URL</FormControl.Label>
                <TextInput value={draft.baseURL} onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })} placeholder="https://api.example.com" block />
              </FormControl>
            </Stack>
            <FormControl>
              <FormControl.Label>Body</FormControl.Label>
              <FormControl.Caption>
                Optional -- a raw request body sent as-is (e.g. fixed JSON). If the Schema below declares
                body fields and a workflow binds them, the bound body wins; this is the fallback. Lives
                here, not on the workflow node: transport and payload shape are the integration&apos;s own.
              </FormControl.Caption>
              <Textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={2} block data-testid="request-body" />
            </FormControl>
            <FormControl>
              <FormControl.Label>Description</FormControl.Label>
              <FormControl.Caption>Optional -- what this request is for, or any caveat worth noting.</FormControl.Caption>
              <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={2} block data-testid="request-description" />
            </FormControl>
          </Stack>
        </section>

        <RequestAuthSections draft={draft} setDraft={setDraft} isEditing={isEditing} />

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>Headers</Heading>
          <Stack direction="vertical" gap="condensed">
            <Text as="p" size="small" className={styles.muted}>
              Static headers (e.g. a required API version) sent with every call, in addition to
              whatever the Auth type adds.
            </Text>
            {headerRows.map((row, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput placeholder="header name" value={row.key} onChange={(e) => updateHeaderRow(i, 'key', e.target.value)} data-testid="request-header-key" />
                <TextInput placeholder="value" value={row.value} onChange={(e) => updateHeaderRow(i, 'value', e.target.value)} data-testid="request-header-value" />
                <IconButton icon={TrashIcon} aria-label="Remove header" size="small" variant="invisible" onClick={() => setHeaderRows(headerRows.filter((_, idx) => idx !== i))} />
              </Stack>
            ))}
            <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => setHeaderRows([...headerRows, { key: '', value: '' }])} data-testid="add-request-header">
              Add header
            </Button>
          </Stack>
        </section>

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>Schema</Heading>
          <Stack direction="vertical" gap="normal">
            <Text as="p" size="small" className={styles.muted}>
              The payload&apos;s structure only -- typed input/output fields a workflow node can bind
              Attributes to (ADR-0007). Method and URL live above; they are never part of the schema.
              Leave empty to keep using a literal request body.
            </Text>
            <SchemaIntake onLoad={applyIntake} />
            {manualOperations.length > 1 && (
              <Text as="p" size="small" className={styles.muted} data-testid="multi-operation-note">
                This request&apos;s stored schema declares {manualOperations.length} operations. A Mill
                request is one call (1:1 with its operation) -- remove the extras below, or Duplicate
                the request once per operation.
              </Text>
            )}
            <ManualSchemaEditor operations={manualOperations} onChange={editOperations} requestMethod={draft.method} />
            <Button
              size="small"
              variant="invisible"
              onClick={() => setRawSpecOpen(!rawSpecOpen)}
              data-testid="toggle-raw-openapi"
            >
              {rawSpecOpen ? 'Hide raw OpenAPI' : 'View raw OpenAPI'}
            </Button>
            {rawSpecOpen && (
              <Textarea
                value={effectiveDirty ? effectiveSpec : draft.openAPISpec}
                onChange={(e) => editRawSpec(e.target.value)}
                rows={6}
                block
                data-testid="request-openapi-spec"
              />
            )}
          </Stack>
        </section>

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>Test</Heading>
          <RequestTestPanel
            operations={effectiveOperations}
            effectiveSpec={effectiveSpec}
            baseURL={draft.baseURL}
            authType={draft.authType}
            auth={authConfigFrom(draft)}
            jose={joseConfigFrom(draft)}
            josePrivateKeyPEM={draft.josePrivateKeyPEM}
            headers={rowsToHeaders(headerRows)}
            secret={draft.authType === AuthType.AuthOAuth1 ? draft.oauth1ConsumerSecret : draft.secret}
            requestID={isEditing ? editingRequest.ID : null}
          />
        </section>
      </Stack>

      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      <Stack direction="horizontal" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
        <Button variant="primary" size="small" onClick={handleSave}>Save request</Button>
        <Button size="small" variant="invisible" onClick={onCancel}>Cancel</Button>
      </Stack>
    </div>
    </PageContainer>
  )
}
