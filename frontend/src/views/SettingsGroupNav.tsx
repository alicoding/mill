import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, Text, TextInput } from '@primer/react'
import { SearchIcon } from '@primer/octicons-react'
import NavRail from '../shared/NavRail'
import rail from '../shared/RailLayout.module.css'
import { SETTINGS_GROUPS, type SettingsGroupID } from '../shared/settingsGroups'
import { buildSettingsSearchEntries, rankSettings } from '../shared/settingsSearch'
import { jumpToSetting } from '../shared/settingsHighlight'
import { useUISignalStore } from '../shared/uiSignalStore'
import { hashForGroup } from './settingsRoute'

// The group list, now with search over every individual setting (goal
// 0412 S2): shared/NavRail.tsx's own header/empty slots -- the SAME
// "TextInput header + ActionList in the empty slot" shape
// configure/ConfigureKindNav.tsx already established for its own
// filter box, adopted rather than re-invented. Configure's filter
// narrows the SAME NavRailItem list (a group-level match); a setting
// is finer-grained than a group (a caption + its owning group's
// breadcrumb, which NavRailItem has no room for), so a query REPLACES
// the group list with its own ActionList rather than narrowing it in
// place -- the goal's own "Divergences from the obvious": Settings is
// a tree of panes (the iOS/Android/Ventura shape), not a single
// filtered page (VS Code's).
export default function SettingsGroupNav({ activeId, onSelect }: {
  activeId: SettingsGroupID
  onSelect: (id: SettingsGroupID) => void
}) {
  const { t } = useTranslation('views')
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // ⌘F while Settings is the active view (shared/settingsCommands.ts's
  // settings.search, surface-scoped to 'settings'): a monotonic
  // counter the command's own run() bumps, since the module-scope
  // registry has no direct reference to this mounted input.
  const focusRequest = useUISignalStore((s) => s.settingsSearchFocusRequest)
  const seenFocusRequest = useRef(focusRequest)
  useEffect(() => {
    if (focusRequest === seenFocusRequest.current) return
    seenFocusRequest.current = focusRequest
    inputRef.current?.focus()
  }, [focusRequest])

  const entries = useMemo(
    () => buildSettingsSearchEntries(
      (key) => t(key),
      (group) => t(SETTINGS_GROUPS.find((g) => g.id === group)?.titleKey ?? 'settings.title'),
    ),
    [t],
  )
  const trimmed = query.trim()
  const results = useMemo(() => rankSettings(entries, trimmed), [entries, trimmed])

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setQuery('')
      setActiveIndex(0)
      return
    }
    if (!trimmed) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const target = results[activeIndex]
      if (target) jumpToSetting(target.entry.id)
    }
  }

  return (
    <NavRail<SettingsGroupID>
      ariaLabel={t('settings.title')}
      testId="settings-group-nav"
      activeId={activeId}
      onSelect={onSelect}
      groups={trimmed ? [] : [{
        id: 'all',
        items: SETTINGS_GROUPS.map((group) => ({
          id: group.id,
          label: t(group.titleKey),
          href: hashForGroup(group.id),
          testId: `settings-group-item-${group.id}`,
        })),
      }]}
      header={(
        <TextInput
          ref={inputRef}
          block
          size="small"
          leadingVisual={SearchIcon}
          aria-label={t('settings.search.placeholder')}
          placeholder={t('settings.search.placeholder')}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveIndex(0) }}
          onKeyDown={onInputKeyDown}
          data-testid="settings-search-input"
        />
      )}
      empty={trimmed ? (
        results.length > 0 ? (
          // disableFocusZone: the TextInput keeps DOM focus throughout
          // browsing (its own onKeyDown drives ↑/↓/Enter, the same
          // AtlasJumpDialog.tsx shape) -- ActionList's own roving-
          // tabindex focus zone (@primer/behaviors' useFocusZone) is
          // therefore never needed for navigation, and left enabled it
          // fights jumpToSetting's own .focus() call on the target
          // pane's row: its MutationObserver reasserts a tracked
          // focusable element inside THIS list within a render or two,
          // bouncing focus back out of the row it was just given.
          <ActionList selectionVariant="single" disableFocusZone data-testid="settings-search-results">
            {results.map((r, i) => (
              <ActionList.Item
                key={r.entry.id}
                active={i === activeIndex}
                onSelect={() => jumpToSetting(r.entry.id)}
                data-testid="settings-search-result"
                data-setting-search-id={r.entry.id}
              >
                {r.label}
                {r.caption && <ActionList.Description variant="block">{r.caption}</ActionList.Description>}
                <ActionList.TrailingVisual>{r.groupTitle}</ActionList.TrailingVisual>
              </ActionList.Item>
            ))}
          </ActionList>
        ) : (
          <Text as="p" size="small" className={rail.railEmpty} data-testid="settings-search-empty">
            {t('settings.search.noMatches', { query: trimmed })}
          </Text>
        )
      ) : undefined}
    />
  )
}
