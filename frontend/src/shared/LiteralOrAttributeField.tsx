import { FormControl, Label, Select, Stack, TextInput } from '@primer/react'
import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// Shared by IntegrationBindingsEditor.tsx (ADR-0007 Phase 3) and
// ChildWorkflowBindingsEditor.tsx (ADR-0010) -- both bind a declared
// field to either a literal value or an "attr:<name>" reference into
// the running Attributes bag, the identical control either way.
const LITERAL = '__literal__'

function attrRef(key: string) {
  return `attr:${key}`
}

export function LiteralOrAttributeField({
  name, badge, required, value, attrs, onChange,
}: {
  name: string
  badge?: string
  // Appends a small accent "required" badge next to the label --
  // MCPToolArgsEditor.tsx's own use (a tool's inputSchema.required),
  // distinct from `badge` (a field's "In" placement in
  // IntegrationBindingsEditor's use) so both can appear together.
  required?: boolean
  value: string
  attrs: AttributeDef[]
  onChange: (value: string) => void
}) {
  const isAttr = value.startsWith('attr:')
  return (
    <FormControl key={name}>
      <FormControl.Label>
        {name} {badge && <Label size="small" variant="secondary">{badge}</Label>}
        {required && <Label size="small" variant="accent">required</Label>}
      </FormControl.Label>
      <Stack direction="horizontal" gap="condensed">
        <Select
          aria-label={`${name} source`}
          value={isAttr ? value : LITERAL}
          onChange={(e) => onChange(e.target.value === LITERAL ? '' : e.target.value)}
        >
          <Select.Option value={LITERAL}>Literal value</Select.Option>
          {attrs.map((a) => (
            <Select.Option key={a.Key} value={attrRef(a.Key)}>Attribute: {a.Label}</Select.Option>
          ))}
        </Select>
        {!isAttr && (
          <TextInput
            aria-label={`${name} literal value`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </Stack>
    </FormControl>
  )
}
