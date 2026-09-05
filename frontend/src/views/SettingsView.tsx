import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Heading } from '@primer/react'
import { useIsNarrowViewport } from '../shared/useNarrowViewport'
import { SETTINGS_GROUPS, resolveSettingsGroup, type SettingsGroupID } from '../shared/settingsGroups'
import AppearanceSection from './AppearanceSection'
import SettingsGeneralPane from './SettingsGeneralPane'
import SettingsShortcutsPane from './SettingsShortcutsPane'
import SettingsConnectionsPane from './SettingsConnectionsPane'
import SettingsNotificationsPane from './SettingsNotificationsPane'
import DataStewardshipSection from './DataStewardshipSection'
import UpdatesSection from './UpdatesSection'
import SettingsGroupNav from './SettingsGroupNav'
import { clearSettingsHash, groupFromHash, readLastSettingsGroup, rememberSettingsGroup, writeSettingsHash } from './settingsRoute'
import styles from './SettingsView.module.css'
import PageContainer from '../shared/PageContainer'

// A dedicated Settings page, reached via the sidebar's own bottom-
// anchored footer icon (App.tsx) rather than a NavList entry alongside
// the capability rows -- the app-level-config-is-not-a-destination
// pattern, matching docs/SPEC.md §3.5's "Sidebar restructuring" bullet.
//
// EIGHT GROUPS, ONE PANE AT A TIME (goal 0321). The page was one 960px
// scroll of eleven sections with a synced table-of-contents rail and a
// filter box; at this many settings the converged desktop shape is a
// group list beside a single pane, routed. The rail is now the group
// list (SettingsGroupNav), the route is `#/settings/<group>`
// (settingsRoute.ts), and the filter box is gone -- with one pane
// showing at a time there is nothing on screen for a filter to narrow.
//
// The pane a user was last reading is remembered per device, and an
// incoming deep link (a palette `settings.open.<group>` command, an
// in-app "configure this" link, a reloaded `#/settings/<group>` URL)
// wins over it for that visit.
function SettingsView({ initialSection }: { initialSection?: string } = {}) {
  // 'views' is the default namespace (settings.* keys); 'common:'
  // prefix reaches the shared common.json namespace explicitly.
  const { t } = useTranslation('views')
  const isNarrowViewport = useIsNarrowViewport()

  const [group, setGroup] = useState<SettingsGroupID>(() => {
    if (initialSection) return resolveSettingsGroup(initialSection)
    return groupFromHash(window.location.hash) ?? readLastSettingsGroup()
  })

  // A second deep-link arrival while already on Settings (the palette
  // run again, an in-app link from another view) lands on its group.
  useEffect(() => {
    if (initialSection) setGroup(resolveSettingsGroup(initialSection))
  }, [initialSection])

  // The route follows the pane, never the reverse: replaceState so the
  // back gesture leaves Settings rather than walking its eight panes,
  // and the hash is cleared on unmount so navigating to Atlas doesn't
  // leave a stale Settings address behind.
  useEffect(() => {
    writeSettingsHash(group)
    rememberSettingsGroup(group)
  }, [group])
  useEffect(() => clearSettingsHash, [])

  const select = useCallback((next: SettingsGroupID) => setGroup(next), [])

  const PANES: Record<SettingsGroupID, ReactNode> = {
    general: <SettingsGeneralPane />,
    appearance: <AppearanceSection />,
    shortcuts: <SettingsShortcutsPane />,
    connections: <SettingsConnectionsPane />,
    notifications: <SettingsNotificationsPane />,
    backups: <DataStewardshipSection />,
    updates: <UpdatesSection />,
  }
  const title = t(SETTINGS_GROUPS.find((g) => g.id === group)?.titleKey ?? 'settings.title')

  return (
    <PageContainer variant="narrow" data-testid="settings-view">
      <div className={isNarrowViewport ? styles.layoutNarrow : styles.layout}>
        <SettingsGroupNav activeId={group} onSelect={select} />
        <div
          className={styles.pane}
          data-testid={`settings-pane-${group}`}
        >
          <Heading as="h1" variant="medium" className={styles.paneTitle}>{title}</Heading>
          {PANES[group]}
        </div>
      </div>
    </PageContainer>
  )
}

export default SettingsView
