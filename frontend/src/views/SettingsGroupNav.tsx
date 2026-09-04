import { useTranslation } from 'react-i18next'
import { NavList } from '@primer/react'
import { SETTINGS_GROUPS, type SettingsGroupID } from '../shared/settingsGroups'
import { hashForGroup } from './settingsRoute'
import styles from './SettingsView.module.css'

// The group list (goal 0321): one NavList.Item per registered group,
// and the ONLY way to change panes. aria-current="page" rather than
// "location" -- each item now names a distinct route (#/settings/<group>)
// rather than a position within one long page.
export default function SettingsGroupNav({ activeId, onSelect }: {
  activeId: SettingsGroupID
  onSelect: (id: SettingsGroupID) => void
}) {
  const { t } = useTranslation('views')
  return (
    <nav className={styles.rail} data-testid="settings-group-nav" aria-label={t('settings.title')}>
      <NavList>
        {SETTINGS_GROUPS.map((group) => {
          const active = group.id === activeId
          return (
            <NavList.Item
              key={group.id}
              href={hashForGroup(group.id)}
              aria-current={active ? 'page' : undefined}
              className={active ? styles.railItemActive : undefined}
              data-testid={`settings-group-item-${group.id}`}
              onClick={(e) => { e.preventDefault(); onSelect(group.id) }}
            >
              {t(group.titleKey)}
            </NavList.Item>
          )
        })}
      </NavList>
    </nav>
  )
}
