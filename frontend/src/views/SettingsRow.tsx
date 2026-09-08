import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Text } from '@primer/react'
import { useAppStore } from '../shared/store'
import type { SettingEntry } from '../shared/settingsRegistry'
import styles from './SettingsView.module.css'

// One setting, in the converged desktop shape (goal 0321): the label
// and its single-idea caption on the left, the control on the right.
// The label is TEXT, not a <label> element -- the controls it fronts
// are a mix of native inputs, segmented controls and composite
// widgets, and only some of them have one focusable element a
// <label for> could point at. Each caller wires its own control to
// this row's `labelId` (aria-labelledby / aria-label), which the
// render prop hands it.
//
// A caption states ONE idea and stays under ~100 characters
// (.claude/rules/ux-writing.md). Where the setting needs more than
// that, `docsPage` renders a "Learn more" link to the Docs page that
// carries the rest, rather than growing the caption.
//
// `setting` is the ONLY source of the label (goal 0412 S1): a row
// with no registry entry cannot render, which is what keeps the
// registry an honest index of every setting the panes show. `caption`
// and `docsPage` stay overridable per render for the few settings
// whose text depends on live state (a toggle's current value, an env
// override in effect) -- omitted, they fall back to the entry's own
// `captionKey`/`docsPage`; passing `docsPage={false}` explicitly
// suppresses an entry's default "Learn more" link for that render.
export function SettingsRow({ setting, caption, captionTestId, docsPage, control, children }: {
  setting: SettingEntry
  caption?: string
  captionTestId?: string
  docsPage?: string | false
  control?: (labelId: string) => ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation('views')
  const labelId = useId()
  const label = t(setting.labelKey)
  const resolvedCaption = caption ?? (setting.captionKey ? t(setting.captionKey) : undefined)
  const resolvedDocsPage = docsPage === false ? undefined : (docsPage ?? setting.docsPage)
  return (
    <div className={styles.row} data-testid="settings-row" data-setting-id={setting.id}>
      <div className={styles.rowText}>
        <Text id={labelId} className={styles.rowLabel}>{label}</Text>
        {resolvedCaption && (
          <Text as="p" size="small" className={styles.rowCaption} data-testid={captionTestId}>
            {resolvedCaption}
            {resolvedDocsPage && (
              <>
                {' '}
                <Link
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    useAppStore.getState().setView({ kind: 'docs', page: resolvedDocsPage })
                  }}
                  data-testid="settings-row-learn-more"
                >
                  {t('settings.learnMore')}
                </Link>
              </>
            )}
          </Text>
        )}
      </div>
      <div className={styles.rowControl}>{control ? control(labelId) : children}</div>
    </div>
  )
}
