import { useEffect, useState } from 'react'
import { Button, Heading, Label, Stack, Text } from '@primer/react'
import { RunbookService, HotkeyService } from '../bindings/github.com/alicoding/mill'
import type { Action } from '../bindings/github.com/alicoding/mill/models'

// Physical-key-position based, so the recorder doesn't care about Shift state.
// event.code is "KeyM" / "Digit1" / "Space" — this strips the prefix.
function keyFromEventCode(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Space') return 'Space'
  return null
}

function modsFromEvent(e: KeyboardEvent): string[] {
  const mods: string[] = []
  if (e.metaKey) mods.push('cmd')
  if (e.ctrlKey) mods.push('ctrl')
  if (e.shiftKey) mods.push('shift')
  if (e.altKey) mods.push('option')
  return mods
}

function RunbookView() {
  const [actions, setActions] = useState<Action[]>([])
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [bindingErrors, setBindingErrors] = useState<Record<string, string>>({})
  const [recordingId, setRecordingId] = useState<string | null>(null)

  useEffect(() => {
    RunbookService.List().then((list) => setActions(list ?? [])).catch(console.error)
    HotkeyService.List().then((list) => setBindings((list ?? {}) as Record<string, string>)).catch(console.error)
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

      <Stack direction="vertical" gap="condensed">
        {actions.map((action) => (
          <div key={action.ID} className="runbook-card">
            <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
              <div>
                <Heading as="h2" variant="small">{action.Name}</Heading>
                <Text size="small" className="runbook-muted">{action.Description}</Text>
              </div>

              <Stack direction="horizontal" align="center" gap="condensed" className="runbook-item-controls">
                <Button onClick={() => run(action.ID)} disabled={runningId === action.ID} size="small">
                  {runningId === action.ID ? 'Running…' : 'Run'}
                </Button>

                {recordingId === action.ID ? (
                  <Text size="small" className="runbook-recording">Press a combo… (Esc to cancel)</Text>
                ) : bindings[action.ID] ? (
                  <>
                    <Label variant="secondary">{bindings[action.ID]}</Label>
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
        ))}
      </Stack>
    </div>
  )
}

export default RunbookView
