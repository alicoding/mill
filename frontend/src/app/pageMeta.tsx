import type { ReactNode } from 'react'
import type { View } from '../shared/store'
import { CAPABILITY_ICON } from './navIcon'

// The titlebar band's page-tab identity (label + section glyph) --
// extracted from App.tsx along this natural seam when the icon-anatomy
// tabs pushed it over the 500-line limit (.claude/rules/architecture.md).
// Pure view→presentation mapping, no state.

// The strip's first tab names the current sidebar section -- the "go
// back to the page under the tabs" affordance.
export function pageLabelFor(view: View, capabilities: { ID: string; Label: string; NavLabel: string }[], t: (key: string) => string): string {
  switch (view.kind) {
    case 'home': return t('pageMeta.home')
    case 'composition': return t('pageMeta.workflows')
    case 'configure': return t('pageMeta.configure')
    case 'activity': return t('pageMeta.activity')
    case 'review': return t('pageMeta.review')
    case 'settings': return t('pageMeta.settings')
    case 'placeholder': {
      const cap = capabilities.find((c) => c.ID === view.capabilityId)
      return cap ? (cap.NavLabel || cap.Label) : t('pageMeta.overview')
    }
  }
}

// The page tab's leading icon -- same glyph the sidebar nav uses for
// that section (CAPABILITY_ICON), so the band's first tab matches the
// selected nav item's silhouette. Settings/placeholder views have no
// capability icon; the tab simply shows no glyph there.
export function pageIconFor(view: View): ReactNode {
  const key = view.kind === 'home' ? 'capability-home'
    : view.kind === 'composition' ? 'capability-composition'
    : view.kind === 'configure' ? 'capability-configure'
    : view.kind === 'activity' ? 'activity-log'
    : view.kind === 'review' ? 'capability-review'
    : null
  const PageIcon = key ? CAPABILITY_ICON[key] : undefined
  if (!PageIcon) return undefined
  return (
    <span data-testid="tab-icon" style={{ display: 'inline-flex', color: 'var(--fgColor-muted)' }}>
      <PageIcon size={14} />
    </span>
  )
}
