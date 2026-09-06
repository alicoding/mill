import { useTranslation } from 'react-i18next'
import NavRail from '../shared/NavRail'
import { SETTINGS_GROUPS, type SettingsGroupID } from '../shared/settingsGroups'
import { hashForGroup } from './settingsRoute'

// The group list (goal 0321): shared/NavRail.tsx with one flat,
// heading-less group -- eight items need no sections.
export default function SettingsGroupNav({ activeId, onSelect }: {
  activeId: SettingsGroupID
  onSelect: (id: SettingsGroupID) => void
}) {
  const { t } = useTranslation('views')
  return (
    <NavRail<SettingsGroupID>
      ariaLabel={t('settings.title')}
      testId="settings-group-nav"
      activeId={activeId}
      onSelect={onSelect}
      groups={[{
        id: 'all',
        items: SETTINGS_GROUPS.map((group) => ({
          id: group.id,
          label: t(group.titleKey),
          href: hashForGroup(group.id),
          testId: `settings-group-item-${group.id}`,
        })),
      }]}
    />
  )
}
