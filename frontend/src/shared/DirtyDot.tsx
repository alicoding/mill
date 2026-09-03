import { useTranslation } from 'react-i18next'
import styles from './DirtyDot.module.css'

// The unsaved marker (goal 0295 S2b): the converged "dirty dot" every
// tabbed editor and macOS document window uses for unsaved state --
// one small attention-colored disc at the surface's top-right corner,
// no text. The parent positions itself; this only paints the dot.
export function DirtyDot({ testId = 'unsaved-dot' }: { testId?: string }) {
  const { t } = useTranslation('app')
  return <span className={styles.dot} data-unsaved-dot="" role="img" aria-label={t('unsaved.marker')} title={t('unsaved.marker')} data-testid={testId} />
}
