import { useEffect, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Select, Stack, Text, TextInput } from '@primer/react'
import { PlusIcon, TrashIcon } from '@primer/octicons-react'
import { CompositionService, ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { AttributeDef, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { ConfigFieldType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import styles from '../shared/ListCard.module.css'

const TYPE_LABEL: Record<string, string> = {
  [ConfigFieldType.FieldText]: 'Text',
  [ConfigFieldType.FieldNumber]: 'Number',
  [ConfigFieldType.FieldBoolean]: 'Boolean',
}

// Configure's Attributes section (docs/SPEC.md §3.5): editing a single
// workflow's declared Attributes schema (ConfigureService.
// UpdateWorkflowAttributes, which re-validates the workflow's Decision
// edges against the new schema server-side). FieldOptions is
// deliberately excluded from the type picker -- composition.AttributeDef
// has no Options list (unlike ConfigField), so there'd be nothing to
// build a choice-set from; see ruleTranslate.ts's fieldsFromAttributes
// for the same exclusion on the read side.
export function ConfigureAttributes() {
  const [workflows, setWorkflows] = useState<Workflow[] | null>(null)
  const [selectedID, setSelectedID] = useState('')
  const [attrs, setAttrs] = useState<AttributeDef[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    CompositionService.Workflows().then((list) => setWorkflows(list ?? [])).catch(console.error)
  }, [])

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
      const updated = await ConfigureService.UpdateWorkflowAttributes(selectedID, attrs)
      setWorkflows((prev) => prev?.map((w) => (w.ID === selectedID ? updated : w)) ?? null)
      setSaved(true)
    } catch (err) {
      setError(String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.formPage} data-testid="configure-attributes">
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
              onClick={() => setAttrs((prev) => [...prev, { Key: '', Label: '', Type: ConfigFieldType.FieldText }])}
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
    </div>
  )
}
