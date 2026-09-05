import type { Command } from './commands'
import { useBrowserBridgeStore } from './browserBridgeStore'

// The two actions Settings > Connections > Browsers offers, registered
// rather than wired inline, so the palette, a keybinding and the button
// all reach the same effect with the same enablement.
export const BROWSER_BRIDGE_COMMANDS: Command[] = [
  {
    id: 'browser.pair',
    label: 'commands.browser.pair',
    defaultBinding: null,
    keywords: ['browser', 'extension', 'pair'],
    run: () => useBrowserBridgeStore.getState().pair(),
  },
  {
    id: 'browser.test',
    label: 'commands.browser.test',
    defaultBinding: null,
    keywords: ['browser', 'extension', 'connection'],
    // Honest, not decorative: with nothing listening the test can only
    // report the same "no browser is connected" it already shows, and a
    // test already in flight has nothing to start.
    enabled: () => {
      const { status, test } = useBrowserBridgeStore.getState()
      return status?.connected === true && test !== 'running'
    },
    run: () => useBrowserBridgeStore.getState().runTest(),
  },
]
