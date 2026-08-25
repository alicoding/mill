import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { GuardrailService } from '../shared/bindings'
import { Effect as GuardrailEffect } from '../../bindings/github.com/alicoding/mill/internal/domain/guardrail/models'
import type { Rule } from '../../bindings/github.com/alicoding/mill/internal/domain/guardrail/models'

// Ground-truth breakpoint state (docs/adr/0031, goal 0022's move off the
// Inspector button onto the node card itself -- owner: "not sure why
// the debug is at the node level?", the same "policy is not step
// config" lesson ADR-0022 already applied one level up, here applied to
// a debug control instead of an authoring one). A breakpoint is one
// instance-scoped Source:debug guardrail Rule per node -- see
// NodeGuardrailSection.tsx's own header comment for why this borrows
// the guardrail Rule/park plumbing without being policy.
//
// Deliberately NOT derived from GuardrailService.WorkflowVerdicts (the
// per-node WINNING-rule projection useGuardrailBadges.ts already
// fetches for the shield badge): verdict precedence (deny > ask >
// allow) can hide a breakpoint's own existence behind a stronger policy
// deny on the same node, and the card's own toggle must never lie about
// whether clicking it will add or remove a rule. A second, small fetch
// (GuardrailService.Rules(), filtered to Source:debug) is the ground
// truth instead, kept in a React Context so every node card can read
// its own "is a breakpoint set here" + toggle it, without each card
// running its own fetch (same context-over-per-node-fetch shape
// liveRunState.ts's RunStateContext already established for run status).
const DEBUG_SOURCE = 'debug'

export interface BreakpointContextValue {
  isSet: (nodeId: string) => boolean
  // A workflow needs a real ID before a breakpoint rule can be attached
  // to it -- false for a not-yet-saved 'workflow-new' canvas, mirroring
  // the same "save first" gate trigger-hotkey's own Inspector section
  // already uses.
  enabled: boolean
  busyNodeId: string | null
  toggle: (nodeId: string) => void
}

export const BreakpointContext = createContext<BreakpointContextValue>({
  isSet: () => false,
  enabled: false,
  busyNodeId: null,
  toggle: () => {},
})

export function useNodeBreakpoint(nodeId: string): { isSet: boolean; enabled: boolean; busy: boolean; toggle: () => void } {
  const ctx = useContext(BreakpointContext)
  return { isSet: ctx.isSet(nodeId), enabled: ctx.enabled, busy: ctx.busyNodeId === nodeId, toggle: () => ctx.toggle(nodeId) }
}

// Owns the fetch + CRUD for the current workflow's own debug rules.
// `onChanged` lets the canvas also refresh its guardrail-verdict badges
// (useGuardrailBadges.ts) after a toggle -- adding/removing a debug rule
// can change WorkflowVerdicts' own per-node winning-rule result (e.g.
// whether the shield badge should now be suppressed in favor of the
// breakpoint dot), which that hook's own nodeFingerprint-keyed effect
// would never notice on its own (docs/adr/0031's same reasoning,
// carried over verbatim from the Inspector-button version this
// replaces).
export function useBreakpoints(workflowId: string | undefined, onChanged?: () => void): BreakpointContextValue {
  const [byNodeId, setByNodeId] = useState<Record<string, Rule>>({})
  const [busyNodeId, setBusyNodeId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!workflowId) {
      setByNodeId({})
      return
    }
    GuardrailService.Rules()
      .then((rules) => {
        const map: Record<string, Rule> = {}
        for (const r of rules ?? []) {
          if (r.Source === DEBUG_SOURCE && r.WorkflowID === workflowId && r.NodeID) map[r.NodeID] = r
        }
        setByNodeId(map)
      })
      .catch(() => setByNodeId({}))
  }, [workflowId])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = useCallback(
    (nodeId: string) => {
      if (!workflowId) return
      setBusyNodeId(nodeId)
      const done = () => {
        setBusyNodeId(null)
        refresh()
        onChanged?.()
      }
      const existing = byNodeId[nodeId]
      if (existing) {
        GuardrailService.DeleteRule(existing.ID).then(done).catch(done)
      } else {
        GuardrailService.CreateRule({
          ID: '', Label: 'Breakpoint', Effect: GuardrailEffect.EffectAsk, Source: DEBUG_SOURCE,
          WorkflowID: workflowId, NodeID: nodeId, NodeTypeID: '', RequestID: '', Condition: '',
          BuiltIn: false, Seed: { SeedRevision: 0, Modified: false },
        }).then(done).catch(done)
      }
    },
    [workflowId, byNodeId, refresh, onChanged],
  )

  const isSet = useCallback((nodeId: string) => nodeId in byNodeId, [byNodeId])

  return { isSet, enabled: !!workflowId, busyNodeId, toggle }
}
