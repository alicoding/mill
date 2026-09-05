import { useTranslation } from 'react-i18next'
import { Stack, Text } from '@primer/react'
import { CopyDiagnosisButton } from './CopyDiagnosisButton'
import { OutputHighlight } from './OutputHighlight'
import type { DiagnosisContext } from './diagnosis'
import { errorParts } from './outputShape'
import styles from './OutputViewer.module.css'

// The Error view (goal 0326): a failure reads as a failure, never as a
// paragraph of output. The message stands alone; the trace lives behind
// a disclosure, so the sentence a reader can act on is not buried under
// a stack. Copy details is the existing diagnosis composer (goal 0127)
// -- error plus context plus the app's own diagnostics -- so a failure
// is copyable identically wherever it surfaces.
export function OutputErrorView({ text, query = '', context, testId }: {
  text: string
  query?: string
  context?: DiagnosisContext
  testId?: string
}) {
  const { t } = useTranslation('common')
  const { message, details } = errorParts(text)
  return (
    <Stack direction="vertical" gap="condensed" className={styles.errorBlock} data-testid={testId}>
      <Stack direction="horizontal" gap="condensed" align="start" justify="space-between">
        <Text as="p" size="small" className={styles.errorMessage} data-testid="output-error-message">
          <OutputHighlight text={message} query={query} />
        </Text>
        <CopyDiagnosisButton error={text} context={context} testId="output-copy-details" />
      </Stack>
      {details !== '' && (
        <details data-testid="output-error-details">
          <summary className={styles.summary}>{t('output.details')}</summary>
          <div className={styles.errorDetails}><OutputHighlight text={details} query={query} /></div>
        </details>
      )}
    </Stack>
  )
}
