import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Stack, Text } from '@primer/react'
import { AnchoredOverlay } from '@primer/react'
import { ReactFlow, ReactFlowProvider, Background } from '@xyflow/react'
import { CompositionService } from '../shared/bindings'
import type { NodeType, Workflow } from '../../bindings/github.com/alicoding/mill/internal/domain/composition/models'
import { useAppStore } from '../shared/store'

// Hover a workflow reference anywhere (an Activity row, a
// child-workflow step) to see that workflow's actual layout in a small
// read-only canvas, with a jump straight into its editor -- the
// n8n/[decisioning-vendor] pattern requested directly (docs/SPEC.md §3.8). Composed
// from already-adopted pieces only: Primer's AnchoredOverlay for the
// popup, React Flow itself (the same engine the real canvas uses) for
// the layout, and the store's openWorkflowRequest for the jump. The
// workflow definition is fetched lazily on first open and cached per
// mounted instance -- hover is a browse gesture, so no fetch happens
// for rows never hovered.

const OPEN_DELAY_MS = 250

export function WorkflowHoverPreview({ workflowId, children }: {
  workflowId: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [workflow, setWorkflow] = useState<Workflow | null | 'missing'>(null)
  const [nodeTypes, setNodeTypes] = useState<NodeType[]>([])
  const timer = useRef<number | null>(null)
  const requestOpenWorkflow = useAppStore((s) => s.requestOpenWorkflow)

  const load = () => {
    if (workflow !== null) return
    Promise.all([CompositionService.Workflows(), CompositionService.NodeTypes()])
      .then(([wfs, types]) => {
        setNodeTypes(types ?? [])
        setWorkflow((wfs ?? []).find((w) => w.ID === workflowId) ?? 'missing')
      })
      .catch(() => setWorkflow('missing'))
  }

  const scheduleOpen = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      load()
      setOpen(true)
    }, OPEN_DELAY_MS)
  }
  const cancelOpen = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }

  // A hover-then-navigate-away (the row itself gets removed, e.g. a
  // deleted workflow, or the whole surface unmounts) must not fire the
  // scheduled open against a gone component -- clear the pending timer
  // on unmount, same as cancelOpen already does on mouseleave.
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
  }, [])

  return (
    <AnchoredOverlay
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      overlayProps={{ role: 'dialog', 'aria-label': 'Workflow preview' }}
      renderAnchor={(allAnchorProps) => {
        // onClick deliberately dropped: on a canvas node, a click means
        // select-the-node (React Flow's own semantics), and elsewhere a
        // click may mean expand -- hover (plus the overlay's own Esc/
        // outside-click close) is this affordance's entire contract.
        const { onClick, ...anchorProps } = allAnchorProps
        void onClick
        return (
        <span
          {...anchorProps}
          onMouseEnter={scheduleOpen}
          onMouseLeave={cancelOpen}
          data-testid="workflow-hover-anchor"
        >
          {children}
        </span>
        )
      }}
    >
      <div onMouseLeave={() => setOpen(false)} style={{ padding: 'var(--base-size-8)' }} data-testid="workflow-preview">
        {workflow === null && <Text size="small">Loading…</Text>}
        {workflow === 'missing' && <Text size="small">This workflow no longer exists.</Text>}
        {workflow !== null && workflow !== 'missing' && (
          <Stack direction="vertical" gap="condensed">
            <Stack direction="horizontal" justify="space-between" align="center" gap="normal">
              <Text weight="semibold" size="small">{workflow.Label}</Text>
              <Button
                size="small"
                onClick={() => { setOpen(false); requestOpenWorkflow(workflow.ID) }}
                data-testid="workflow-preview-open"
              >
                Open
              </Button>
            </Stack>
            <div style={{ width: 320, height: 200, border: '1px solid var(--borderColor-default)', borderRadius: 'var(--borderRadius-medium)' }}>
              {/* Its own provider, non-negotiable: a bare <ReactFlow>
                  mounted while a real canvas is on screen joins that
                  canvas's store and empties it (real bug, caught live
                  -- hovering the preview blanked the parent canvas).
                  React Flow's own docs require a provider per flow
                  when multiple flows render on one page. */}
              <ReactFlowProvider>
              <ReactFlow
                nodes={(workflow.Nodes ?? []).map((n) => ({
                  id: n.ID,
                  position: { x: n.Position?.X ?? 0, y: n.Position?.Y ?? 0 },
                  data: { label: nodeTypes.find((t) => t.ID === n.NodeTypeID)?.Label ?? n.NodeTypeID },
                }))}
                edges={(workflow.Edges ?? []).map((e) => ({ id: e.ID, source: e.Source, target: e.Target }))}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable={false}
                zoomOnScroll={false}
                panOnDrag={false}
                preventScrolling={false}
              >
                <Background />
              </ReactFlow>
              </ReactFlowProvider>
            </div>
          </Stack>
        )}
      </div>
    </AnchoredOverlay>
  )
}
