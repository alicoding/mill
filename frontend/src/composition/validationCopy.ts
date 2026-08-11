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
export function formatIssuesForCopy(workflowLabel: string, issues: Issue[]): string {
  const errors = issues.filter((i) => i.Severity === 'error').length
  const warnings = issues.length - errors
  const counts: string[] = []
  if (errors > 0) counts.push(`${errors} error${errors === 1 ? '' : 's'}`)
  if (warnings > 0) counts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`)

  const lines = issues.map((i) => {
    const where = i.NodeID ? ` node ${i.NodeID}` : i.EdgeID ? ` edge ${i.EdgeID}` : ''
    return `- [${i.Severity}]${where}: ${i.Message}`
  })
  return [`Mill workflow "${workflowLabel}" — validation issues (${counts.join(' · ')}):`, ...lines].join('\n')
}
