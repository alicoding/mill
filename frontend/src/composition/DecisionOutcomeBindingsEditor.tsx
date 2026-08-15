import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FormControl, Select, Stack, Text } from '@primer/react'
import { ConfigureService } from '../shared/bindings'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import type { Decision } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import { LiteralOrAttributeField } from '../shared/LiteralOrAttributeField'

// docs/adr/0027: once a decision-outcome node's decisionId points at a
// real Decision, this renders one binding row per that Decision's own
// declared Outputs -- the owning workflow's Attributes (`attrs`) are
// what each row's literal-or-attribute picker offers, same shape as
// ChildWorkflowBindingsEditor.tsx (shared LiteralOrAttributeField).
// Renders nothing if the referenced Decision has no declared outputs --
// nothing to bind (e.g. the seeded "Manual review (example)" only has
// one field, still renders one row).
function parseJSON(raw: string): Record<string, string> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

export function DecisionOutcomeBindingsEditor({
  decisionId, attrs, outputBindingsRaw, onChangeOutputBindings, version, onChangeVersion,
}: {
  decisionId: string
  attrs: AttributeDef[]
  outputBindingsRaw: string
  onChangeOutputBindings: (raw: string) => void
  // version/onChangeVersion back the node's own "version" ConfigField
  // (docs/adr/0040 decisions 4-5) -- rendered here as a picker (Live +
  // one option per published snapshot) instead of the generic free-text
  // field NodeConfigFields would otherwise show, since the valid values
  // are a closed, known set once a Decision is selected.
  version: string
  onChangeVersion: (version: string) => void
}) {
  const { t } = useTranslation('composition')
  const [target, setTarget] = useState<Decision | null | 'none'>(null)

  useEffect(() => {
    if (!decisionId) {
      setTarget('none')
      return
    }
    ConfigureService.Decisions()
      .then((list) => setTarget((list ?? []).find((d) => d.ID === decisionId) ?? 'none'))
      .catch(() => setTarget('none'))
  }, [decisionId])

  if (target === null || target === 'none') return null
  const versions = [...(target.Versions ?? [])].sort((a, b) => b.Version - a.Version)

  const bindings = parseJSON(outputBindingsRaw)
  // docs/adr/0040 decision 2: a Deprecated field stays offered here only
  // while an existing binding already points at it (never dropping bound
  // data); a fresh Decision (nothing bound yet) never offers it as a NEW
  // binding target.
  const outputs = (target.Outputs ?? []).filter((field) => !field.deprecated || bindings[field.Key])

  const setBinding = (key: string, value: string) => {
    onChangeOutputBindings(JSON.stringify({ ...bindings, [key]: value }))
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="decision-outcome-bindings-editor">
      {versions.length > 0 && (
        <FormControl>
          <FormControl.Label>{t('decisionOutcomeBindingsEditor.versionLabel')}</FormControl.Label>
          <FormControl.Caption>{t('decisionOutcomeBindingsEditor.versionCaption')}</FormControl.Caption>
          <Select
            value={version}
            data-testid="decision-outcome-version"
            onChange={(e) => onChangeVersion(e.target.value)}
          >
            <Select.Option value="">{t('decisionOutcomeBindingsEditor.versionLive')}</Select.Option>
            {versions.map((v) => (
              <Select.Option key={v.Version} value={String(v.Version)}>
                {t('workflowVersionsPanel.versionPrefix', { version: v.Version })}
              </Select.Option>
            ))}
          </Select>
        </FormControl>
      )}
      {outputs.length > 0 && (
        <>
          <Text size="small" weight="semibold">{t('decisionOutcomeBindingsEditor.heading')}</Text>
          <Text size="small" as="p">
            {t('decisionOutcomeBindingsEditor.description', { label: target.Label, category: target.Category })}
          </Text>
          {outputs.map((field) => (
            <LiteralOrAttributeField
              key={field.Key}
              name={field.deprecated ? t('decisionOutcomeBindingsEditor.deprecatedFieldName', { name: field.Label || field.Key }) : (field.Label || field.Key)}
              badge={field.Type}
              value={bindings[field.Key] ?? ''}
              attrs={attrs}
              onChange={(value) => setBinding(field.Key, value)}
            />
          ))}
        </>
      )}
    </Stack>
  )
}
