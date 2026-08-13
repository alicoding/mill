import { useTranslation } from 'react-i18next'
import { Heading, Label, Text, Button } from '@primer/react'
import { useAppStore, statusVariant } from '../shared/store'
import styles from '../shared/ListCard.module.css'
import PageContainer from '../shared/PageContainer'

interface PlaceholderViewProps {
  capabilityId: string
}

// Generic "not built yet" page for any capability whose docs/SPEC.md
// entry exists but has no real UI yet -- reuses ListCard.module.css's
// card/empty/muted classes rather than a bespoke stylesheet, matching
// this session's CSS Modules decision (SPEC.md §1.3).
function PlaceholderView({ capabilityId }: PlaceholderViewProps) {
  const { t } = useTranslation('views')
  const capability = useAppStore((s) => s.capabilities.find((c) => c.ID === capabilityId))
  const setView = useAppStore((s) => s.setView)

  return (
    <PageContainer>
      <Heading as="h1">{capability?.Label ?? t('placeholderView.notBuiltYet')}</Heading>
      <Text as="p" className={styles.subtitle}>
        {t('placeholderView.subtitle')}
      </Text>

      <div className={styles.card}>
        {capability && (
          <Label variant={statusVariant(capability.Status)}>
            {capability.Status}
          </Label>
        )}
        <Text as="p" size="small" className={styles.muted}>
          {t('placeholderView.specSectionNote', { section: capability?.SpecSection ?? '?' })}
        </Text>
        <Button size="small" onClick={() => setView({ kind: 'composition' })}>
          {t('placeholderView.backToWorkflows')}
        </Button>
      </div>
    </PageContainer>
  )
}

export default PlaceholderView
