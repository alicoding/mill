import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import { CompositionService } from '../shared/bindings'
import type { Profile } from '../../bindings/github.com/alicoding/mill/internal/domain/conversionprofile/models'
import { CodeEditor } from '../shared/CodeEditor'
import styles from '../shared/ListCard.module.css'

// The sample preview (goal 0305 slice 6): paste one HTML sample, see
// what every profile makes of it, side by side -- the same converter a
// run uses, one call per profile. The Word check-box paste (goal 0305)
// is the case this exists for.
export function ConversionSamplePreview({ profiles }: { profiles: Profile[] }) {
  const { t } = useTranslation('configure')
  const [html, setHtml] = useState('')
  const [results, setResults] = useState<{ id: string; label: string; markdown: string; error?: string }[] | null>(null)
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    try {
      const out = await Promise.all(profiles.map(async (p) => {
        try {
          return { id: p.ID, label: p.Label, markdown: await CompositionService.PreviewConversion(html, p.RuleSets ?? []) }
        } catch (err) {
          return { id: p.ID, label: p.Label, markdown: '', error: String(err) }
        }
      }))
      setResults(out)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="conversion-sample-preview">
      <Text size="small" weight="semibold">{t('configureConversionProfiles.sampleHeading')}</Text>
      <Text size="small" className={styles.muted}>{t('configureConversionProfiles.sampleCaption')}</Text>
      <CodeEditor value={html} onChange={setHtml} language="html" ariaLabel={t('configureConversionProfiles.samplePlaceholder')} placeholder={t('configureConversionProfiles.samplePlaceholder')} testId="conversion-sample-input" />
      <Stack direction="horizontal">
        <Button size="small" onClick={() => { void run() }} disabled={!html || running || profiles.length === 0} data-testid="conversion-sample-run">
          {t('configureConversionProfiles.sampleRun')}
        </Button>
      </Stack>
      {results && (
        <Stack direction="vertical" gap="condensed">
          {results.map((r) => (
            <Stack key={r.id} direction="vertical" gap="none" data-testid="conversion-sample-result" data-profile-id={r.id}>
              <Text size="small" weight="semibold">{r.label}</Text>
              {r.error
                ? <Text as="p" size="small" className={styles.error}>{r.error}</Text>
                : <pre className={styles.result} data-testid="conversion-sample-output">{r.markdown}</pre>}
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  )
}
