import type { AttributeDef } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'

// attrsForPending: given a workflow's full declared Attributes and an
// optional requested-subset list (PendingApproval.inputAttributes, goal
// 0001), returns the ones actually worth asking for -- empty/absent
// means all. Its own file, sibling to ApprovalValuesForm.tsx (goal
// 0419 S1b): a non-component export next to that component broke
// react-refresh/only-export-components.
export function attrsForPending(all: AttributeDef[], requested: string[] | null | undefined): AttributeDef[] {
  return requested && requested.length > 0 ? all.filter((a) => requested.includes(a.Key)) : all
}
