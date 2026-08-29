import { ChevronRightIcon } from '@primer/octicons-react'
import { useTranslation } from 'react-i18next'
import { Label, Link, Stack, Text, ToggleSwitch } from '@primer/react'
import { useAppStore } from '../shared/store'
import { descriptionLabel, editRouteLabel, groupLabel, reachLabel, sourceLabel, versionLabel, type ExtensionRowSource } from './extensionMeta'
import listStyles from '../shared/ListCard.module.css'
import styles from './ExtensionsSection.module.css'

// Every canvas tool is an Atlas object -- one Docs link fits every row
// (goal 0211's plugin-manager UX slice: "one link, not per-row bespoke
// URLs"), never a per-tool URL guess.
const ATLAS_CONCEPTS_DOCS_PAGE = 'concepts/atlas.md'

// ExtensionRow -- one row of Settings > Extensions, collapsed to
// icon/noun-title/meta by default, expanding (native <details>, see
// ExtensionsSection.module.css's own header comment) into a registry-
// derived detail panel: description, meta chips (including the group,
// dropped from the collapsed meta line since the section heading above
// already states it once), an optional disable-scope note, the honest
// reach line, the app's own build version, and the shared Docs link.
// The row's own title is the noun (`row.label`, sourced from nounName
// for a tray tool -- goal 0237 S3's review rider), never the command
// verb phrase ("Add a note") that surfaces elsewhere (tray tooltips,
// the command palette). Every value here is READ off the noun's own
// registered descriptor, normalized into ExtensionRowSource by
// extensionMeta.ts's toolRowSource/toolLessRowSource -- nothing here is
// hand-curated per extension, and this component never itself branches
// on whether the row came from a tray tool or a tool-less noun.
export function ExtensionRow({ row, builtIn, enabled, appVersion, onToggle }: {
  row: ExtensionRowSource
  builtIn: boolean
  enabled: boolean
  appVersion: string
  onToggle: (enabled: boolean) => void
}) {
  const { t } = useTranslation('views')
  const Icon = row.icon
  const labelId = `extension-row-label-${row.id}`
  // The collapsed row's own meta line never repeats the group word
  // (goal 0237 S3's review rider) -- the section heading above every
  // row already says it once; source/editRoute are the only per-row
  // facts left. The expanded view's own chip list is a different
  // reading context (scanned one row at a time, the heading scrolled
  // out of view by then) and keeps the group chip.
  const summaryMeta = [sourceLabel(row.source), editRouteLabel(row.editRoute)]
    .filter((m): m is string => m !== null)
  const chips = [groupLabel(row.group), sourceLabel(row.source), editRouteLabel(row.editRoute)]
    .filter((m): m is string => m !== null)

  return (
    <div className={styles.row} data-testid="extensions-row" data-extension-id={row.id}>
      <details className={styles.details}>
        <summary className={styles.summary}>
          <ChevronRightIcon className={styles.chevron} size={16} />
          <Icon size={16} />
          <Stack direction="vertical" gap="none">
            <Text id={labelId} size="small" weight="semibold" data-testid="extensions-row-title">{row.label}</Text>
            {summaryMeta.length > 0 && (
              <Text size="small" className={listStyles.muted} data-testid="extensions-row-meta">{summaryMeta.join(' · ')}</Text>
            )}
          </Stack>
        </summary>
        <div className={styles.expanded} data-testid="extensions-row-expanded">
          <Text as="p" size="small" data-testid="extensions-row-description">{descriptionLabel(row)}</Text>
          {chips.length > 0 && (
            <Stack direction="horizontal" gap="condensed" className={styles.chips}>
              {chips.map((chip) => <Label key={chip}>{chip}</Label>)}
            </Stack>
          )}
          {row.disableScopeNote && (
            <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-row-disable-scope">
              {row.disableScopeNote}
            </Text>
          )}
          <Text as="p" size="small" className={listStyles.muted} data-testid="extensions-row-reach">
            {reachLabel(row.capabilities)}
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
            className={styles.toggle}
            data-testid="extensions-row-toggle"
          />
        )}
      </div>
    </div>
  )
}
