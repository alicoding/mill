import { useState } from 'react'
import { Button, FormControl, Heading, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { ConfigureService } from '../shared/bindings'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { Type as ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/typedfield/models'
import { refreshWorkflows, useAppStore } from '../shared/store'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

const TYPE_LABEL: Record<string, string> = {
  [ConfigFieldType.TypeText]: 'Text',
  [ConfigFieldType.TypeNumber]: 'Number',
  [ConfigFieldType.TypeBoolean]: 'Boolean',
}

// Configure's Attributes section (docs/SPEC.md §3.5): editing a single
// workflow's declared Attributes schema (ConfigureService.
// UpdateWorkflowAttributes, which re-validates the workflow's Decision
// edges against the new schema server-side). FieldOptions is
// deliberately excluded from the type picker -- AttributeDef's Options
// field (docs/adr/0029 Phase 1) has no authoring UI here yet, so there's
// no way to build a choice-set from it; see ruleTranslate.ts's
// fieldsFromAttributes for the same exclusion on the read side.
export function ConfigureAttributes() {
  // Store-shared workflows (shared/store.ts's refreshWorkflows/
  // useAppStore) instead of this page's own CompositionService.
  // Workflows() fetch (goal 0017 P1-1: it's the same list every other
  // surface reads, and App.tsx already fetches it once on mount and
  // refreshes it on mill-data-changed{entity:"workflow"} -- a second,
  // page-local copy could only ever drift from that).
  const workflows = useAppStore((s) => s.workflows)
  const [selectedID, setSelectedID] = useState('')
  const [attrs, setAttrs] = useState<AttributeDef[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const selectWorkflow = (id: string) => {
    setSelectedID(id)
    setAttrs(workflows?.find((w) => w.ID === id)?.Attributes ?? [])
    setError('')
    setSaved(false)
  }

  const updateAttr = (i: number, field: keyof AttributeDef, value: string) => {
    setAttrs((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)))
  }

  const save = async () => {
    setError('')
    setSaved(false)
    setSaving(true)
    try {
      await ConfigureService.UpdateWorkflowAttributes(selectedID, attrs)
      void refreshWorkflows()
      setSaved(true)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageContainer variant="narrow" data-testid="configure-attributes">
      <Heading as="h2" variant="small" className={styles.sectionHeading}>Attributes</Heading>
      <Text as="p" size="small" className={styles.muted}>
        Attributes are scoped to a single workflow (1:1) -- pick one to edit its declared schema. Decision edges in
        that workflow evaluate against these fields.
      </Text>

      {workflows === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {workflows !== null && (
        <FormControl>
          <FormControl.Label>Workflow</FormControl.Label>
          <Select value={selectedID} onChange={(e) => selectWorkflow(e.target.value)} data-testid="attributes-workflow-select">
            <Select.Option value="">Select a workflow…</Select.Option>
            {workflows.map((w) => (
              <Select.Option key={w.ID} value={w.ID}>{w.Label}</Select.Option>
            ))}
          </Select>
        </FormControl>
      )}

      {selectedID && (
        <div className={styles.card}>
          <Stack direction="vertical" gap="condensed">
            {attrs.map((a, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput placeholder="key" value={a.Key} onChange={(e) => updateAttr(i, 'Key', e.target.value)} />
                <TextInput placeholder="label" value={a.Label} onChange={(e) => updateAttr(i, 'Label', e.target.value)} />
                <Select value={a.Type} onChange={(e) => updateAttr(i, 'Type', e.target.value)}>
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <Select.Option key={v} value={v}>{l}</Select.Option>
                  ))}
                </Select>
                <IconButton
                  icon={TrashIcon}
                  aria-label="Remove attribute"
                  size="small"
                  variant="invisible"
                  onClick={() => setAttrs((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </Stack>
            ))}
            <Button
              size="small"
              variant="invisible"
              leadingVisual={PlusIcon}
              onClick={() =>
                setAttrs((prev) => [
                  ...prev,
                  {
                    Key: '',
                    Label: '',
                    Type: ConfigFieldType.TypeText,
                    Required: false,
                    Default: '',
                    Description: '',
                    Options: null,
                    Suggestions: null,
                    Secret: false,
                    RefKind: '',
                    Multiline: false,
                    SystemManaged: false,
                  },
                ])
              }
            >
              Add attribute
            </Button>
            {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
            {saved && !error && <Text as="p" size="small">Saved.</Text>}
            <Stack direction="horizontal">
              <Button variant="primary" size="small" onClick={save} disabled={saving} data-testid="save-attributes">
                {saving ? 'Saving…' : 'Save attributes'}
              </Button>
            </Stack>
          </Stack>
        </div>
      )}
    </PageContainer>
  )
}
