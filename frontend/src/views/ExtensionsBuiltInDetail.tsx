import { useTranslation } from 'react-i18next'
import { ExtensionDetailPane, type ExtensionDetail } from './ExtensionDetailPane'
import {
  descriptionLabel,
  editRouteLabel,
  groupLabel,
  reachLabel,
  sourceLabel,
  versionLabel,
  type ExtensionRowSource,
} from './extensionMeta'

// The detail pane for a COMPILED-IN noun (goal 0321): a thin adapter
// from the registry-derived row shape onto the one detail contract.
// Every value is read off the noun's own registered descriptor --
// nothing here is hand-curated per extension.
export default function ExtensionsBuiltInDetail({ row, appVersion, showBackLink, onClose }: {
  row: ExtensionRowSource
  appVersion: string
  showBackLink: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('views')
  const adds: ExtensionDetail['adds'] = [{ kind: 'objects', items: [row.label] }]
  if (row.commandLabel) adds.unshift({ kind: 'commands', items: [row.commandLabel] })

  const detail: ExtensionDetail = {
    id: row.id,
    icon: row.icon,
    name: row.label,
    description: descriptionLabel(row),
    chips: [groupLabel(row.group), sourceLabel(row.source), editRouteLabel(row.editRoute)]
      .filter((chip): chip is string => chip !== null),
    disableScopeNote: row.disableScopeNote,
    settings: row.settings ?? [],
    adds,
    reach: reachLabel(row.capabilities),
    provenance: appVersion ? versionLabel(appVersion) : t('settings.extensions.builtIn'),
  }
  return <ExtensionDetailPane detail={detail} showBackLink={showBackLink} onClose={onClose} />
}
