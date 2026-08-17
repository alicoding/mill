// Pure list ops behind the card Actions block (goal 0084) -- extracted
// for direct unit coverage of the branches (dedupe, no-op adds,
// missing removes) no single e2e pass exercises.
export function nextActionsOnAdd(current: string[], workflowID: string): string[] {
  if (!workflowID || current.includes(workflowID)) return current
  return [...current, workflowID]
}

export function nextActionsOnRemove(current: string[], workflowID: string): string[] {
  if (!current.includes(workflowID)) return current
  return current.filter((id) => id !== workflowID)
}
