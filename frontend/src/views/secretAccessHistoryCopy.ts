// Pure copy-mapping logic for SecretsAccessHistoryDialog.tsx, split out
// so it (and its Vitest coverage) never has to load the dialog's own
// Primer imports (goal 0371) -- this file stays free of any UI-kit
// dependency.

// SecretAccessContext mirrors secretaudit.Context's own const block
// (internal/adapters/secretaudit/secretaudit.go) by hand -- the two
// sides aren't type-shared, so a new Go Context needs its own case
// added here too (SecretsAccessHistoryDialog.test.tsx's own hard-coded
// list is the sync check: goal 0371).
export type SecretAccessContext =
  | 'mcp-server-spawn'
  | 'exec-env'
  | 'http-header'
  | 'configure-tools-preview'
  | 'integration-auth'
  | 'ai-provider'
  | 'secret-adoption'
  | 'ui-reveal'
  | 'ui-copy'
  | 'clipboard-history-copy'
  | 'coding-loop-shell'
  | 'client-certificate'
  | 'environment-var'
  | 'plugin-fetch'
  | 'request-test'

// RUN_ATTRIBUTABLE_CONTEXTS is every context the Go side ever populates
// RunID/WorkflowID/StepID for (goal 0371's own capture-side fix) -- the
// rest (a Configure-page preview, a human's own click, the one-time
// adoption read-back) never carry a run, so their copy never varies by
// one.
const RUN_ATTRIBUTABLE_CONTEXTS: ReadonlySet<SecretAccessContext> = new Set([
  'mcp-server-spawn', 'exec-env', 'http-header', 'integration-auth',
  'ai-provider', 'environment-var', 'coding-loop-shell', 'client-certificate',
])

// contextCopyKey maps one record's context (+ whether a workflow name
// resolved, + whether a step id came with it) to its locale key -- see
// secrets.json's accessHistory.* for the actual sentences. A resolved
// workflow always wins over the context's own generic phrase, for
// every context real runs can attribute (RUN_ATTRIBUTABLE_CONTEXTS) --
// an exhaustive switch with NO default: a Context this dialog doesn't
// know yet fails `tsc` here instead of silently rendering bare "Read".
export function contextCopyKey(context: SecretAccessContext, hasWorkflow: boolean, hasStep: boolean): string {
  if (hasWorkflow && RUN_ATTRIBUTABLE_CONTEXTS.has(context)) {
    return hasStep ? 'accessHistory.readByWorkflowStep' : 'accessHistory.readByWorkflow'
  }
  switch (context) {
    case 'mcp-server-spawn': return 'accessHistory.readMcpServerSpawn'
    case 'exec-env': return 'accessHistory.readExecEnv'
    case 'http-header': return 'accessHistory.readHttpHeader'
    case 'configure-tools-preview': return 'accessHistory.readConfigureToolsPreview'
    case 'integration-auth': return 'accessHistory.readIntegrationAuth'
    case 'ai-provider': return 'accessHistory.readAiProvider'
    case 'secret-adoption': return 'accessHistory.readSecretAdoption'
    case 'ui-reveal': return 'accessHistory.readUiReveal'
    case 'ui-copy': return 'accessHistory.readUiCopy'
    case 'clipboard-history-copy': return 'accessHistory.readClipboardHistoryCopy'
    case 'coding-loop-shell': return 'accessHistory.readCodingLoopShell'
    case 'client-certificate': return 'accessHistory.readClientCertificate'
    case 'environment-var': return 'accessHistory.readEnvironmentVar'
    case 'plugin-fetch': return 'accessHistory.readPluginFetch'
    case 'request-test': return 'accessHistory.readRequestTest'
  }
}
