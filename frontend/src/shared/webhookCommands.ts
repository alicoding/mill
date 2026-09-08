import type { Command } from './commands'
import { useWebhookTokensStore } from './webhookTokensStore'

// The one action Settings > Connections > Webhooks offers as a
// registered command (goal 0222), same reason browserBridgeCommands.ts
// registers browser.pair: the palette, a keybinding and the button all
// reach the same effect. Minting itself needs a label first, so the
// command opens the inline label prompt rather than minting blind.
export const WEBHOOK_COMMANDS: Command[] = [
  {
    id: 'webhook.mint',
    label: 'commands.webhook.mint',
    defaultBinding: null,
    keywords: ['webhook', 'token'],
    run: () => useWebhookTokensStore.getState().startMint(),
  },
]
