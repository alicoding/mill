import { useEffect, useRef, useState } from 'react'
import { Button, FormControl, Heading, IconButton, Stack, Text, TextInput } from '@primer/react'
import { DownloadIcon, PlusIcon, TrashIcon, UploadIcon } from '@primer/octicons-react'
import { ConfigureService } from '../../bindings/github.com/alicoding/mill'
import type { MCPServer } from '../../bindings/github.com/alicoding/mill/internal/domain/mcpserver/models'
import type { Tool } from '../../bindings/github.com/alicoding/mill/internal/adapters/mcpclient/models'
import { downloadJSON } from '../shared/downloadJSON'
import styles from '../shared/ListCard.module.css'

function argsToRows(args: string[] | null | undefined): string[] {
  return args && args.length > 0 ? args : ['']
}

// Configure's MCP Servers section (docs/SPEC.md §3.6): CRUD over
// ConfigureService's MCPServers, each a reusable stdio connection an
// mcp-tool-call node resolves by ID. The "List tools" button is this
// feature's actual discoverability value -- a user finds the exact
// toolName (and its expected arguments, from the raw InputSchema) to
// paste into a workflow node here, not by guessing.
export function ConfigureMCPServers() {
  const [servers, setServers] = useState<MCPServer[] | null>(null)
  const [editingID, setEditingID] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [command, setCommand] = useState('')
  const [argRows, setArgRows] = useState<string[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [error, setError] = useState('')
  const [toolsByServer, setToolsByServer] = useState<Record<string, Tool[] | string>>({})
  const [importError, setImportError] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const refetch = () => {
    ConfigureService.MCPServers().then((list) => setServers(list ?? [])).catch(console.error)
  }

  const exportServer = (id: string, label: string) => {
    ConfigureService.ExportMCPServer(id)
      .then((json) => downloadJSON(`${label.trim() || 'mcp-server'}.json`, json))
      .catch((err) => setImportError(String(err)))
  }

  const openImportPicker = () => {
    setImportError(null)
    importInputRef.current?.click()
  }

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    file.text()
      .then((text) => ConfigureService.ImportMCPServer(text))
      .then(() => { setImportError(null); refetch() })
      .catch((err) => setImportError(String(err)))
  }

  useEffect(refetch, [])

  const startCreate = () => {
    setEditingID(null)
    setLabel('')
    setCommand('')
    setArgRows([''])
    setFormOpen(true)
    setError('')
  }

  const startEdit = (s: MCPServer) => {
    setEditingID(s.ID)
    setLabel(s.Label)
    setCommand(s.Command)
    setArgRows(argsToRows(s.Args))
    setFormOpen(true)
    setError('')
  }

  const save = async () => {
    setError('')
    try {
      const args = argRows.map((a) => a.trim()).filter(Boolean)
      if (editingID) {
        await ConfigureService.UpdateMCPServer(editingID, label, command, args)
      } else {
        await ConfigureService.CreateMCPServer(label, command, args)
      }
      setFormOpen(false)
      refetch()
    } catch (err) {
      setError(String(err))
    }
  }

  const remove = (id: string) => {
    ConfigureService.DeleteMCPServer(id).then(refetch).catch(console.error)
  }

  const listTools = (id: string) => {
    ConfigureService.ListMCPServerTools(id)
      .then((tools) => setToolsByServer((prev) => ({ ...prev, [id]: tools ?? [] })))
      .catch((err) => setToolsByServer((prev) => ({ ...prev, [id]: String(err) })))
  }

  const updateArgRow = (i: number, value: string) => {
    setArgRows((prev) => prev.map((a, idx) => (idx === i ? value : a)))
  }

  return (
    <div className={styles.page} data-testid="configure-mcpservers">
      <Stack direction="horizontal" justify="space-between" align="center" className={styles.sectionHeading}>
        <Heading as="h2" variant="small">MCP Servers</Heading>
        <Stack direction="horizontal" gap="condensed">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            data-testid="import-mcpserver-input"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <Button leadingVisual={UploadIcon} size="small" onClick={openImportPicker} data-testid="import-mcpserver">
            Import
          </Button>
          <Button leadingVisual={PlusIcon} size="small" onClick={startCreate} data-testid="new-mcpserver">
            New MCP server
          </Button>
        </Stack>
      </Stack>
      {importError && (
        <Text as="p" size="small" className={styles.error} data-testid="import-mcpserver-error">{importError}</Text>
      )}

      {formOpen && (
        <div className={styles.card}>
          <Stack direction="vertical" gap="condensed">
            <FormControl>
              <FormControl.Label>Label</FormControl.Label>
              <TextInput value={label} onChange={(e) => setLabel(e.target.value)} block />
            </FormControl>
            <FormControl>
              <FormControl.Label>Command</FormControl.Label>
              <FormControl.Caption>Run over stdio, e.g. a locally installed MCP server binary.</FormControl.Caption>
              <TextInput value={command} onChange={(e) => setCommand(e.target.value)} placeholder="my-mcp-server" block />
            </FormControl>
            <Text size="small" weight="semibold">Arguments</Text>
            {argRows.map((arg, i) => (
              <Stack key={i} direction="horizontal" gap="condensed" align="center">
                <TextInput placeholder="--flag" value={arg} onChange={(e) => updateArgRow(i, e.target.value)} />
                <IconButton
                  icon={TrashIcon}
                  aria-label="Remove argument"
                  size="small"
                  variant="invisible"
                  onClick={() => setArgRows((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </Stack>
            ))}
            <Button size="small" variant="invisible" onClick={() => setArgRows((prev) => [...prev, ''])}>
              Add argument
            </Button>
            {error && <Text as="p" size="small" className={styles.error}>{error}</Text>}
            <Stack direction="horizontal" gap="condensed">
              <Button variant="primary" size="small" onClick={save}>Save MCP server</Button>
              <Button size="small" variant="invisible" onClick={() => setFormOpen(false)}>Cancel</Button>
            </Stack>
          </Stack>
        </div>
      )}

      {servers === null && <Text as="p" className={styles.muted}>Loading…</Text>}
      {servers !== null && servers.length === 0 && !formOpen && (
        <Text as="p" className={styles.muted}>No MCP servers yet.</Text>
      )}
      {servers !== null && (
        <Stack direction="vertical" gap="condensed">
          {servers.map((s) => (
            <div key={s.ID} className={styles.card} data-testid="mcpserver-row">
              <Stack direction="horizontal" justify="space-between" align="start" gap="normal">
                <div>
                  <Text weight="semibold">{s.Label}</Text>
                  <Text as="p" size="small" className={styles.muted}>
                    {s.Command} {(s.Args ?? []).join(' ')}
                  </Text>
                  <Text as="p" size="small" className={styles.muted}>ID: {s.ID}</Text>
                </div>
                <Stack direction="horizontal" gap="condensed">
                  <Button size="small" variant="invisible" onClick={() => listTools(s.ID)} data-testid="list-tools">
                    List tools
                  </Button>
                  <Button size="small" variant="invisible" onClick={() => startEdit(s)}>Edit</Button>
                  <IconButton
                    icon={DownloadIcon}
                    aria-label={`Export ${s.Label}`}
                    size="small"
                    variant="invisible"
                    onClick={() => exportServer(s.ID, s.Label)}
                  />
                  <IconButton icon={TrashIcon} aria-label={`Delete ${s.Label}`} size="small" variant="invisible" onClick={() => remove(s.ID)} />
                </Stack>
              </Stack>

              {toolsByServer[s.ID] !== undefined && (
                <div data-testid="mcpserver-tools">
                  {typeof toolsByServer[s.ID] === 'string' ? (
                    <Text as="p" size="small" className={styles.error}>{toolsByServer[s.ID] as string}</Text>
                  ) : (toolsByServer[s.ID] as Tool[]).length === 0 ? (
                    <Text as="p" size="small" className={styles.muted}>This server exposes no tools.</Text>
                  ) : (
                    <Stack direction="vertical" gap="condensed">
                      {(toolsByServer[s.ID] as Tool[]).map((tool) => (
                        <div key={tool.Name}>
                          <Text weight="semibold" size="small">{tool.Name}</Text>
                          <Text as="p" size="small" className={styles.muted}>{tool.Description}</Text>
                          <pre className={styles.result}>{JSON.stringify(tool.InputSchema, null, 2)}</pre>
                        </div>
                      ))}
                    </Stack>
                  )}
                </div>
              )}
            </div>
          ))}
        </Stack>
      )}
    </div>
  )
}
