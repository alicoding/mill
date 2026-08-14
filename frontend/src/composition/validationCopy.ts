import type { Issue } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// Pure formatter for the validation panel's "Copy issues" button --
// separate file for the same two reasons every pure-helper extraction
// here follows (react-refresh + a Vitest home, execEnvRows.ts's own
// header note). The output is a self-identifying, paste-anywhere text
// block: naming the workflow, the counts, and each issue with its
// offending node/edge id -- exactly what an MCP author's
// validate_workflow tool returns as {valid, issues[]} (docs/adr/0025),
// so a human paste and an MCP read describe the same state the same
// way (docs/SPEC.md §1's what-you-see-is-what-I-see thesis).
export function formatIssuesForCopy(t: (key: string, opts?: Record<string, unknown>) => string, workflowLabel: string, workflowId: string, issues: Issue[]): string {
  const errors = issues.filter((i) => i.Severity === 'error').length
  const warnings = issues.length - errors
  const counts: string[] = []
  if (errors > 0) counts.push(t('validationPanel.errorCount', { count: errors, plural: errors === 1 ? '' : 's' }))
  if (warnings > 0) counts.push(t('validationPanel.warningCount', { count: warnings, plural: warnings === 1 ? '' : 's' }))

  const lines = issues.map((i) => {
    // ValidateGraph's own Message usually already leads with
    // "step <id>: "/"edge <id>: " -- adding our own location fragment
    // then double-prefixed every line. Only add a location when the
    // message doesn't carry one.
    const alreadyLocated = i.Message.startsWith('step ') || i.Message.startsWith('edge ')
    const where = alreadyLocated ? '' : i.NodeID ? t('validationCopy.nodeLocation', { id: i.NodeID }) : i.EdgeID ? t('validationCopy.edgeLocation', { id: i.EdgeID }) : ''
    return `- [${i.Severity}]${where}: ${i.Message}`
  })
  // The id line makes the paste directly actionable for an MCP author
  // (tools key by id; labels aren't unique) -- same paste, human AND
  // machine consumable.
  return [
    t('validationCopy.header', { label: workflowLabel, id: workflowId, counts: counts.join(' · ') }),
    ...lines,
  ].join('\n')
}
