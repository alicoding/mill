import { create } from 'zustand'
import { ConfigureService } from './bindings'
import type { Tool } from '../../bindings/github.com/alicoding/mill/internal/adapters/mcpclient/models'

// What "List tools" found, per MCP server (goal 0346). The result used
// to live in ConfigureMCPServers' own useState, reachable only from the
// closure the row menu carried; the row action is a registry command
// now, so the answer it fetches is held where both the command and the
// page can see it. A string entry is the connection's own refusal,
// rendered in place of the tool list: a server that cannot be reached
// is a result, not an empty tool set.
type ToolsResult = Tool[] | string

interface MCPToolsState {
  byServer: Record<string, ToolsResult>
  setResult: (serverID: string, result: ToolsResult) => void
}

export const useMCPToolsStore = create<MCPToolsState>()((set) => ({
  byServer: {},
  setResult: (serverID, result) => set((s) => ({ byServer: { ...s.byServer, [serverID]: result } })),
}))

export async function listMCPServerTools(serverID: string): Promise<void> {
  try {
    const tools = await ConfigureService.ListMCPServerTools(serverID)
    useMCPToolsStore.getState().setResult(serverID, tools ?? [])
  } catch (err) {
    useMCPToolsStore.getState().setResult(serverID, String(err))
  }
}
