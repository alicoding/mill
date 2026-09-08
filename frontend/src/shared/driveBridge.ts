import { findCommand, commandAvailable } from './commands'
import type { CommandContext } from './commandContext'

// The driving door for internal/webviewbridgesmoke's real-WKWebView
// harness and a driven `/Applications/Mill.app` (goal 0381,
// `.claude/skills/drive-installed-app/SKILL.md`): a check calls a
// registry command by id through the SAME two guards every real
// invoker (palette, menu, keymap) already goes through --
// findCommand + commandAvailable -- rather than a hand-rolled DOM
// query re-deriving what the command already decided.
//
// __MILL_DRIVE_BRIDGE__ is a Vite `define` (vite.config.ts), true only
// when MILL_DRIVE_BRIDGE=1 is exported before `npm run build`
// (internal/webviewbridgesmoke's own buildApp(), and a driving
// session's `MILL_DRIVE_BRIDGE=1 EXTRA_TAGS=mcp task install:app`,
// .claude/skills/drive-installed-app/SKILL.md) -- false in every other
// build, including a plain `task install:app`, so esbuild's dead-code
// elimination drops installDriveBridge's body entirely and
// window.__millRunCommand never exists in a production bundle a real
// user runs.
export interface DriveRunCommandResult {
  ok: boolean
  error?: string
}

export async function driveRunCommand(id: string, ctx?: CommandContext): Promise<DriveRunCommandResult> {
  const command = findCommand(id)
  if (!command) return { ok: false, error: `unknown command: ${id}` }
  if (!commandAvailable(command, ctx)) return { ok: false, error: `command not available: ${id}` }
  try {
    await command.run(ctx)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

declare global {
  interface Window {
    __millRunCommand?: (id: string, ctx?: CommandContext) => Promise<DriveRunCommandResult>
  }
}

export function installDriveBridge(): void {
  if (!__MILL_DRIVE_BRIDGE__) return
  window.__millRunCommand = driveRunCommand
}
