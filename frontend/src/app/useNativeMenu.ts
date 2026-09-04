import { useEffect } from 'react'
import { Events } from '@wailsio/runtime'
import { runCommand } from '../shared/commands'
import { startNativeMenu } from '../shared/menuBridge'

// The native menu bar's one entry point into the app (goal 0332).
// Choosing a menu item emits the id of the command it stands for and
// nothing else -- this is the single place that turns an id back into
// an action, exactly the way the keydown dispatcher does, so a menu
// item and its keyboard shortcut can never drift into doing different
// things.
//
// Mounted from App.tsx beside useKeymapDispatch, after the plugin-load
// gate that main.tsx's bootstrap() holds the first render behind: every
// plugin-contributed command is already in the registry by the time the
// menu is projected.
export function useNativeMenu(): void {
  useEffect(() => {
    const off = Events.On('menu:command', (event) => {
      const id = (event.data as { ID?: string } | undefined)?.ID
      if (!id) return
      // A disabled item is inert natively, so reaching here means the
      // menu believed the action was available; re-checking would only
      // race the state the menu was last told about -- runCommand
      // rechecks anyway and no-ops if it lost that race.
      void runCommand(id)
    })
    const stop = startNativeMenu()
    return () => {
      off()
      stop()
    }
  }, [])
}
