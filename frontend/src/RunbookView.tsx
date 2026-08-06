import { useEffect, useState } from 'react'
import { RunbookService } from '../bindings/changeme'
import type { Action } from '../bindings/changeme/models'

function RunbookView() {
  const [actions, setActions] = useState<Action[]>([])
  const [runningId, setRunningId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    RunbookService.List().then((list) => setActions(list ?? [])).catch(console.error)
  }, [])

  const run = (id: string) => {
    setRunningId(id)
    setErrors((prev) => ({ ...prev, [id]: '' }))
    RunbookService.Run(id)
      .then((output) => setResults((prev) => ({ ...prev, [id]: output })))
      .catch((err) => setErrors((prev) => ({ ...prev, [id]: String(err) })))
      .finally(() => setRunningId(null))
  }

  return (
    <div className="runbook">
      <h1>Runbook</h1>
      <p className="runbook-subtitle">Actions you can run directly — no hotkey required yet.</p>
      <ul className="runbook-list">
        {actions.map((action) => (
          <li key={action.ID} className="runbook-item">
            <div className="runbook-item-header">
              <div>
                <h2>{action.Name}</h2>
                <p>{action.Description}</p>
              </div>
              <button onClick={() => run(action.ID)} disabled={runningId === action.ID}>
                {runningId === action.ID ? 'Running…' : 'Run'}
              </button>
            </div>
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
