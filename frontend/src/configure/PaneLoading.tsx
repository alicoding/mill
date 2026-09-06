import { useTranslation } from 'react-i18next'
import { Text } from '@primer/react'
import styles from '../shared/ListCard.module.css'

// A Configure pane's first-load line. A kind's pane mounts the first
// time its kind is selected (configure/ConfigureView.tsx), so every
// pane that fetches has a moment of "not fetched yet" that must not
// read as "nothing here" -- one marker across every pane, so a reader
// and a test can tell the two states apart.
export function PaneLoading() {
  const { t } = useTranslation('configure')
  return <Text as="p" className={styles.muted} data-testid="configure-loading">{t('loading')}</Text>
}
