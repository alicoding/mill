import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'
import { commandLabel, findCommand } from '../shared/commands'

// The command half of a plugin's automation surface (goal 0324): an
// agent calls plugin_<pluginId>_<toolName>, Mill's host emits
// plugin-tool-invoke, and this answers plugin-tool-result -- the same
// Go-asks-the-page handshake the leave gate uses
// (useBeforeQuitFlush.ts), with a request id because several tool
// calls can be in flight at once.
//
// The command is looked up in the ONE registry the palette, the
// keyboard and every button already render from, and its enabled()
// is honoured: a tool call can no more run an unavailable command
// than a person can. Only the main window mounts this -- the
// registry's commands assume it, and a second answering window would
// run the command twice.

interface InvokeRequest {
  requestId: string
  pluginId: string
  commandId: string
}

function requestOf(data: unknown): InvokeRequest | null {
  const d = data as Partial<InvokeRequest> | null
  if (!d?.requestId || !d.pluginId || !d.commandId) return null
  return { requestId: d.requestId, pluginId: d.pluginId, commandId: d.commandId }
}

function reply(requestId: string, ok: boolean, result: string, error: string): void {
  void Events.Emit('plugin-tool-result', { requestId, ok: ok ? 'true' : 'false', result, error })
}

// runPluginCommand is exported for its own test: the whole contract is
// "look the command up, honour enabled(), report what happened".
export function runPluginCommand(req: InvokeRequest): void {
  const command = findCommand(`plugin.${req.pluginId}.${req.commandId}`)
  if (!command) {
    reply(req.requestId, false, '', `${req.pluginId} has no command "${req.commandId}" registered`)
    return
  }
  if (command.enabled && !command.enabled()) {
    reply(req.requestId, false, '', `"${commandLabel(command)}" is not available right now`)
    return
  }
  try {
    void command.run()
    reply(req.requestId, true, `ran "${commandLabel(command)}"`, '')
  } catch (err) {
    reply(req.requestId, false, '', err instanceof Error ? err.message : String(err))
  }
}

export function usePluginToolBridge(): void {
  useEffect(() => {
    return Events.On('plugin-tool-invoke', (ev) => {
      const req = requestOf(ev?.data)
      if (req) runPluginCommand(req)
    })
  }, [])
}
