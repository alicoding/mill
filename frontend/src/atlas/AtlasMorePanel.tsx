import { useMemo, useState } from 'react'
import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { ActionList, AnchoredOverlay, SegmentedControl, Text, TextInput } from '@primer/react'
import { SearchIcon } from '@primer/octicons-react'
import { copy } from '../shared/copy'
import { searchInputTextAssistOff } from '../shared/searchInputProps'
import { pluginDisplayName } from '../plugins/loader'
import { thirdPartyNounFor, type AtlasToolShape } from './atlasNounRegistry'
import { MORE_PANEL_CATEGORIES, matchesCategory, matchesToolQuery, type AtlasMorePanelCategory } from './atlasToolPlacement'
import styles from './AtlasCreationTray.module.css'

// Every tool Mill has, by name (goal 0355). The dock shows seven
// buttons and never grows, so this is where a tool that isn't one of
// them is found -- including every tool a plugin installed after the
// dock was designed, with no code change here: the panel reads the
// registry.
//
// Search, categories and recents are the three ways people actually
// look for a tool, in that order of use, so they are stacked in that
// order rather than hidden behind a disclosure.

const CATEGORY_LABEL_KEYS: Record<AtlasMorePanelCategory, string> = {
  all: 'morePanel.categoryAll',
  objects: 'morePanel.categoryObjects',
  media: 'morePanel.categoryMedia',
  annotate: 'morePanel.categoryAnnotate',
  embed: 'morePanel.categoryEmbed',
}

// What one row shows, resolved once per tool so the search reads the
// same words the row does -- never the locale KEY behind them.
interface ToolRow {
  tool: AtlasToolShape
  name: string
  hint: string
  // The plugin's own manifest NAME, not its id -- a row says where a
  // tool came from in the words the person installed it under.
  pluginName: string | undefined
}

function toolRow(tool: AtlasToolShape): ToolRow {
  const pluginId = thirdPartyNounFor(tool.id)?.pluginId
  return {
    tool,
    name: copy(tool.nounName),
    hint: copy(tool.description ?? tool.label),
    pluginName: pluginId ? pluginDisplayName(pluginId) : undefined,
  }
}

export function AtlasMorePanel({ open, onClose, anchorRef, tools, recentIDs, onPickTool }: {
  open: boolean
  onClose: () => void
  anchorRef: RefObject<HTMLButtonElement | null>
  tools: readonly AtlasToolShape[]
  recentIDs: readonly string[]
  onPickTool: (tool: AtlasToolShape) => void
}) {
  const { t } = useTranslation('atlas')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<AtlasMorePanelCategory>('all')

  const rows = useMemo(() => tools.map(toolRow), [tools])
  const matches = rows.filter((row) => (
    matchesCategory(row.tool, category) && matchesToolQuery({ label: row.name, nounName: row.name, pluginId: row.pluginName }, query)
  ))
  // Recents answer "the thing I just used", so they are the row a
  // person scans first -- and they stop being an answer the moment a
  // search narrows the list to something else.
  const recents = query.trim() === ''
    ? recentIDs.map((id) => rows.find((row) => row.tool.id === id)).filter((row): row is ToolRow => row !== undefined)
    : []

  const pick = (row: ToolRow) => {
    onPickTool(row.tool)
    onClose()
  }

  return (
    <AnchoredOverlay
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      renderAnchor={null}
      side="outside-top"
      // A flat list of buttons and one text field needs neither a trap
      // nor a zone, and either one nested near the dock's other
      // popovers is what broke the canvas's own Space-to-pan
      // (AtlasCreationTray.tsx's header comment).
      focusTrapSettings={{ disabled: true }}
      focusZoneSettings={{ disabled: true }}
    >
      <div className={styles.morePanel} data-testid="atlas-more-panel">
        <TextInput
          className={styles.moreSearch}
          leadingVisual={SearchIcon}
          size="small"
          block
          autoFocus
          value={query}
          aria-label={t('morePanel.searchLabel')}
          placeholder={t('morePanel.searchPlaceholder')}
          data-testid="atlas-more-search"
          onChange={(e) => setQuery(e.target.value)}
          {...searchInputTextAssistOff}
        />
        {/* Controlled for the same reason the view switcher is: without
            onChange, SegmentedControl keeps its own selected index and
            the chips would drift from the filter actually applied. */}
        <SegmentedControl
          size="small"
          aria-label={t('morePanel.categoryLabel')}
          data-testid="atlas-more-categories"
          onChange={(index) => setCategory(MORE_PANEL_CATEGORIES[index] ?? 'all')}
        >
          {MORE_PANEL_CATEGORIES.map((entry) => (
            <SegmentedControl.Button
              key={entry}
              selected={category === entry}
              data-testid={`atlas-more-category-${entry}`}
            >
              {t(CATEGORY_LABEL_KEYS[entry])}
            </SegmentedControl.Button>
          ))}
        </SegmentedControl>
        {recents.length > 0 && (
          <div className={styles.moreSection} data-testid="atlas-more-recents">
            <Text size="small" className={styles.moreHeading}>{t('morePanel.recents')}</Text>
            <div className={styles.moreRecentRow} role="group" aria-label={t('morePanel.recents')}>
              {recents.map((row) => (
                <button
                  key={row.tool.id}
                  type="button"
                  className={styles.tool}
                  data-testid={`atlas-more-recent-${row.tool.id}`}
                  title={row.hint}
                  aria-label={row.name}
                  onClick={() => pick(row)}
                >
                  <row.tool.icon size={14} />
                  {row.tool.shortcutKey && <span className={styles.kbd}>{row.tool.shortcutKey}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className={styles.moreList}>
          {matches.length === 0
            ? <Text size="small" className={styles.moreEmpty} data-testid="atlas-more-empty">{t('morePanel.empty')}</Text>
            : (
              <ActionList aria-label={t('morePanel.listLabel')}>
                {matches.map((row) => (
                  <ActionList.Item
                    key={row.tool.id}
                    data-testid={`atlas-more-tool-${row.tool.id}`}
                    onSelect={() => pick(row)}
                  >
                    <ActionList.LeadingVisual><row.tool.icon /></ActionList.LeadingVisual>
                    {row.name}
                    {row.pluginName && (
                      <ActionList.Description variant="block">
                        {t('morePanel.fromPlugin', { plugin: row.pluginName })}
                      </ActionList.Description>
                    )}
                    {row.tool.shortcutKey && (
                      <ActionList.TrailingVisual>
                        <span className={styles.kbd}>{row.tool.shortcutKey}</span>
                      </ActionList.TrailingVisual>
                    )}
                  </ActionList.Item>
                ))}
              </ActionList>
            )}
        </div>
      </div>
    </AnchoredOverlay>
  )
}
