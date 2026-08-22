import { useRef, useState } from 'react'
import { downloadJSON } from '../shared/downloadJSON'
import { useImportConfirm } from '../shared/useImportConfirm'

// Export/import wiring shared by every Configure entity page: a
// payload whose id matches an entity already present updates it in
// place instead of creating a new one -- confirmed first via
// useImportConfirm, naming the entity it will replace. One hook
// instead of each page re-declaring the same file-input ref, error
// state, and export/import handlers.
export function useEntityImportExport<T extends { ID: string; Label: string }>({
  existing, exportEntity, importEntity, onImported, filenameFallback,
}: {
  existing: T[]
  exportEntity: (id: string) => Promise<string>
  importEntity: (jsonText: string) => Promise<unknown>
  onImported: () => void
  filenameFallback: string
}) {
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const exportItem = (id: string, label: string) => {
    exportEntity(id)
      .then((json) => downloadJSON(`${label.trim() || filenameFallback}.json`, json))
      .catch((err) => setImportError(String(err)))
  }

  const openImportPicker = () => {
    setImportError(null)
    importInputRef.current?.click()
  }

  const runImport = (text: string) => {
    importEntity(text)
      .then(() => { setImportError(null); onImported() })
      .catch((err) => setImportError(String(err)))
  }
  const importConfirm = useImportConfirm({ existing, onImport: runImport })

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text().then(importConfirm.requestImport).catch((err) => setImportError(String(err)))
  }

  return { importError, setImportError, importInputRef, exportItem, openImportPicker, handleImportFile, importConfirm }
}
