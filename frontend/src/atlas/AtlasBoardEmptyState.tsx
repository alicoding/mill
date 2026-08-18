import { useTranslation } from 'react-i18next'
import { Button, Text } from '@primer/react'
import runbookStyles from '../shared/ListCard.module.css'
import styles from './AtlasView.module.css'

// The board's two empty states (split from AtlasView at the 500-line
// convention): the goal 0112 filtered-empty variant names the active
// perspective and offers the exit -- a blank board with no
// explanation is the narrowing-compounds-invisibly class the
// interaction laws forbid -- while genuine emptiness keeps the plain
// add-a-card invitation.
export function AtlasBoardEmptyState({ perspectiveName, filteredByPerspective, onShowAll }: {
  // Non-empty exactly when a perspective is active AND unfiltered
  // children exist at this level -- the filter is why nothing shows.
  perspectiveName: string
  filteredByPerspective: boolean
  onShowAll: () => void
}) {
  const { t } = useTranslation('atlas')
  if (filteredByPerspective) {
    return (
      <div className={styles.emptyState} data-testid="atlas-perspective-empty">
        <div className={styles.emptyStateAction}>
          <Text as="p" className={runbookStyles.muted}>{t('perspectiveEmpty', { name: perspectiveName })}</Text>
          <Button size="small" onClick={onShowAll} data-testid="atlas-perspective-empty-show-all">
            {t('perspectiveEmptyShowAll')}
          </Button>
        </div>
      </div>
    )
  }
  return (
    <div className={styles.emptyState} data-testid="atlas-empty-space">
      <Text as="p" className={runbookStyles.muted}>{t('emptySpace')}</Text>
    </div>
  )
}
