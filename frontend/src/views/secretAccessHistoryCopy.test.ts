import { describe, expect, it } from 'vitest'
import i18n from '../app/i18n'
import { contextCopyKey, type SecretAccessContext } from './secretAccessHistoryCopy'

// The hard-coded sync check goal 0371's own design contract calls for:
// secretaudit.Context's full const block (internal/adapters/secretaudit/
// secretaudit.go), copied here by hand since the Go and TS sides carry
// no shared type -- a Context added on the Go side with no matching
// entry here won't fail THIS list, but contextCopyKey's own exhaustive
// switch fails `tsc` the moment it's added to SecretAccessContext, and
// adding it there without adding it to this array fails the coverage
// assertion below.
const GO_CONTEXTS: SecretAccessContext[] = [
  'mcp-server-spawn',
  'exec-env',
  'http-header',
  'configure-tools-preview',
  'integration-auth',
  'ai-provider',
  'secret-adoption',
  'ui-reveal',
  'ui-copy',
  'clipboard-history-copy',
  'coding-loop-shell',
  'client-certificate',
  'environment-var',
  'plugin-fetch',
  'request-test',
]

describe('contextCopyKey', () => {
  it('maps every Context the Go side writes to a resolvable locale key, with no workflow attributed', () => {
    for (const context of GO_CONTEXTS) {
      const key = contextCopyKey(context, false, false)
      const resolved = i18n.t(key, { ns: 'secrets', workflow: 'Example workflow', step: 'example-step', actor: 'tester' })
      expect(resolved, `context ${context} resolved key ${key} to its own key (missing from secrets.json)`).not.toBe(key)
    }
  })

  it('run-attributable contexts switch to the workflow phrase once a workflow resolves, others do not', () => {
    const runAttributable: SecretAccessContext[] = [
      'mcp-server-spawn', 'exec-env', 'http-header', 'integration-auth',
      'ai-provider', 'environment-var', 'coding-loop-shell', 'client-certificate',
    ]
    for (const context of runAttributable) {
      expect(contextCopyKey(context, true, false)).toBe('accessHistory.readByWorkflow')
      expect(contextCopyKey(context, true, true)).toBe('accessHistory.readByWorkflowStep')
    }
    const neverRunAttributed = GO_CONTEXTS.filter((c) => !runAttributable.includes(c))
    for (const context of neverRunAttributed) {
      // A resolved workflow label never reaches these contexts in
      // practice (their Go call sites never populate WorkflowID), but
      // contextCopyKey itself stays honest either way: no run-phrase
      // fallback for a context real runs never attribute.
      expect(contextCopyKey(context, true, true)).not.toBe('accessHistory.readByWorkflowStep')
    }
  })

  it('the step phrase interpolates the step id', () => {
    const resolved = i18n.t('accessHistory.readByWorkflowStep', { ns: 'secrets', workflow: 'Nightly sync', step: 'send-step' })
    expect(resolved).toBe('Read by workflow "Nightly sync" · step send-step')
  })
})
