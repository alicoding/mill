import { useTranslation } from 'react-i18next'
import { NavList } from '@primer/react'
import type { SettingsSection } from '../shared/settingsSections'
import styles from './SettingsToc.module.css'

interface SettingsTocProps {
  sections: SettingsSection[]
  activeId: string
  filteredOutIds: Set<string>
  onSelect: (id: string) => void
}

// The synced left rail (goal 0077): one NavList.Item per registered
// section (shared/settingsSections.ts) -- matching frontend.md's own
// "NavList fits nav-shaped, aria-current UI" rule. Clicking scrolls to
// the section (SettingsView owns the actual scroll, this only reports
// the click); the currently-visible section is marked via
// aria-current="location", ARIA's own semantic for "this link names
// where you already are within a nested navigational structure."
// Rendered only on wide viewports -- the caller (SettingsView) decides
// that, this component has no viewport awareness of its own.
export default function SettingsToc({ sections, activeId, filteredOutIds, onSelect }: SettingsTocProps) {
  const { t } = useTranslation('views')
  return (
    <nav className={styles.rail} data-testid="settings-toc" aria-label={t('settings.title')}>
      <NavList>
        {sections.map((section) => {
          const active = section.id === activeId
          const filtered = filteredOutIds.has(section.id)
          const classNames = [active ? styles.itemActive : '', filtered ? styles.itemFilteredOut : ''].filter(Boolean).join(' ')
          return (
            <NavList.Item
              key={section.id}
              href={`#settings-${section.id}`}
              aria-current={active ? 'location' : undefined}
              className={classNames || undefined}
              data-testid={`settings-toc-item-${section.id}`}
              onClick={(e) => { e.preventDefault(); onSelect(section.id) }}
            >
              {t(section.titleKey)}
            </NavList.Item>
          )
        })}
      </NavList>
    </nav>
  )
}
