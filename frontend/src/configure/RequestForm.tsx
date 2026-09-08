import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, FormControl, Heading, IconButton, Select, Stack, Text, TextInput, Textarea } from '@primer/react'
import { PlayIcon, PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../shared/bindings'
import { findCommand } from '../shared/commands'
import { useAppStore } from '../shared/store'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'

import { ManualSchemaEditor } from './ManualSchemaEditor'
import { SchemaIntake, type IntakeResult } from './SchemaIntake'
import { RequestAuthSections } from './RequestAuthSections'
import { RequestAdvancedSection } from './RequestAdvancedSection'
import { RequestTestPanel, type RequestTestPanelHandle } from './RequestTestPanel'
import { useRequestFormTestDispatch } from './useRequestFormTestDispatch'
import { headersToRows, rowsToHeaders } from './requestHeaders'
import { parseOpenAPIToOperations, synthesizeOpenAPISpec, type ManualOperation } from './openapiSynth'
import { EMPTY_DRAFT, authConfigFrom, draftFrom, joseConfigFrom, type HeaderRow, type RequestDraft } from './requestDraft'
import styles from '../shared/ListCard.module.css'
import formStyles from './RequestForm.module.css'
import PageContainer from '../shared/PageContainer'

// Kept as re-exports for existing importers (requestHeaders.ts's own
// HeaderRow import moved to requestDraft.ts directly).
export type { HeaderRow, RequestDraft }

// The reference syntax shown in the URL field's caption -- here, not in
// the locale file, because the braces are i18next interpolation syntax
// rather than text.
const VARIABLE_EXAMPLE = '{{API_BASE}}'

// Same open set integration-http's own method field suggests (ADR-0016,
// internal/domain/composition/integration.go) -- autocomplete hints
// rendered as a Select, not a hard enum (wire stays open).
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
// scroll (General -> Auth -> Headers -> Schema -> Advanced, as Heading
// section breaks; testing lives on the saved record's own tab), replacing the previous Primer-Tabs layout. Matches
// the reference platform's own precedent: tab the saved-record summary
// (RequestSummary.tsx), never the act of authoring. Owns its own
// draft/headerRows/error state internally (seeded once from props,
// same "own state, keyed remount" shape CompositionCanvas.tsx already
// uses for Composition's own tabbed multi-editing) rather than being
// controlled from the parent list page -- required for correctness
// once more than one request tab can be open at once, not just a
// style preference. Renamed from ConnectorForm by ADR-0016.
export function RequestForm({
  editingRequest, duplicateFrom, tabKey, onSaved, onCancel,
}: {
  // Non-null => Save calls UpdateHTTPRequest against this request's ID.
  // Null (whether brand-new or a Duplicate) => Save calls CreateHTTPRequest.
  editingRequest: HTTPRequest | null
  // Set only for the Duplicate case -- seeds the initial draft/headers
  // from an existing request without editing it (docs/adr/0013 §7).
  duplicateFrom: HTTPRequest | null
  // This mounted form's own WorkTab.key (goal 0370) -- lets the Test
  // command's store signal (useRequestFormTestDispatch) and the
  // requestFormTestReady mirror address THIS tab specifically, since
  // every open request-edit/request-new tab stays mounted-hidden.
  tabKey: string
  onSaved: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation('configure')
  const seed = editingRequest ?? duplicateFrom
  const [draft, setDraft] = useState<RequestDraft>(() => {
    if (editingRequest) return draftFrom(editingRequest)
    if (duplicateFrom) return { ...draftFrom(duplicateFrom), label: `${duplicateFrom.Label} copy` }
    return EMPTY_DRAFT
  })
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>(() => headersToRows(seed?.Headers))
  const [error, setError] = useState('')

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
    const { operations } = parseOpenAPIToOperations(t, spec)
    return operations.length > 0 ? operations : [emptyOperation()]
  })
  const [schemaDirty, setSchemaDirty] = useState(false)
  const [rawSpecOpen, setRawSpecOpen] = useState(false)

  // The primary Test action (goal 0370, ADR-0014's on-form-Test
  // amendment): testPanelRef reuses RequestTestPanel's own runTest
  // exactly as the saved record's Testing tab does, never a second
  // request-test code path. testing mirrors the panel's own running
  // state so the outer button can show "Testing..." without lifting
  // the rest of the panel's state out of it.
  const testPanelRef = useRef<RequestTestPanelHandle>(null)
  const [testing, setTesting] = useState(false)
  useRequestFormTestDispatch(tabKey, testPanelRef)

  // Mirrored into the store (shared/requestFormTabState.ts) so
  // configure.integration.testDraft's enabled() can read whether THIS
  // tab's draft has a URL without importing configure/ (dependency-
  // cruiser boundary) -- the same hot-exit-signal shape workTabDirty
  // already uses.
  useEffect(() => {
    useAppStore.getState().setRequestFormTestReady(tabKey, draft.baseURL.trim() !== '')
  }, [tabKey, draft.baseURL])

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

  // Shared by Save and the Test section below -- computed once from the
  // authoritative draft/headerRows state, same "compute once, pass
  // down" discipline as effectiveSpec above, so a test call and a real
  // save never diverge on how they derive these from the same draft.
  const headers = rowsToHeaders(headerRows)
  const auth = authConfigFrom(draft)
  const jose = joseConfigFrom(draft)
  // Reparsed from effectiveSpec directly (not manualOperations' own
  // possibly-untransformed path/method) -- RequestTestPanel's Path/Method
  // must match exactly what TestHTTPRequestOperation parses out of the
  // OpenAPISpec string it's actually sent, the same discipline
  // RequestSummary.tsx's own testOperations already follows.
  const testOperations = effectiveSpec.trim() !== '' ? parseOpenAPIToOperations(t, effectiveSpec).operations : []

  // Direct raw-spec editing (the disclosure textarea below) makes the
  // raw text authoritative again and re-seeds the editor from it.
  const editRawSpec = (specText: string) => {
    setDraft({ ...draft, openAPISpec: specText })
    setSchemaDirty(false)
    const { operations } = parseOpenAPIToOperations(t, specText)
    setManualOperations(operations.length > 0 ? operations : [emptyOperation()])
  }

  const handleSave = async () => {
    const finalDraft = { ...draft, openAPISpec: effectiveSpec }
    setError('')
    try {
      await (editingRequest
        ? ConfigureService.UpdateHTTPRequest(editingRequest.ID, finalDraft.label, finalDraft.baseURL, finalDraft.method, finalDraft.body, finalDraft.authType, finalDraft.secretRef, headers, finalDraft.openAPISpec, auth, jose, finalDraft.description)
        : ConfigureService.CreateHTTPRequest(finalDraft.label, finalDraft.baseURL, finalDraft.method, finalDraft.body, finalDraft.authType, finalDraft.secretRef, headers, finalDraft.openAPISpec, auth, jose, finalDraft.description))
    } catch (err) {
      setError(String(err))
      return
    }
    // Nothing follows the save: every secret this request uses is a
    // reference it already carries (goal 0306), so there is no second,
    // write-only channel that could half-succeed behind a saved entity.
    onSaved()
  }

  return (
    <PageContainer variant="narrow">
    <div className={styles.card}>
      <Stack direction="vertical" gap="normal">
        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>{t('requestForm.general')}</Heading>
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>{t('requestForm.label')}</FormControl.Label>
              <TextInput value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} block />
            </FormControl>
            {/* Method + URL side by side, the first thing after the
                label -- Postman/Bruno's own request row (ADR-0016
                Phase B). A real Select, not free text, by direct user
                decision ("METHOD should not be free form text") -- the
                wire format stays open (any persisted value renders as
                an extra option rather than breaking), only the UI
                presents a typed choice. Stacks vertically below Primer's
                own "narrow" breakpoint (<768px, Stack's own
                ResponsiveValue direction) rather than a hand-rolled
                media query -- a narrower row than that has no space for
                both controls side by side regardless of Method's own
                fixed width. align is responsive too: "end" is a cross-
                axis value, so it means bottom-aligned in the horizontal
                row but RIGHT-aligned once the stack flips vertical --
                an unresponsive "end" shoved the stacked Method control
                against the right edge instead of the natural left-
                aligned column every other field in this form uses. */}
            <Stack direction={{ narrow: 'vertical', regular: 'horizontal' }} gap="condensed" align={{ narrow: 'stretch', regular: 'end' }}>
              <FormControl>
                <FormControl.Label>{t('requestForm.method')}</FormControl.Label>
                <Select
                  value={draft.method || 'GET'}
                  onChange={(e) => setDraft({ ...draft, method: e.target.value })}
                  block={false}
                  className={formStyles.methodSelect}
                  data-testid="request-method"
                >
                  {(METHOD_SUGGESTIONS.includes(draft.method || 'GET')
                    ? METHOD_SUGGESTIONS
                    : [...METHOD_SUGGESTIONS, draft.method]
                  ).map((m) => <Select.Option key={m} value={m}>{m}</Select.Option>)}
                </Select>
              </FormControl>
              <FormControl style={{ flexGrow: 1 }}>
                <FormControl.Label>{t('requestForm.url')}</FormControl.Label>
                <FormControl.Caption>{t('requestForm.urlCaption', { example: VARIABLE_EXAMPLE })}</FormControl.Caption>
                <TextInput value={draft.baseURL} onChange={(e) => setDraft({ ...draft, baseURL: e.target.value })} placeholder={t('requestForm.urlPlaceholder')} block />
              </FormControl>
            </Stack>
            <FormControl>
              <FormControl.Label>{t('requestForm.description')}</FormControl.Label>
              <FormControl.Caption>{t('requestForm.descriptionCaption')}</FormControl.Caption>
              <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={4} block data-testid="request-description" />
            </FormControl>
          </Stack>
        </section>

        <RequestAuthSections draft={draft} setDraft={setDraft} />

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>{t('requestForm.headers')}</Heading>
          <Stack direction="vertical" gap="condensed">
            <Text as="p" size="small" className={styles.muted}>
              {t('requestForm.headersDescription')}
            </Text>
            {headerRows.map((row, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput placeholder={t('requestForm.headerNamePlaceholder')} value={row.key} onChange={(e) => updateHeaderRow(i, 'key', e.target.value)} data-testid="request-header-key" />
                <TextInput placeholder={t('requestForm.valuePlaceholder')} value={row.value} onChange={(e) => updateHeaderRow(i, 'value', e.target.value)} data-testid="request-header-value" />
                <IconButton icon={TrashIcon} aria-label={t('requestForm.removeHeaderAriaLabel')} size="small" variant="invisible" onClick={() => setHeaderRows(headerRows.filter((_, idx) => idx !== i))} />
              </Stack>
            ))}
            <Button size="small" variant="invisible" leadingVisual={PlusIcon} onClick={() => setHeaderRows([...headerRows, { key: '', value: '' }])} data-testid="add-request-header">
              {t('requestForm.addHeader')}
            </Button>
          </Stack>
        </section>

        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>{t('requestForm.schema')}</Heading>
          <Stack direction="vertical" gap="normal">
            <Text as="p" size="small" className={styles.muted}>
              {t('requestForm.schemaDescription')}
            </Text>
            <SchemaIntake onLoad={applyIntake} />
            {manualOperations.length > 1 && (
              <Text as="p" size="small" className={styles.muted} data-testid="multi-operation-note">
                {t('requestForm.multiOperationNote', { count: manualOperations.length })}
              </Text>
            )}
            <ManualSchemaEditor operations={manualOperations} onChange={editOperations} requestMethod={draft.method} />
            <Button
              size="small"
              variant="invisible"
              onClick={() => setRawSpecOpen(!rawSpecOpen)}
              data-testid="toggle-raw-openapi"
            >
              {rawSpecOpen ? t('requestForm.hideRawOpenapi') : t('requestForm.viewRawOpenapi')}
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

        <RequestAdvancedSection draft={draft} setDraft={setDraft} />

        {/* Test is the form's one primary action (goal 0370, every
            precedent's own Send/Run) -- Save below is deliberately
            demoted off variant="primary" so the two don't compete on
            one screen (.claude/rules/frontend.md's one-primary-per-
            region rule), the same resolution CanvasMetaHeader.tsx
            already applies to Save + Run. Drives the registry command
            (never the ref directly) so the palette and a future
            keyboard binding reach the identical path a click does;
            testPanelRef.current?.trigger() is what actually runs it,
            reusing RequestTestPanel's own runTest rather than a second
            test-call path. */}
        <section>
          <Heading as="h3" variant="small" className={styles.sectionHeading}>{t('requestForm.test')}</Heading>
          <Stack direction="vertical" gap="condensed">
            <Text as="p" size="small" className={styles.muted}>{t('requestForm.testCaption')}</Text>
            <Button
              variant="primary"
              size="small"
              leadingVisual={PlayIcon}
              onClick={() => { void findCommand('configure.integration.testDraft')?.run() }}
              disabled={testing || draft.baseURL.trim() === ''}
              data-testid="request-test-draft"
            >
              {testing ? t('requestForm.testing') : t('requestForm.test')}
            </Button>
            <RequestTestPanel
              ref={testPanelRef}
              operations={testOperations}
              effectiveSpec={effectiveSpec}
              label={draft.label}
              baseURL={draft.baseURL}
              authType={draft.authType}
              auth={auth}
              jose={jose}
              headers={headers}
              secretRef={draft.secretRef}
              requestID={editingRequest?.ID ?? null}
              hideRunButton
              onRunningChange={setTesting}
            />
          </Stack>
        </section>
      </Stack>

      {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
      <Stack direction="horizontal" gap="condensed" style={{ marginTop: 'var(--base-size-12)' }}>
        <Button size="small" onClick={handleSave}>{t('requestForm.saveRequest')}</Button>
        <Button size="small" variant="invisible" onClick={onCancel}>{t('requestForm.cancel')}</Button>
      </Stack>
    </div>
    </PageContainer>
  )
}
