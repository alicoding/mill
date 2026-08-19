import { useState } from 'react'
import { CodeEditor } from '../shared/CodeEditor'
import type { CodeEditorLanguage } from '../shared/CodeEditor'

// Commits to the canvas store on blur only, never per keystroke -- the
// same uncontrolled-until-blur convention NodeConfigFields.tsx's plain
// TextInput/Textarea fields already use (defaultValue + onBlur).
// CodeEditor itself is a controlled component (CodeMirror needs a live
// value to render), so the blur-commit boundary lives in this local
// draft state instead: committing every keystroke straight to the
// canvas store would push one zundo undo/redo entry per character,
// flooding the capped 50-entry history with a single edit session.
export function CodeConfigField({ value, language, ariaLabel, testId, placeholder, onCommit }: {
  value: string
  language: CodeEditorLanguage
  ariaLabel: string
  testId?: string
  placeholder?: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  return (
    <div
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
    >
      <CodeEditor
        value={draft}
        onChange={setDraft}
        language={language}
        ariaLabel={ariaLabel}
        testId={testId}
        placeholder={placeholder}
      />
    </div>
  )
}
