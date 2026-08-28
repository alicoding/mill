import { ChevronRightIcon } from '@primer/octicons-react'
import { useTranslation } from 'react-i18next'
import { Label, Link, Stack, Text, ToggleSwitch } from '@primer/react'
import type { AtlasToolShape } from '../atlas/atlasTools'
import { useAppStore } from '../shared/store'
import { descriptionLabel, editRouteLabel, groupLabel, reachLabel, sourceLabel, versionLabel } from './extensionMeta'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// Every canvas tool is an Atlas object -- one Docs link fits every row
// (goal 0211's plugin-manager UX slice: "one link, not per-row bespoke
// URLs"), never a per-tool URL guess.
const ATLAS_CONCEPTS_DOCS_PAGE = 'concepts/atlas.md'

// ExtensionRow -- one row of Settings > Extensions, collapsed to
// icon/label/meta by default, expanding (native <details>, see
// ExtensionsSection.module.css's own header comment) into a registry-
// derived detail panel: description, meta chips, the honest reach
// line, the app's own build version, and the shared Docs link. Every
// value here is READ off the tool's own registered descriptor
// (atlas/atlasNounRegistry.ts) -- nothing here is hand-curated per
// extension.
export function ExtensionRow({ tool, builtIn, enabled, appVersion, onToggle }: {
  tool: AtlasToolShape
  builtIn: boolean
  enabled: boolean
  appVersion: string
  onToggle: (enabled: boolean) => void
}) {
  const { t } = useTranslation('views')
  const Icon = tool.icon
  const labelId = `extension-row-label-${tool.id}`
  const meta = [groupLabel(tool.group), sourceLabel(tool.content?.source), editRouteLabel(tool.content?.editRoute)]
    .filter((m): m is string => m !== null)

  return (
    <div className={styles.row} data-testid="extensions-row" data-extension-id={tool.id}>
      <details className={styles.details}>
        <summary className={styles.summary}>
          <ChevronRightIcon className={styles.chevron} size={16} />
          <Icon size={16} />
          <Stack direction="vertical" gap="none">
            <Text id={labelId} size="small" weight="semibold">{tool.label}</Text>
            {meta.length > 0 && (
              <Text size="small" className={listStyles.muted}>{meta.join(' · ')}</Text>
            )}
          </Stack>
        </summary>
        <div className={styles.expanded} data-testid="extensions-row-expanded">
          <Text as="p" size="small" data-testid="extensions-row-description">{descriptionLabel(tool)}</Text>
          {meta.length > 0 && (
            <Stack direction="horizontal" gap="condensed" className={styles.chips}>
              {meta.map((chip) => <Label key={chip}>{chip}</Label>)}
            </Stack>
          )}
          <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-row-reach">
            {reachLabel(tool.capabilities)}
          </Text>
          {appVersion && (
            <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-row-version">
              {versionLabel(appVersion)}
            </Text>
          )}
          <Link
            href="#"
            onClick={(e) => {
              e.preventDefault()
              useAppStore.getState().setView({ kind: 'docs', page: ATLAS_CONCEPTS_DOCS_PAGE })
            }}
          >
            {t('settings.extensions.docsLink')}
          </Link>
        </div>
      </details>
      <div className={styles.rowAction}>
        {builtIn ? (
          <Label data-testid="extensions-row-built-in">{t('settings.extensions.builtIn')}</Label>
        ) : (
          <ToggleSwitch
            aria-labelledby={labelId}
            checked={enabled}
            onChange={onToggle}
            size="small"
            data-testid="extensions-row-toggle"
          />
        )}
      </div>
    </div>
  )
}
