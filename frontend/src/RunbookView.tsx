import { useEffect, useState } from 'react'
import { RunbookService, HotkeyService } from '../bindings/changeme'
import type { Action } from '../bindings/changeme/models'

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
      <h1>Runbook</h1>
      <p className="runbook-subtitle">Run an action directly, or assign it a global shortcut.</p>
      <ul className="runbook-list">
        {actions.map((action) => (
          <li key={action.ID} className="runbook-item">
            <div className="runbook-item-header">
              <div>
                <h2>{action.Name}</h2>
                <p>{action.Description}</p>
              </div>
              <div className="runbook-item-controls">
                <button onClick={() => run(action.ID)} disabled={runningId === action.ID}>
                  {runningId === action.ID ? 'Running…' : 'Run'}
                </button>
                {recordingId === action.ID ? (
                  <span className="runbook-recording">Press a combo… (Esc to cancel)</span>
                ) : bindings[action.ID] ? (
                  <span className="runbook-shortcut">
                    <kbd>{bindings[action.ID]}</kbd>
                    <button className="runbook-shortcut-edit" onClick={() => setRecordingId(action.ID)}>Change</button>
                    <button className="runbook-shortcut-clear" onClick={() => clearBinding(action.ID)}>Clear</button>
                  </span>
                ) : (
                  <button className="runbook-shortcut-set" onClick={() => setRecordingId(action.ID)}>
                    Set shortcut
                  </button>
                )}
              </div>
            </div>
            {bindingErrors[action.ID] && <pre className="runbook-error">{bindingErrors[action.ID]}</pre>}
            {errors[action.ID] && <pre className="runbook-error">{errors[action.ID]}</pre>}
            {results[action.ID] !== undefined && !errors[action.ID] && (
              <pre className="runbook-result">{results[action.ID]}</pre>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default RunbookView
