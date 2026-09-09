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
//
// `data-setting-id` and the control wrapper's `data-setting-control`
// (goal 0412 S2) are jump-and-highlight's own DOM contract
// (shared/settingsHighlight.ts): the id names which row a search
// result/palette command targets, the control marker names which
// child within it receives focus -- never the row's OWN first
// focusable descendant, which would wrongly land on the "Learn more"
// link above when one is present.
//
// `ready` (goal 0412 S2 Amendment 1) is for a row whose control
// depends on state a `useEffect` fetches after mount: `false` while
// that fetch is outstanding, `true` once it resolves. Jump-and-
// highlight waits for the flip before moving focus -- a control
// focused mid-fetch can be swapped out from under it (a subtree
// replaced wholesale) or simply isn't focusable yet (disabled).
// Omitted entirely for a row with no such dependency, which reads as
// always-ready (`data-setting-ready` absent).
export function SettingsRow({ setting, caption, captionTestId, docsPage, control, children, ready }: {
  setting: SettingEntry
  caption?: string
  captionTestId?: string
  docsPage?: string | false
  control?: (labelId: string) => ReactNode
  children?: ReactNode
  ready?: boolean
}) {
  const { t } = useTranslation('views')
  const labelId = useId()
  const label = t(setting.labelKey)
  const resolvedCaption = caption ?? (setting.captionKey ? t(setting.captionKey) : undefined)
  const resolvedDocsPage = docsPage === false ? undefined : (docsPage ?? setting.docsPage)
  return (
    <div
      className={styles.row}
      data-testid="settings-row"
      data-setting-id={setting.id}
      {...(ready === undefined ? {} : { 'data-setting-ready': ready ? 'true' : 'false' })}
    >
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
      <div className={styles.rowControl} data-setting-control>{control ? control(labelId) : children}</div>
    </div>
  )
}
