import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, Stack, Text } from '@primer/react'
import type { RunStep } from '../shared/bindings'
import { CompositionService, ExecutionService } from '../shared/bindings'
import type { StepTestResult } from '../../bindings/github.com/alicoding/mill/internal/services/executionsvc/models'
import { CodeEditor } from '../shared/CodeEditor'
import type { CanvasNode } from './canvasStore'
import styles from '../shared/ListCard.module.css'

// The step-test surface (ADR-0051 §5, goal 0305): run the selected step
// ALONE on an input and see what comes out, without running the
// workflow -- the converged in-editor "test this step" shape. The input
// editor is the one truth; "Use last run's input" and "Use clipboard"
// only fill it. The step runs through the same registered exec a real
// run uses; a step the guardrail would ask about or deny is refused with
// the verdict rather than run unattended. Generalizes goal 0115's
// converter-only Try it (whose trust line stays, for that one step).
export function StepTestSection({ node, workflowId, runStep }: { node: CanvasNode; workflowId: string; runStep: RunStep | undefined }) {
  const { t } = useTranslation('composition')
  const [input, setInput] = useState('')
  const [attributes, setAttributes] = useState<Record<string, unknown> | null>(null)
  const [result, setResult] = useState<StepTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  if (node.data.kind === 'trigger' || node.data.kind === 'decision') return null

  const useLastRun = () => {
    if (!runStep) return
    setInput(runStep.input ?? '')
    setAttributes(runStep.inputAttributes ?? null)
  }
  const useClipboard = () => {
    CompositionService.ReadHostClipboardText()
      .then((text) => { setInput(text ?? ''); setAttributes(null) })
      .catch((err) => setError(String(err)))
  }
  const run = async () => {
    setRunning(true)
    setResult(null)
    setError(null)
    try {
      setResult(await ExecutionService.TestStep({
        workflowId,
        nodeId: node.id,
        nodeTypeId: node.data.nodeTypeID,
        config: node.data.config ?? {},
        payload: input,
        attributes: attributes ?? null,
      }))
    } catch (err) {
      setError(String(err))
    } finally {
      setRunning(false)
    }
  }
  const hasOutputAttrs = !!result?.outputAttributes && Object.keys(result.outputAttributes).length > 0
  const failure = result?.error || error

  return (
    <Stack direction="vertical" gap="condensed" data-testid="step-test-section">
      <Text size="small" weight="semibold">{t('stepTest.heading')}</Text>
      <Text size="small" className={styles.muted}>{t('stepTest.caption')}</Text>
      <CodeEditor
        value={input}
        onChange={(v) => { setInput(v); setAttributes(null) }}
        language="markdown"
        ariaLabel={t('stepTest.inputAriaLabel')}
        placeholder={t('stepTest.inputPlaceholder')}
        testId="step-test-input"
      />
      <Stack direction="horizontal" gap="condensed" wrap="wrap">
        <Button size="small" variant="primary" onClick={() => { void run() }} disabled={running} data-testid="step-test-run">
          {t('stepTest.run')}
        </Button>
        <Button size="small" onClick={useLastRun} disabled={!runStep?.input && !runStep?.inputAttributes} data-testid="step-test-use-last-run">
          {t('stepTest.useLastRun')}
        </Button>
        <Button size="small" onClick={useClipboard} data-testid="step-test-use-clipboard">
          {t('stepTest.useClipboard')}
        </Button>
      </Stack>
      {result?.refused && (
        <Text as="p" size="small" data-testid="step-test-refused">
          {result.refusedEffect === 'deny'
            ? (result.refusedRule ? t('stepTest.refusedDenyRule', { rule: result.refusedRule }) : t('stepTest.refusedDeny'))
            : (result.refusedRule ? t('stepTest.refusedAskRule', { rule: result.refusedRule }) : t('stepTest.refusedAsk'))}
        </Text>
      )}
      {result && !result.refused && !result.error && (
        <>
          <Text size="small" className={styles.muted}>{t('stepTest.output')}</Text>
          <CodeEditor value={result.output} language="markdown" ariaLabel={t('stepTest.outputAriaLabel')} testId="step-test-output" />
          {hasOutputAttrs && (
            <pre className={styles.result} data-testid="step-test-output-attrs">{JSON.stringify(result.outputAttributes, null, 2)}</pre>
          )}
          {node.data.nodeTypeID === 'process-html-to-markdown' && (
            <Text size="small" className={styles.muted} data-testid="try-engine-note">{t('stepTest.engineNote')}</Text>
          )}
        </>
      )}
      {failure && (
        <Text as="p" size="small" className={styles.error} data-testid="step-test-error">{t('stepTest.stepFailed', { message: failure })}</Text>
      )}
    </Stack>
  )
}
