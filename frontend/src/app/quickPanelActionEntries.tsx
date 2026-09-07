import type { ElementType, ReactNode } from 'react'
import { CounterLabel } from '@primer/react'
import { CommandPaletteIcon, CopyIcon, GearIcon, HomeIcon, PlayIcon, SearchIcon } from '@primer/octicons-react'
import { commandLabel, findCommand, runCommand } from '../shared/commands'
import { quickPanelRowIds } from '../shared/quickPanelCommands'
import type { Card, Kind } from '../../bindings/github.com/alicoding/mill/internal/domain/atlas/models'
import type { HTTPRequest } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import type { List } from '../../bindings/github.com/alicoding/mill/internal/domain/list/models'
import type { MCPServer } from '../../bindings/github.com/alicoding/mill/internal/domain/mcpserver/models'
import type { Decision } from '../../bindings/github.com/alicoding/mill/internal/domain/decision/models'
import type { ExecEnv } from '../../bindings/github.com/alicoding/mill/internal/domain/execenv/models'
import type { AIProvider } from '../../bindings/github.com/alicoding/mill/internal/domain/aiprovider/models'
import type { DeclaredStepType } from '../../bindings/github.com/alicoding/mill/internal/domain/declaredsteptype/models'
import { ENTITY_ICON } from '../shared/entityIcons'
import type { PaletteSearchable } from './paletteFilter'
import { CAPABILITY_ICON } from './navIcon'
import { HotkeyHint } from '../shared/HotkeyHint'

// Split out of QuickPanel.tsx (architecture.md's 500-line convention)
// along the real seam between the two entry kinds the panel renders:
// workflow rows (QuickPanel.tsx's own useMemo, needs per-row pin/
// hotkey-chip state) versus these Configure-jump + fixed-action rows,
// which are pure derivations from already-fetched entity lists and a
// handful of stable callbacks -- no hook state of their own.

export type PanelGroupId = 'workflows' | 'configure' | 'atlas' | 'actions'

export interface PanelEntry extends PaletteSearchable {
  id: string
  groupId: PanelGroupId
  text: string
  description?: string
  leadingVisual: ElementType
  trailingVisual?: ReactNode
  run: () => void
}

// docs/goals/0015-summon-quick-invoke.md's remainder, items 2/3: the
// Configure-entity jump rows (connectors/Lists/MCP Servers, each
// landing the main window on its own tab) plus the panel's fixed
// action rows (Open Mill, Open Settings, Review with its live pending
// count, Apply-from-clipboard). t is react-i18next's translator;
// jumpToConfigure/openMain/applyFromClipboard are QuickPanel.tsx's own
// stable callbacks, passed through rather than reimplemented here.
export function buildConfigureAndActionEntries(params: {
  t: (key: string, opts?: Record<string, unknown>) => string
  requests: HTTPRequest[] | null | undefined
  lists: List[] | null | undefined
  mcpServers: MCPServer[] | null | undefined
  decisions: Decision[] | null | undefined
  execEnvs: ExecEnv[] | null | undefined
  aiProviders: AIProvider[] | null | undefined
  declaredStepTypes: DeclaredStepType[] | null | undefined
  atlasCards: Card[] | null | undefined
  atlasKinds: Kind[] | null | undefined
  reviewPendingCount: number
  jumpToConfigure: (tab: string) => void
  jumpToAtlasCard: (cardID: string) => void
  openMain: (view: string) => void
  applyFromClipboard: () => void
  runCodingLoopFromClipboard: () => void
}): PanelEntry[] {
  const {
    t, requests, lists, mcpServers, decisions, execEnvs, aiProviders, declaredStepTypes,
    atlasCards, atlasKinds, reviewPendingCount, jumpToConfigure, jumpToAtlasCard, openMain, applyFromClipboard,
    runCodingLoopFromClipboard,
  } = params
  const entries: PanelEntry[] = []
  const atlasKindByID = new Map((atlasKinds ?? []).map((k) => [k.ID, k]))

  for (const req of requests ?? []) {
    entries.push({
      id: `configure:integration:${req.ID}`,
      groupId: 'configure',
      text: req.Label,
      description: t('quickPanel.entries.jumpToIntegration'),
      searchText: req.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.request.Icon,
      run: () => jumpToConfigure('integration'),
    })
  }
  for (const list of lists ?? []) {
    entries.push({
      id: `configure:lists:${list.ID}`,
      groupId: 'configure',
      text: list.Label,
      description: t('quickPanel.entries.jumpToLists'),
      searchText: list.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.list.Icon,
      run: () => jumpToConfigure('lists'),
    })
  }
  for (const server of mcpServers ?? []) {
    entries.push({
      id: `configure:mcpservers:${server.ID}`,
      groupId: 'configure',
      text: server.Label,
      description: t('quickPanel.entries.jumpToMcpServers'),
      searchText: server.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.mcpserver.Icon,
      run: () => jumpToConfigure('mcpservers'),
    })
  }
  // Quick-access parity sweep (goal 0071 G5): the same jump-row pattern
  // extended to Configure's remaining reusable entity kinds. Attributes
  // is deliberately excluded -- its rows ARE existing workflows
  // (ConfigureAttributes.tsx's own doc comment), already searchable/
  // runnable as their own 'workflows' group rows above; jumpToConfigure
  // only lands on the TAB (never a selected row), so a per-workflow
  // "jump to Attributes" row would just be N identical-outcome
  // duplicates of information already in this panel.
  for (const decision of decisions ?? []) {
    entries.push({
      id: `configure:decisions:${decision.ID}`,
      groupId: 'configure',
      text: decision.Label,
      description: t('quickPanel.entries.jumpToDecisions'),
      searchText: decision.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.decision.Icon,
      run: () => jumpToConfigure('decisions'),
    })
  }
  for (const env of execEnvs ?? []) {
    entries.push({
      id: `configure:execenvs:${env.ID}`,
      groupId: 'configure',
      text: env.Label,
      description: t('quickPanel.entries.jumpToExecEnvs'),
      searchText: env.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.execenv.Icon,
      run: () => jumpToConfigure('execenvs'),
    })
  }
  for (const provider of aiProviders ?? []) {
    entries.push({
      id: `configure:aiproviders:${provider.ID}`,
      groupId: 'configure',
      text: provider.Label,
      description: t('quickPanel.entries.jumpToAiProviders'),
      searchText: provider.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.aiprovider.Icon,
      run: () => jumpToConfigure('aiproviders'),
    })
  }
  for (const stepType of declaredStepTypes ?? []) {
    entries.push({
      id: `configure:steptypes:${stepType.ID}`,
      groupId: 'configure',
      text: stepType.Label,
      description: t('quickPanel.entries.jumpToStepTypes'),
      searchText: stepType.Label.toLowerCase(),
      leadingVisual: ENTITY_ICON.steptype.Icon,
      run: () => jumpToConfigure('steptypes'),
    })
  }

  // Atlas card search (docs/goals/0061 item 6, ADR-0038): search is the
  // door into a space -- selecting a row opens the main window on the
  // Atlas surface already drilled to the card's parent, with the card's
  // own overlay open (App.tsx's useMillNavigate parses 'atlas:<cardID>').
  for (const card of atlasCards ?? []) {
    const kind = atlasKindByID.get(card.KindID)
    entries.push({
      id: `atlas:${card.ID}`,
      groupId: 'atlas',
      text: card.Title,
      description: kind ? t('quickPanel.entries.jumpToAtlasCard', { kind: kind.Label }) : undefined,
      searchText: card.Title.toLowerCase(),
      leadingVisual: CAPABILITY_ICON['capability-atlas'],
      run: () => jumpToAtlasCard(card.ID),
    })
  }

  entries.push(...buildActionRows({ t, reviewPendingCount, openMain, applyFromClipboard, runCodingLoopFromClipboard }))

  return entries
}

// The panel's action rows now derive from the command registry (goal
// 0222 S2: "the Quick Panel derives its action rows from the command
// registry") instead of a hand-curated list -- a command stops
// appearing here the SAME way it stops appearing in the palette
// (app/CommandPalette.tsx's own isCommandAvailable), by failing its own
// enabled() rather than a second, drifting membership list.
//
// The four ids shared/quickPanelCommands.ts's QUICK_PANEL_RICH_ROW_ORDER
// names get bespoke presentation (richRows below): each either needs a
// panel-specific run() -- the registry's own run() assumes the MAIN
// window (settings.open/view.review call setView; panel.applyClipboard's
// run() just reopens THIS window, not the actual apply flow) -- or
// bespoke copy/visuals (Review's live pending-count badge) the generic
// fallback can't supply. Any OTHER `quickPanel: true` command (the
// update pipeline) renders through that fallback, same shape
// CommandPalette.tsx's own commandEntry uses for an ordinary command.
function buildActionRows(params: {
  t: (key: string, opts?: Record<string, unknown>) => string
  reviewPendingCount: number
  openMain: (view: string) => void
  applyFromClipboard: () => void
  runCodingLoopFromClipboard: () => void
}): PanelEntry[] {
  const { t, reviewPendingCount, openMain, applyFromClipboard, runCodingLoopFromClipboard } = params

  const richRows: Record<string, () => PanelEntry> = {
    'panel.openMill': () => ({
      id: 'cmd:panel.openMill',
      groupId: 'actions',
      text: t('quickPanel.entries.openMill'),
      searchText: 'open mill window',
      leadingVisual: HomeIcon,
      run: () => openMain(''),
    }),
    'settings.open': () => ({
      id: 'cmd:settings.open',
      groupId: 'actions',
      text: t('quickPanel.entries.openSettings'),
      searchText: 'open settings preferences',
      leadingVisual: GearIcon,
      // HotkeyHint (app/HotkeyHint.tsx) reads settings.open's live
      // effective binding (shared/commands.ts + any Settings override) --
      // never a hardcoded combo that could silently go stale on a rebind.
      trailingVisual: <HotkeyHint commandId="settings.open" />,
      run: () => openMain('settings'),
    }),
    // Always present (unblock-yourself-in-place -- a real jump target
    // even at zero), badged with the live count once non-zero.
    'view.review': () => ({
      id: 'cmd:view.review',
      groupId: 'actions',
      text: t('quickPanel.entries.review'),
      description: reviewPendingCount > 0 ? t('quickPanel.entries.reviewPendingDescription', { count: reviewPendingCount }) : t('quickPanel.entries.reviewNoPending'),
      searchText: 'review pending approval guardrail mcp write',
      leadingVisual: CAPABILITY_ICON['capability-review'],
      trailingVisual: reviewPendingCount > 0 ? (
        <CounterLabel data-testid="quick-panel-review-count" aria-label={t('reviewPendingAriaLabel', { count: reviewPendingCount })}>
          {reviewPendingCount}
        </CounterLabel>
      ) : undefined,
      run: () => openMain('review'),
    }),
    // docs/goals/0039: always present, same unblock-yourself-in-place
    // reasoning as Review above -- clipboard+hotkey is the fallback path
    // into Mill when MCP itself is unavailable (a locked-down enterprise
    // environment). trailingVisual shows panel.applyClipboard's bound key
    // once the user rebinds it (shared/commands.ts's defaultBinding is
    // null); HotkeyHint renders nothing until then.
    'panel.applyClipboard': () => ({
      id: 'cmd:panel.applyClipboard',
      groupId: 'actions',
      text: t('quickPanel.entries.applyFromClipboard'),
      description: t('quickPanel.entries.applyFromClipboardDescription'),
      searchText: 'apply from clipboard import paste workflow export',
      leadingVisual: CopyIcon,
      trailingVisual: <HotkeyHint commandId="panel.applyClipboard" />,
      run: applyFromClipboard,
    }),
    // goal 0367: the registry run() assumes the main window (setView),
    // so the panel's own row navigates there instead, with the scan
    // dialog opened once the Sources section lands.
    'secrets.findDotenvFiles': () => ({
      id: 'cmd:secrets.findDotenvFiles',
      groupId: 'actions',
      text: commandLabel(findCommand('secrets.findDotenvFiles')!),
      searchText: 'find dotenv env files scan folder sources',
      leadingVisual: SearchIcon,
      run: () => openMain('secrets:dotenv-scan'),
    }),
    // docs/goals/0240 S1: always present, same unblock-yourself-in-place
    // reasoning as panel.applyClipboard above -- this IS the away-from-
    // app entry point the goal exists to fix (a hotkey summon opens
    // this panel while another app is frontmost). run() reads the
    // clipboard and opens the Confirm screen, never running anything
    // without it.
    'codingLoop.run': () => ({
      id: 'cmd:codingLoop.run',
      groupId: 'actions',
      text: t('quickPanel.entries.runCodingLoop'),
      description: t('quickPanel.entries.runCodingLoopDescription'),
      searchText: 'run copied command shell terminal execute',
      leadingVisual: PlayIcon,
      trailingVisual: <HotkeyHint commandId="codingLoop.run" />,
      run: runCodingLoopFromClipboard,
    }),
  }

  // Membership + order come from the pure, JSX-free
  // shared/quickPanelCommands.ts (its own file so the filtering logic
  // stays unit-testable, see that module's header comment) -- this loop
  // only decides HOW to render each id, rich presentation above or the
  // generic fallback (any other quickPanel command, e.g. the update
  // pipeline), same fields CommandPalette.tsx's own commandEntry
  // renders a plain command with.
  const rows: PanelEntry[] = []
  for (const id of quickPanelRowIds()) {
    const rich = richRows[id]
    if (rich) { rows.push(rich()); continue }
    const command = findCommand(id)
    if (!command) continue
    rows.push({
      id: `cmd:${command.id}`,
      groupId: 'actions',
      text: commandLabel(command),
      searchText: commandLabel(command).toLowerCase(),
      keywords: command.keywords,
      leadingVisual: CommandPaletteIcon,
      trailingVisual: <HotkeyHint commandId={command.id} />,
      run: () => { void runCommand(command.id) },
    })
  }
  return rows
}
