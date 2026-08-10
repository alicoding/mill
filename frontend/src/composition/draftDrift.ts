import type { Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// Key-sorted JSON stringify -- Node.Config is a plain { [key]: string }
// map, and Go's own JSON marshaling order plus two separate fetches of
// "the same" data aren't guaranteed to produce byte-identical key order
// even when semantically equal. A naive JSON.stringify comparison could
// false-positive a real match as "drifted"; sorting object keys
// (arrays keep their order -- Nodes/Edges/Attributes order is
// meaningful) avoids that.
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {}
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k]
      }
      return sorted
    }
    return val
  })
}

// True when wf's draft head (Nodes/Edges/Attributes -- the actual
// execution graph, not cosmetic Label/Description) differs from what's
// currently published/live. Only meaningful once something has been
// published at all (docs/goals/0006-trigger-aware-workflows-list.md,
// decision 1): a never-published workflow's Run button just says "test
// run of the draft," full stop -- there's no "live" version to differ
// from yet. The comparison is possible client-side specifically because
// WorkflowVersion (models.ts) carries its own Nodes/Edges/Attributes
// snapshot alongside the version number, not just the number alone.
export function hasDraftDrift(wf: Workflow): boolean {
  if (wf.PublishedVersion <= 0) return false
  const published = (wf.Versions ?? []).find((v) => v.Version === wf.PublishedVersion)
  if (!published) return false
  return (
    stableStringify(wf.Nodes ?? []) !== stableStringify(published.Nodes ?? []) ||
    stableStringify(wf.Edges ?? []) !== stableStringify(published.Edges ?? []) ||
    stableStringify(wf.Attributes ?? []) !== stableStringify(published.Attributes ?? [])
  )
}
