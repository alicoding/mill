import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@primer/react'
import { CheckIcon, CopyIcon } from '@primer/octicons-react'
import { composeDiagnosis, type DiagnosisContext } from './diagnosis'
import { writeClipboardText } from './clipboardWrite'

// The one Copy-details affordance behind every copyable failure surface
// (goal 0127 slice 4) -- composes error + context + the app's own
// diagnostics block (diagnosis.ts) and writes it to the clipboard, with
// a brief checkmark confirming the copy landed. A repeated per-row
// action, so it's never `variant="primary"` (.claude/rules/frontend.md
// button semantics (d)).
export function CopyDiagnosisButton({ error, context, testId }: {
  error: string
  context?: DiagnosisContext
  testId?: string
}) {
  const { t } = useTranslation('common')
  const [copied, setCopied] = useState(false)

  const copy = () => {
    void composeDiagnosis({ error, context }).then(writeClipboardText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <IconButton
      icon={copied ? CheckIcon : CopyIcon}
      aria-label={copied ? t('copyDiagnosisButton.copiedAriaLabel') : t('copyDiagnosisButton.copyAriaLabel')}
      size="small"
      variant="invisible"
      onClick={copy}
      data-testid={testId ?? 'copy-diagnosis'}
    />
  )
}
