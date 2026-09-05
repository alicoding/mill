import type { Command } from './commands'
import type { CommandContext } from './commandContext'
import { entryContext, runContext, workflowContext } from './commandContext'
import { ClipboardHistoryService, ExecutionService, RunKind, SettingsService } from './bindings'
import { resolveApprovalCall } from './approvalResolution'
import { generateSamplePayload } from './configSchema'
import { workflowTarget } from './navigateTarget'
import { useAppStore } from './store'
import { isAuxiliaryWindow } from './windowRole'

// Commands that act on a TARGET the invoker supplies (goal 0343):
// stop this run, open this run, pin this workflow, delete this
// clipboard entry. Before the context parameter existed, each of these
// lived as an inline background() call at whichever row offered it --
// outside the registry, so unreachable from the palette, unbindable in
// Settings, and with its label duplicated per surface.
//
// Every command here declares `needs`, so none of them can fire
// without a target: the palette only offers one when
// ambientContext() resolves that kind, and runCommand refuses
// (silently -- nothing was asked of a target) when a caller supplies
// none.

// A navigation command's two jobs, one call site (shared/windowRole.ts):
// move the main window's own store, or ask Go to bring the main window
// to the target from an auxiliary one.
function navigateToWorkflow(workflowId: string, runId?: string): void | Promise<unknown> {
  if (isAuxiliaryWindow()) return SettingsService.OpenMainWindow(workflowTarget(workflowId, runId))
  useAppStore.getState().requestOpenWorkflow(workflowId, runId)
}

function isPinned(ctx?: CommandContext): boolean {
  const target = workflowContext(ctx)
  return target ? useAppStore.getState().pinnedWorkflowIds.includes(target.workflowId) : false
}

export const ROW_COMMANDS: Command[] = [
  {
    // The Review page's door into the run behind an approval request,
    // and the same door every other surface showing a run uses: the
    // workflow's tab, with that run selected on its Runs panel. ONE
    // run-detail viewer (docs/SPEC.md §7).
    id: 'run.open',
    label: 'commands.run.open',
    defaultBinding: null,
    needs: 'run',
    // A run row that doesn't know its workflow has no tab to open --
    // honest enablement rather than a silently inert menu item.
    enabled: (ctx) => Boolean(runContext(ctx)?.workflowId),
    run: (ctx) => {
      const target = runContext(ctx)
      if (!target?.workflowId) return
      return navigateToWorkflow(target.workflowId, target.runId)
    },
  },
  {
    // The run monitor window (goal 0294): a settled run's steps without
    // opening the full app -- the tray's own recent rows.
    id: 'run.monitor',
    label: 'commands.run.monitor',
    defaultBinding: null,
    needs: 'run',
    enabled: (ctx) => Boolean(runContext(ctx)?.workflowId),
    run: (ctx) => {
      const target = runContext(ctx)
      if (!target?.workflowId) return
      return SettingsService.ShowRunMonitor(target.workflowId, target.runId)
    },
  },
  {
    // Resume a paused run straight through to the end (goal 0328): the
    // debugger family's Continue, answering the park the run is sitting
    // on. Only a surface that can see WHICH step is parked can offer it,
    // so the node is part of the target rather than re-fetched here.
    id: 'run.continue',
    label: 'commands.run.continue',
    defaultBinding: null,
    needs: 'run',
    enabled: (ctx) => Boolean(runContext(ctx)?.nodeId),
    run: (ctx) => {
      const target = runContext(ctx)
      if (!target?.nodeId) return
      return resolveApprovalCall({ runID: target.runId, nodeID: target.nodeId, approve: true, values: target.values, continueRun: true })
    },
  },
  {
    // Advance one step and park again -- step mode's own control, and
    // meaningless on a run that isn't stepping, which is why the dock
    // omits it there rather than offering an inert button.
    id: 'run.step',
    label: 'commands.run.step',
    defaultBinding: null,
    needs: 'run',
    enabled: (ctx) => Boolean(runContext(ctx)?.nodeId),
    run: (ctx) => {
      const target = runContext(ctx)
      if (!target?.nodeId) return
      return resolveApprovalCall({ runID: target.runId, nodeID: target.nodeId, approve: true, values: target.values, continueRun: false })
    },
  },
  {
    id: 'run.stop',
    label: 'commands.run.stop',
    defaultBinding: null,
    needs: 'run',
    run: (ctx) => {
      const target = runContext(ctx)
      if (!target) return
      return ExecutionService.CancelRun(target.runId)
    },
  },
  {
    id: 'workflow.open',
    label: 'commands.workflow.open',
    defaultBinding: null,
    needs: 'workflow',
    run: (ctx) => {
      const target = workflowContext(ctx)
      if (!target) return
      return navigateToWorkflow(target.workflowId)
    },
  },
  {
    // Run this workflow and follow it in the run monitor window (goal
    // 0294's ⌘⇧↩) -- declared Attributes run with sample defaults, the
    // same "quick invoke skips the review dialog" rule the panel's own
    // Run row follows.
    id: 'workflow.runAndWatch',
    label: 'commands.workflow.runAndWatch',
    defaultBinding: null,
    needs: 'workflow',
    run: (ctx) => {
      const target = workflowContext(ctx)
      if (!target) return
      const workflow = useAppStore.getState().workflows?.find((w) => w.ID === target.workflowId)
      const attrs = workflow?.Attributes ?? []
      const values = attrs.length > 0 ? generateSamplePayload(attrs) : null
      return Promise.all([
        ExecutionService.RunWorkflow(target.workflowId, RunKind.RunKindTest, values),
        SettingsService.ShowRunMonitor(target.workflowId, 'latest'),
        SettingsService.DismissPanel(),
      ])
    },
  },
  {
    // Pin and Unpin are two commands, not one toggle: a menu shows the
    // action it will perform, and the omit-when-unavailable rule then
    // renders exactly one of them per row.
    id: 'workflow.pin',
    label: 'commands.workflow.pin',
    defaultBinding: null,
    needs: 'workflow',
    enabled: (ctx) => !isPinned(ctx),
    run: (ctx) => {
      const target = workflowContext(ctx)
      if (target) useAppStore.getState().togglePinnedWorkflow(target.workflowId)
    },
  },
  {
    id: 'workflow.unpin',
    label: 'commands.workflow.unpin',
    defaultBinding: null,
    needs: 'workflow',
    enabled: (ctx) => isPinned(ctx),
    run: (ctx) => {
      const target = workflowContext(ctx)
      if (target) useAppStore.getState().togglePinnedWorkflow(target.workflowId)
    },
  },
  {
    id: 'clipboard.pin',
    label: 'commands.clipboard.pin',
    defaultBinding: null,
    needs: 'entry',
    enabled: (ctx) => entryContext(ctx)?.pinned !== true,
    run: (ctx) => {
      const target = entryContext(ctx)
      if (!target) return
      return ClipboardHistoryService.SetClipboardHistoryPinned(target.entryId, true)
    },
  },
  {
    id: 'clipboard.unpin',
    label: 'commands.clipboard.unpin',
    defaultBinding: null,
    needs: 'entry',
    enabled: (ctx) => entryContext(ctx)?.pinned === true,
    run: (ctx) => {
      const target = entryContext(ctx)
      if (!target) return
      return ClipboardHistoryService.SetClipboardHistoryPinned(target.entryId, false)
    },
  },
  {
    id: 'clipboard.delete',
    label: 'commands.clipboard.delete',
    defaultBinding: null,
    needs: 'entry',
    run: (ctx) => {
      const target = entryContext(ctx)
      if (!target) return
      return ClipboardHistoryService.DeleteClipboardHistoryEntry(target.entryId)
    },
  },
]
