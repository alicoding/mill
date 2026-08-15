import { useState } from 'react'
import { Complexity, type NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// Palette-only progressive-disclosure toggle (docs/goals/0047): the
// palette defaults to showing every step, advanced ones included --
// changing the default palette contents would surprise existing users.
// Turning this off hides ComplexityAdvanced steps for a simpler scan.
// Persisted per-browser, same localStorage-backed shape shared/
// viewMode.ts already establishes for a page's own view-mode toggle;
// kept here rather than promoted to shared/ since NodePalette.tsx (the
// only consumer) is composition/'s own file (.claude/rules/frontend.md's
// "used by 2+ bounded contexts" bar for shared/).
const SHOW_ADVANCED_STORAGE_KEY = 'mill-palette-show-advanced'

export function useShowAdvancedSteps(): [boolean, (show: boolean) => void] {
  const [show, setShow] = useState<boolean>(() => localStorage.getItem(SHOW_ADVANCED_STORAGE_KEY) !== 'false')
  const set = (next: boolean) => {
    setShow(next)
    localStorage.setItem(SHOW_ADVANCED_STORAGE_KEY, String(next))
  }
  return [show, set]
}

// Pure filter: showAdvanced=true is a no-op (every step passes
// through unchanged); false drops every ComplexityAdvanced step,
// basic and declared (always basic, composition/declaredsteptype.go)
// steps stay.
export function filterByComplexity<T extends Pick<NodeType, 'Complexity'>>(nodeTypes: T[], showAdvanced: boolean): T[] {
  if (showAdvanced) return nodeTypes
  return nodeTypes.filter((nt) => nt.Complexity !== Complexity.ComplexityAdvanced)
}
