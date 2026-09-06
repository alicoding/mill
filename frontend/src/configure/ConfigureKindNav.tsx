import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Text, TextInput } from '@primer/react'
import { SearchIcon } from '@primer/octicons-react'
import NavRail from '../shared/NavRail'
import rail from '../shared/RailLayout.module.css'
import {
  CONFIGURE_KINDS,
  filterConfigureKinds,
  groupConfigureKinds,
  type ConfigureKind,
  type ConfigureKindID,
} from '../shared/configureKinds'
import { hashForKind } from './configureRoute'

// The kind list (goal 0116): shared/NavRail.tsx over the kind registry,
// one titled group per registry group, and a filter box above it that
// narrows item labels across every group. The filter is local state:
// it is a way of finding a row, not a place, so it is neither routed
// nor remembered.
export default function ConfigureKindNav({ activeId, onSelect }: {
  activeId: ConfigureKindID
  onSelect: (id: ConfigureKindID) => void
}) {
  const { t } = useTranslation('configure')
  const [query, setQuery] = useState('')
  const label = (kind: ConfigureKind) => t(kind.labelKey)
  const groups = groupConfigureKinds(filterConfigureKinds(CONFIGURE_KINDS, query, label)).map(({ group, kinds }) => ({
    id: group.id,
    title: t(group.titleKey),
    caption: group.captionKey ? t(group.captionKey) : undefined,
    items: kinds.map((kind) => ({
      id: kind.id as ConfigureKindID,
      label: label(kind),
      href: hashForKind(kind.id as ConfigureKindID),
      testId: `configure-kind-item-${kind.id}`,
      icon: kind.icon,
    })),
  }))
  return (
    <NavRail<ConfigureKindID>
      ariaLabel={t('configureView.ariaLabel')}
      testId="configure-kind-nav"
      activeId={activeId}
      onSelect={onSelect}
      groups={groups}
      header={(
        <TextInput
          block
          size="small"
          leadingVisual={SearchIcon}
          aria-label={t('configureView.filterPlaceholder')}
          placeholder={t('configureView.filterPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="configure-kind-filter"
        />
      )}
      empty={<Text as="p" size="small" className={rail.railEmpty} data-testid="configure-kind-empty">{t('configureView.noMatch')}</Text>}
    />
  )
}
