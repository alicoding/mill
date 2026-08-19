import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import type { NodeType } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { CompositionService } from '../shared/bindings'
import { CodeEditor } from '../shared/CodeEditor'
import styles from '../shared/ListCard.module.css'

// The trust-gap "Try it" preview (docs/goals/0115 slice 1): paste HTML,
// see the exact Markdown process-html-to-markdown's node execution
// would produce, via the same converter (CompositionService.
// PreviewHTMLToMarkdown -> markdown.ToMarkdown). Self-guards on node
// type the same way NodeExecutionSection self-guards on step presence
// -- only this one converter step has anything to try.
export function TryConversionSection({ nodeType }: { nodeType: NodeType | undefined }) {
  const { t } = useTranslation('composition')
  const [html, setHtml] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  if (nodeType?.ID !== 'process-html-to-markdown') return null

  const convert = async () => {
    const value = html
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const markdown = await CompositionService.PreviewHTMLToMarkdown(value)
      setResult(markdown)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Stack direction="vertical" gap="condensed" data-testid="try-conversion-section">
      <Text size="small" weight="semibold">{t('nodeInspector.tryItHeading')}</Text>
      <Text size="small" className={styles.muted}>{t('nodeInspector.tryItCaption')}</Text>
      <CodeEditor
        value={html}
        onChange={setHtml}
        language="html"
        ariaLabel={t('nodeInspector.tryItPlaceholder')}
        placeholder={t('nodeInspector.tryItPlaceholder')}
        testId="try-html-input"
      />
      <Button size="small" onClick={() => { void convert() }} disabled={!html || loading} data-testid="try-convert">
        {t('nodeInspector.tryItConvert')}
      </Button>
      {result !== null && (
        <>
          <CodeEditor
            value={result}
            language="markdown"
            ariaLabel={t('nodeInspector.tryItResultAriaLabel')}
            testId="try-markdown-output"
          />
          {/* Goal 0115 slice 2, the trust line: what converted this --
              behavior, not library internals (ux-writing.md). */}
          <Text size="small" className={styles.muted} data-testid="try-engine-note">
            {t('nodeInspector.tryItEngineNote')}
          </Text>
        </>
      )}
      {error !== null && (
        <Text as="p" size="small" className={styles.error} data-testid="try-convert-error">
          {t('nodeInspector.tryItError', { message: error })}
        </Text>
      )}
    </Stack>
  )
}
