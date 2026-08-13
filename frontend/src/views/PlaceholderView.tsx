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
      {/* Design-wave-1 fix #6: the sidebar nav row already names this
          capability -- the h1 is now the descriptive subtitle itself,
          with the capability's own name (still useful, distinct from
          the generic subtitle copy) moved into the card below next to
          its build-status pill. */}
      <Heading as="h1" variant="medium" className={styles.subtitle}>
        {t('placeholderView.subtitle')}
      </Heading>

      <div className={styles.card}>
        {capability && (
          <Text as="p" weight="semibold">
            {capability.Label}{' '}
            <Label variant={statusVariant(capability.Status)}>
              {capability.Status}
            </Label>
          </Text>
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
