import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Text } from '@primer/react'
import { useAppStore } from '../shared/store'
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
export function SettingsRow({ label, caption, captionTestId, docsPage, control, children }: {
  label: string
  caption?: string
  captionTestId?: string
  docsPage?: string
  control?: (labelId: string) => ReactNode
  children?: ReactNode
}) {
  const { t } = useTranslation('views')
  const labelId = useId()
  return (
    <div className={styles.row} data-testid="settings-row">
      <div className={styles.rowText}>
        <Text id={labelId} className={styles.rowLabel}>{label}</Text>
        {caption && (
          <Text as="p" size="small" className={styles.rowCaption} data-testid={captionTestId}>
            {caption}
            {docsPage && (
              <>
                {' '}
                <Link
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    useAppStore.getState().setView({ kind: 'docs', page: docsPage })
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
