import { useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { Button, Heading, Label, type LabelProps, SkeletonBox, Stack, Text } from '@primer/react'
import { BeakerIcon, CheckCircleIcon, KeyIcon, MarkdownIcon, XCircleIcon } from '@primer/octicons-react'
import { RunbookService, HotkeyService } from '../bindings/github.com/alicoding/mill'
import type { HotkeyActivity } from '../bindings/github.com/alicoding/mill/models'
import type { Action } from '../bindings/github.com/alicoding/mill/internal/domain/runbook/models'
import { keyFromEventCode, modsFromEvent } from './keybinding'

// A fired hotkey has no other UI surface — it runs headlessly and writes
// straight to the clipboard (§2.2). Without this feed, a correctly firing
// hotkey and a silently swallowed one look identical from the UI: nothing
// visibly happens either way. Capped and in-memory only, same as the
// bindings themselves — see SPEC.md §2.2's "Hotkey fire path is logged
// end-to-end" entry.
const MAX_ACTIVITY_ENTRIES = 5

// Per-action leading icon. Falls back to KeyIcon for any future action not
// listed here rather than rendering nothing.
const ACTION_ICONS: Record<string, typeof BeakerIcon> = {
  'load-sample-html': BeakerIcon,
  'clipboard-html-to-markdown': MarkdownIcon,
}

// SPEC.md §2.2's design principle: make it visible which bindings are
// "easy reach" vs "deliberately awkward" so the user can rebalance them,
// rather than just showing the combo with no sense of how easy it is to
// press. Modifier count is a simple, defensible proxy for reach: macOS's
// own awkward-vs-easy example (screenshot vs save-to-file) differs exactly
// on how many modifiers are required.
const MOD_SYMBOLS = ['⌘', '⌃', '⇧', '⌥']

function reachTier(label: string): { text: string; variant: LabelProps['variant'] } {
  const count = [...label].filter((ch) => MOD_SYMBOLS.includes(ch)).length
  if (count <= 1) return { text: 'Easy reach', variant: 'success' }
  if (count === 2) return { text: 'Moderate', variant: 'attention' }
  return { text: 'Deliberately awkward', variant: 'danger' }
}

function RunbookView() {
  const [actions, setActions] = useState<Action[] | null>(null)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [bindingErrors, setBindingErrors] = useState<Record<string, string>>({})
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [activity, setActivity] = useState<(HotkeyActivity & { id: string; time: string })[]>([])

  useEffect(() => {
    RunbookService.List().then((list) => setActions(list ?? [])).catch(console.error)
    HotkeyService.List().then((list) => setBindings((list ?? {}) as Record<string, string>)).catch(console.error)
  }, [])

  useEffect(() => {
    return Events.On('hotkey-activity', (evt) => {
      const entry = { ...evt.data, id: crypto.randomUUID(), time: new Date().toLocaleTimeString() }
      setActivity((prev) => [entry, ...prev].slice(0, MAX_ACTIVITY_ENTRIES))
    })
  }, [])

  useEffect(() => {
    if (!recordingId) return

    const onKeydown = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }
      const key = keyFromEventCode(e.code)
      if (!key) return // modifier-only press, or an unsupported key — keep waiting
      const mods = modsFromEvent(e)
      if (mods.length === 0) return // require at least one modifier

      const actionID = recordingId
      setRecordingId(null)
      setBindingErrors((prev) => ({ ...prev, [actionID]: '' }))
      HotkeyService.Assign(actionID, mods, key)
        .then((label) => setBindings((prev) => ({ ...prev, [actionID]: label })))
        .catch((err) => setBindingErrors((prev) => ({ ...prev, [actionID]: String(err) })))
    }

    window.addEventListener('keydown', onKeydown, true)
    return () => window.removeEventListener('keydown', onKeydown, true)
  }, [recordingId])

  const run = (id: string) => {
    setRunningId(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    RunbookService.Run(id)
      .then((output) => setResults((prev) => ({ ...prev, [id]: output })))
      .catch((err) => setErrors((prev) => ({ ...prev, [id]: String(err) })))
      .finally(() => setRunningId(null))
  }

  const clearBinding = (id: string) => {
    HotkeyService.Unassign(id).then(() => {
      setBindings((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    })
  }

  return (
    <div className="runbook">
      <Heading as="h1">Runbook</Heading>
      <Text as="p" className="runbook-subtitle">
        Run an action directly, or assign it a global shortcut.
      </Text>

      {actions === null && (
        <Stack direction="vertical" gap="condensed">
          {[0, 1].map((i) => (
            <div key={i} className="runbook-card">
              <SkeletonBox height="1rem" width="40%" className="runbook-skeleton-line" />
              <SkeletonBox height="0.8rem" width="80%" />
            </div>
          ))}
        </Stack>
      )}

      {actions !== null && actions.length === 0 && (
        <div className="runbook-empty">
          <Text as="p">No actions available yet.</Text>
        </div>
      )}

      {actions !== null && actions.length > 0 && (
        <Stack direction="vertical" gap="condensed">
          {actions.map((action) => {
            const Icon = ACTION_ICONS[action.ID] ?? KeyIcon
            return (
              <div key={action.ID} className="runbook-card">
                <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                  <Stack direction="horizontal" gap="condensed" align="start">
                    <span className="runbook-icon"><Icon size={16} /></span>
                    <div>
                      <Heading as="h2" variant="small">{action.Name}</Heading>
                      <Text size="small" className="runbook-muted">{action.Description}</Text>
                    </div>
                  </Stack>

                  <Stack direction="horizontal" align="center" gap="condensed" className="runbook-item-controls">
                    <Button onClick={() => run(action.ID)} disabled={runningId === action.ID} size="small">
                      {runningId === action.ID ? 'Running…' : 'Run'}
                    </Button>

                    {recordingId === action.ID ? (
                      <Text size="small" className="runbook-recording">Press a combo… (Esc to cancel)</Text>
                    ) : bindings[action.ID] ? (
                      <>
                        <Label variant="secondary">
                          <KeyIcon size={12} /> {bindings[action.ID]}
                        </Label>
                        <Label variant={reachTier(bindings[action.ID]).variant} size="small">
                          {reachTier(bindings[action.ID]).text}
                        </Label>
                        <Button size="small" variant="invisible" onClick={() => setRecordingId(action.ID)}>Change</Button>
                        <Button size="small" variant="invisible" onClick={() => clearBinding(action.ID)}>Clear</Button>
                      </>
                    ) : (
                      <Button size="small" variant="invisible" onClick={() => setRecordingId(action.ID)}>
                        Set shortcut
                      </Button>
                    )}
                  </Stack>
                </Stack>

                {bindingErrors[action.ID] && (
                  <Text as="p" size="small" className="runbook-error">{bindingErrors[action.ID]}</Text>
                )}
                {errors[action.ID] && (
                  <Text as="p" size="small" className="runbook-error">{errors[action.ID]}</Text>
                )}
                {results[action.ID] !== undefined && !errors[action.ID] && (
                  <pre className="runbook-result">{results[action.ID]}</pre>
                )}
              </div>
            )
          })}
        </Stack>
      )}

      {activity.length > 0 && (
        <>
          <Heading as="h2" variant="small" className="runbook-activity-heading">Recent activity</Heading>
          <Text as="p" size="small" className="runbook-muted runbook-subtitle">
            What fired hotkeys actually did — hotkey triggers run headlessly with no other feedback.
          </Text>
          <Stack direction="vertical" gap="condensed">
            {activity.map((entry) => (
              <Stack key={entry.id} direction="horizontal" align="center" gap="condensed" className="runbook-activity-row">
                {entry.success ? (
                  <CheckCircleIcon size={16} fill="var(--fgColor-success)" />
                ) : (
                  <XCircleIcon size={16} fill="var(--fgColor-danger)" />
                )}
                <Text size="small" className="runbook-muted">{entry.time}</Text>
                <Label variant="secondary" size="small">{entry.binding}</Label>
                <Text size="small">{actionName(actions, entry.actionID)}</Text>
                <Text size="small" className="runbook-muted">— {entry.detail}</Text>
              </Stack>
            ))}
          </Stack>
        </>
      )}
    </div>
  )
}

function actionName(actions: Action[] | null, actionID: string): string {
  return actions?.find((a) => a.ID === actionID)?.Name ?? actionID
}

export default RunbookView
