import { filterPaletteEntries, type PaletteSearchable } from './paletteFilter'
import { SETTINGS, type SettingEntry } from './settingsRegistry'

// Indexes every registry setting for search (goal 0412 S2's ground:
// shared/settingsRegistry.ts, goal 0412 S1). Ranking is the palette's
// own tiered ranking (filterPaletteEntries), never a second matcher --
// this module only builds the PaletteSearchable-shaped haystack and
// caps the result, same division of labor app/CommandPalette.tsx's own
// commandEntry/workflowEntries already keep.

export interface SettingsSearchEntry extends PaletteSearchable {
  entry: SettingEntry
  label: string
  caption?: string
  groupTitle: string
}

const MAX_RESULTS = 12

// buildSettingsSearchEntries takes `labelFor`/`groupTitleFor` as
// parameters rather than calling useTranslation() itself: its real
// caller (views/SettingsGroupNav.tsx) has a React tree and passes i18next's
// own t(); a Vitest case has none and passes a resolver reading the
// bundled English JSON directly (settingsRegistry.test.ts's own
// `resolvesInViews` shape) -- one function serves both, rather than a
// second copy of the indexing logic per caller.
export function buildSettingsSearchEntries(
  labelFor: (key: string) => string,
  groupTitleFor: (group: SettingEntry['group']) => string,
): SettingsSearchEntry[] {
  return SETTINGS.map((entry) => {
    const label = labelFor(entry.labelKey)
    const caption = entry.captionKey ? labelFor(entry.captionKey) : undefined
    const groupTitle = groupTitleFor(entry.group)
    return {
      entry,
      label,
      caption,
      groupTitle,
      searchText: `${label} ${caption ?? ''} ${entry.keywords.join(' ')}`.toLowerCase(),
      keywords: entry.keywords,
    }
  })
}

// rankSettings: an empty/whitespace query returns no results -- the
// group list is Settings' own browse view (design contract item 2,
// "from the first typed character"), unlike the palette's own
// unranked "browse everything" empty-query behavior.
export function rankSettings(entries: SettingsSearchEntry[], query: string): SettingsSearchEntry[] {
  if (!query.trim()) return []
  return filterPaletteEntries(entries, query).slice(0, MAX_RESULTS)
}
