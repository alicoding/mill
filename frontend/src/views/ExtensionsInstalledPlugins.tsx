import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Label, Pagination, Stack, Text } from '@primer/react'
import { AlertIcon, PlugIcon } from '@primer/octicons-react'
import { PluginService } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc'
import type { PluginInfo } from '../../bindings/github.com/alicoding/mill/internal/services/pluginsvc/models'
import { SettingsService } from '../shared/bindings'
import { pluginLoadStates, pluginsAwaitingReview } from '../plugins/loader'
import { ExamplesSection } from '../shared/ExamplesSection'
import { ExtensionRow } from './ExtensionRow'
import { ExtensionsLinkPasteControl } from './ExtensionsLinkPasteControl'
import { ExtensionsTrustBar } from './ExtensionsTrustBar'
import { ExtensionRowMenu } from './ExtensionRowMenu'
import { ExtensionsKindChips } from './ExtensionsKindChips'
import { hasCanvasHostGrant, tierLabelKey, tierVariant } from './extensionTrust'
import { refreshDisabledExtensions, useExtensionEnablementStore } from '../shared/extensionEnablementStore'
import { LIST_PAGE_SIZE, clampPage, listCountLabel, pageCountFor, pageItems } from '../shared/listStandard'
import { useListState } from '../shared/useListState'
import { ListToolbar } from '../shared/ListToolbar'
import { groupOrder, type InventoryItemGroup } from '../shared/inventoryItem'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'
import { background } from '../shared/background'

// The Installed half of Settings > Extensions (goal 0321, re-shaped
// goal 0249's section, put on the one list standard by goal 0337 S2):
// every folder in the plugins directory as ONE row apiece, in the SAME
// row component the built-in tools list uses -- the two lists used to
// be differently-shaped blocks on one page, which is what made the
// section read as two features rather than one inventory. What each
// plugin contributes, what it can reach, and why it is not running now
// live in the detail pane a row opens.
//
// PluginInfo.Builtin (pluginservice_builtin.go) splits this SAME
// PluginService.ListPlugins() response into two groups the standard
// already has a shape for: a plugin the user installed is an "own"
// item, one embedded in the binary (mill-drawing) is an "example" --
// the standard's own Built-in disclosure section, never paginated, no
// sort menu since a manifest carries no timestamp to sort by.
//
// The install story stays here, beside the list it explains: the
// folder is one click away, and a fresh install takes effect on
// reload (plugins load at app start).

// A plugin the user cannot simply switch on from the row -- policy or
// a pending review answers first, in the detail pane.
function rowControl(status: string | undefined, error: string | undefined): 'switch' | 'none' {
  if (error) return 'none'
  if (status === 'policy' || status === 'blocked' || status === 'unallowed' || status === 'changed' || status === 'unsigned') return 'none'
  return 'switch'
}

// needsReview mirrors plugins/loader.ts's own pluginsAwaitingReview
// state set ('unallowed' folds in 'widened', pluginTrust.ts's own
// fold) -- the row pill, the pinned group and the shared count can
// never disagree about which rows these are (goal 0420).
function needsReview(status: string | undefined): boolean {
  return status === 'unallowed' || status === 'changed'
}

// The pinned group groupOrder ranks first (goal 0420): this view keeps
// its own bespoke ExtensionRow rendering (never InventoryList's), but
// the GROUPING is the same shared/inventoryItem.ts primitive Secrets'
// merged list already orders by -- never a hand-rolled reimplementation
// of what that primitive already does. Its icon is never rendered here
// (no InventoryList group header uses it); attention colors so a
// future InventoryList-rendered consumer inherits the right cue.
const NEEDS_REVIEW_GROUP_ICON = { Icon: AlertIcon, bg: 'var(--bgColor-attention-muted)', fg: 'var(--fgColor-attention)' }
function needsReviewGroup(label: string): InventoryItemGroup {
  return { key: 'needs-review', label, icon: NEEDS_REVIEW_GROUP_ICON, pinned: true }
}

export function ExtensionsInstalledPlugins({ plugins, allowedIds, selectedId, onSelect }: {
  plugins: PluginInfo[] | null
  allowedIds: string[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation('views')
  const { t: tc } = useTranslation('common')
  const disabledIds = useExtensionEnablementStore((s) => s.disabledExtensionIds)
  const states = pluginLoadStates()
  const [query, setQuery] = useState('')
  const [kinds, setKinds] = useState<string[]>([])
  const { state, setPage, resetPage, setExamplesExpanded } = useListState('extensions-installed')

  const toggle = (id: string, enabled: boolean) => {
    void background(SettingsService.SetExtensionEnabled(id, enabled).then(refreshDisabledExtensions), 'extensionsInstalledPlugins.setExtensionEnabled')
  }
  const openFolder = () => {
    void background(PluginService.RevealPluginsDir(), 'extensionsInstalledPlugins.revealPluginsDir')
  }

  const own = (plugins ?? []).filter((p) => !p.Builtin)
  const builtIns = (plugins ?? []).filter((p) => p.Builtin)
  const q = query.trim().toLowerCase()
  const contributedKinds = (p: PluginInfo): string[] =>
    Object.entries((p.Manifest.contributes ?? {}) as unknown as Record<string, unknown>)
      .filter(([, value]) => Array.isArray(value) && value.length > 0)
      .map(([key]) => key)
  const matches = (p: PluginInfo) => {
    const text = q === '' || (p.Manifest.name || p.Manifest.id).toLowerCase().includes(q) || (p.Manifest.description ?? '').toLowerCase().includes(q)
    const kind = kinds.length === 0 || kinds.some((k) => contributedKinds(p).includes(k))
    return text && kind
  }
  const reviewCount = pluginsAwaitingReview()
  const effectiveStatus = (plugin: PluginInfo): string | undefined => {
    const runtime = states.get(plugin.Manifest.id)?.status
    if (runtime) return runtime
    if (plugin.ThemeImport && !allowedIds.includes(plugin.Manifest.id)) return 'unallowed'
    return undefined
  }
  const visibleReviewCount = own.filter((plugin) => needsReview(effectiveStatus(plugin))).length
  const totalReviewCount = Math.max(reviewCount, visibleReviewCount)
  const reviewGroup = needsReviewGroup(t('settings.extensions.needsReviewGroup', { count: totalReviewCount }))
  // The "Needs review" group is pinned first (goal 0420, Decision 2) --
  // groupOrder's own pinned-group ordering, ahead of pagination, so the
  // group -- and its header -- lands on page 1 rather than wherever a
  // plugin's scan order happened to put it.
  const ownFiltered = groupOrder(
    own.filter(matches).map((plugin) => ({
      plugin,
      group: needsReview(effectiveStatus(plugin)) ? reviewGroup : undefined,
    })),
  ).map((g) => g.plugin)
  const builtInFiltered = builtIns.filter(matches)

  const pageCount = pageCountFor(ownFiltered.length)
  const page = clampPage(state.page, pageCount)
  const ownPage = pageItems(ownFiltered, page)
  const reviewPage = ownPage.filter((p) => needsReview(effectiveStatus(p)))
  const restPage = ownPage.filter((p) => !needsReview(effectiveStatus(p)))
  const firstOnPage = (page - 1) * LIST_PAGE_SIZE + 1
  // The count is the user's OWN plugins -- the Built-in section carries
  // its own number in its own heading (goal 0337).
  const count = own.length === 0 ? undefined : listCountLabel({
    total: own.length,
    shown: ownFiltered.length,
    ...(pageCount > 1 ? { from: firstOnPage, to: firstOnPage + ownPage.length - 1 } : {}),
  })

  // Collapsed once the user has installed anything, expanded on a
  // fresh install where the built-ins are all there is to see -- and
  // always expanded while a live query matches one, so a search can
  // never appear to have found nothing.
  const expanded = state.examplesExpanded ?? own.length === 0
  const showBuiltIns = expanded || (q !== '' && builtInFiltered.length > 0)

  const changeQuery = (next: string) => {
    setQuery(next)
    resetPage()
  }

  const rowFor = (p: PluginInfo) => {
    const id = p.Manifest.id
    const name = p.Manifest.name || id
    const runtime = states.get(id)
    const status = effectiveStatus(p)
    const error = p.Error || (runtime?.status === 'error' ? runtime.error : '')
    const badgeKey = tierLabelKey(p.Tier ?? '')
    const policyBlocked = status === 'policy'
    const canvasHost = hasCanvasHostGrant(p)
    const waitsFor = runtime?.status === 'waits' ? runtime.waitsFor : undefined
    // A blocked row's trailing cluster is already the widest the list
    // carries (the policy label replaces the toggle); repeating the
    // author and version alongside it overflows onto the name in the
    // narrow split view. The detail pane and the Verification tab carry
    // the full identity, so the row keeps name, tier and policy state.
    const showOrigin = !policyBlocked
    return (
      <li key={id} data-testid="extensions-plugin-row" data-plugin-id={id}>
        <ExtensionRow
          id={id}
          icon={PlugIcon}
          name={name}
          description={p.Manifest.description}
          meta={(
            <>
              {showOrigin && p.Manifest.author && <Text size="small" className={listStyles.muted}>{p.Manifest.author}</Text>}
              {showOrigin && p.Manifest.version && <Text size="small" className={listStyles.muted}>{t('extensions.versionLabel', { version: p.Manifest.version })}</Text>}
              {badgeKey && <Label variant={tierVariant(p.Tier ?? '')} data-testid="extensions-row-tier">{t(badgeKey)}</Label>}
              {canvasHost && <Label data-testid="extensions-row-canvas-host">{t('settings.extensions.canvasHostLabel')}</Label>}
              {policyBlocked && (
                <Label variant="attention" data-testid="extensions-row-policy">{t('extensions.policy.blockedStatus')}</Label>
              )}
              {waitsFor && <Label data-testid="extensions-row-waits">{t('settings.extensions.pluginWaitsLabel', { id: waitsFor })}</Label>}
              {needsReview(status) && <Label variant="attention" data-testid="extensions-row-needs-review">{t('settings.extensions.needsReviewPill')}</Label>}
            </>
          )}
          actions={p.Builtin ? undefined : <ExtensionRowMenu id={id} name={name} />}
          control={rowControl(status, error)}
          enabled={!disabledIds.includes(id)}
          selected={selectedId === id}
          builtInLabel={t('settings.extensions.pluginBuiltIn')}
          toggleTestId="extensions-plugin-toggle"
          onSelect={() => onSelect(id)}
          onToggle={(enabled) => toggle(id, enabled)}
        />
      </li>
    )
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="extensions-installed-plugins">
      <Stack direction="horizontal" justify="space-between" align="center" gap="condensed">
        <Text as="h3" size="small" weight="semibold" className={listStyles.muted}>
          {t('settings.extensions.installedTitle')}
        </Text>
        <Stack direction="horizontal" gap="condensed">
          <Button size="small" onClick={openFolder} data-testid="extensions-open-plugins-folder">
            {t('settings.extensions.openPluginsFolder')}
          </Button>
          <Button size="small" onClick={() => window.location.reload()} data-testid="extensions-reload">
            {t('settings.extensions.reload')}
          </Button>
        </Stack>
      </Stack>
      <Text as="p" size="small" className={listStyles.muted}>
        {t('settings.extensions.installHint')}
      </Text>
      <ExtensionsTrustBar />
      {plugins !== null && <ExtensionsLinkPasteControl plugins={plugins} disabledIds={disabledIds} />}
      {plugins !== null && plugins.length === 0 && (
        <Text size="small" className={listStyles.muted} data-testid="extensions-no-plugins">
          {t('settings.extensions.noPlugins')}
        </Text>
      )}
      {plugins !== null && plugins.length > 0 && (
        <>
          <ListToolbar
            query={query}
            onQueryChange={changeQuery}
            searchAriaLabel={t('settings.extensions.installedTitle')}
            count={count}
          />
          <ExtensionsKindChips selected={kinds} onChange={(next) => { setKinds(next); resetPage() }} />
          {ownFiltered.length === 0 && builtInFiltered.length === 0 ? (
            <Text as="p" size="small" className={listStyles.muted}>{tc('inventoryList.noMatchesFor', { query })}</Text>
          ) : (
            <>
              {reviewPage.length > 0 && (
                <Stack direction="vertical" gap="none" data-testid="extensions-needs-review-group">
                  <Text as="h4" size="small" className={listStyles.muted}>
                    {t('settings.extensions.needsReviewGroup', { count: totalReviewCount })}
                  </Text>
                  <ul className={styles.rows} aria-label={t('settings.extensions.needsReviewGroup', { count: totalReviewCount })}>
                    {reviewPage.map(rowFor)}
                  </ul>
                </Stack>
              )}
              {restPage.length > 0 && (
                <ul className={styles.rows} aria-label={t('settings.extensions.installedTitle')}>
                  {restPage.map(rowFor)}
                </ul>
              )}
              {pageCount > 1 && (
                <Pagination
                  pageCount={pageCount}
                  currentPage={page}
                  showPages
                  onPageChange={(e, n) => {
                    // Primer's page controls are anchors with a default
                    // '#' href -- without this the click also navigates.
                    e.preventDefault()
                    setPage(n)
                  }}
                />
              )}
              <ExamplesSection
                count={builtInFiltered.length}
                expanded={showBuiltIns}
                onToggle={setExamplesExpanded}
                heading={t('settings.extensions.builtInCount', { count: builtInFiltered.length })}
                showLabel={t('settings.extensions.showBuiltIn')}
                hideLabel={t('settings.extensions.hideBuiltIn')}
                testId="extensions-built-in-plugins"
                toggleTestId="extensions-built-in-toggle"
              >
                <ul className={styles.rows} aria-label={t('settings.extensions.builtInCount', { count: builtInFiltered.length })}>
                  {builtInFiltered.map(rowFor)}
                </ul>
              </ExamplesSection>
            </>
          )}
        </>
      )}
    </Stack>
  )
}
