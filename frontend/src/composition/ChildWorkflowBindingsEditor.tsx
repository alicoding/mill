import { useEffect, useState } from 'react'
import { Stack, Text } from '@primer/react'
import { CompositionService } from '../shared/bindings'
import type { AttributeDef, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { LiteralOrAttributeField } from '../shared/LiteralOrAttributeField'

// ADR-0010: once a child-workflow node's workflowId points at a real
// workflow, this renders one binding row per the *child's own* declared
// Attributes -- the parent's ctx.Attributes (via `attrs`, the owning
// workflow's schema) are what each row's literal-or-attribute picker
// offers, matching IntegrationBindingsEditor's identical shape (shared
// LiteralOrAttributeField, ADR-0007 Phase 3). Renders nothing if the
// target workflow has no declared Attributes -- nothing to bind.
function parseJSON(raw: string): Record<string, string> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

export function ChildWorkflowBindingsEditor({
  workflowId, attrs, inputBindingsRaw, onChangeInputBindings,
}: {
  workflowId: string
  attrs: AttributeDef[]
  inputBindingsRaw: string
  onChangeInputBindings: (raw: string) => void
}) {
  const [target, setTarget] = useState<Workflow | null | 'none'>(null)

  useEffect(() => {
    if (!workflowId) {
      setTarget('none')
      return
    }
    CompositionService.Workflows()
      .then((list) => setTarget((list ?? []).find((w) => w.ID === workflowId) ?? 'none'))
      .catch(() => setTarget('none'))
  }, [workflowId])

  if (target === null || target === 'none') return null
  const childAttrs = target.Attributes ?? []
  if (childAttrs.length === 0) return null

  const bindings = parseJSON(inputBindingsRaw)
  const setBinding = (key: string, value: string) => {
    onChangeInputBindings(JSON.stringify({ ...bindings, [key]: value }))
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="child-workflow-bindings-editor">
      <Text size="small" weight="semibold">Child workflow input</Text>
      {childAttrs.map((attr) => (
        <LiteralOrAttributeField
          key={attr.Key}
          name={attr.Label || attr.Key}
          value={bindings[attr.Key] ?? ''}
          attrs={attrs}
          onChange={(value) => setBinding(attr.Key, value)}
        />
      ))}
    </Stack>
  )
}
