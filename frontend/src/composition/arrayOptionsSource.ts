import { RemoteAuthService } from '../shared/bindings'

export interface SourceItem {
  id: string
  label: string
}

// Runtime enumeration hooks a TypeArray field's Items.OptionsSource can
// name (docs/goals/0372) -- the same "one mechanism, parameterized by a
// string name" shape EntityRefField's RefKind dispatch already uses,
// one level up (an array of picks instead of a single one). An
// unrecognized source name (a config field shipped ahead of its
// resolver) resolves to no options rather than throwing.
//
// Split out of ArrayOptionsField.tsx so it's directly Vitest-unit-
// testable without pulling in @primer/react's component tree -- this
// repo's toolchain has no @testing-library/react and no CSS-import
// handling for a plain Vitest run (HotkeyHint.tsx's own note).
export async function fetchOptionsSourceItems(source: string, needs: string[] | undefined, t: (key: string, opts?: Record<string, unknown>) => string): Promise<SourceItem[]> {
  switch (source) {
    case 'devices': {
      const refs = (await RemoteAuthService.ListDeviceRefs(needs && needs.length > 0 ? needs : null)) ?? []
      return refs.map((r) => ({ id: r.id, label: t('nodeInspector.deviceOptionLabel', { label: r.label, kind: t(`nodeInspector.deviceKind.${r.kind}`) }) }))
    }
    default:
      return []
  }
}

export function parseSelectedIds(value: string): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}
