// @vitest-environment jsdom
import { act, type ReactNode, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import configure from '../locales/en/configure.json'
import { AuthType } from '../../bindings/github.com/alicoding/mill/internal/domain/httprequest/models'
import { RequestTestPanel, type RequestTestPanelHandle } from './RequestTestPanel'

// goal 0370 S2: proves the no-schema path directly -- an enabled Test
// click on a draft with nothing but a method and a URL must send a
// real request through TestHTTPRequestOperation (never no-op) and
// render the result pane, with the schema hint demoted to a caption
// rather than a gate blocking the panel. Component-level (not e2e)
// so the exact request TestHTTPRequestOperation receives is asserted
// directly, not inferred from a rendered log entry.

// @primer/react pulls in its own stylesheet at import, which the node
// test runtime cannot load (NavRail.test.tsx/PluginFrame.test.tsx
// carry the same stand-in) -- these keep the same slot shape
// (label, select, button, text) so what's asserted is this
// component's own logic, not the kit's markup.
type Props = Record<string, unknown> & { children?: ReactNode }
vi.mock('@primer/react', () => {
  const strip = (rest: Props) => {
    const attrs = { ...rest }
    delete attrs.leadingVisual
    delete attrs.variant
    delete attrs.size
    delete attrs.block
    delete attrs.align
    delete attrs.justify
    delete attrs.direction
    delete attrs.gap
    delete attrs.weight
    return attrs
  }
  const Stack = ({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>
  const Text = ({ children, ...rest }: Props) => <span {...strip(rest)}>{children}</span>
  const Label = ({ children, ...rest }: Props) => <span {...strip(rest)}>{children}</span>
  const Button = ({ children, ...rest }: Props) => <button {...strip(rest)}>{children}</button>
  const IconButton = ({ children, ...rest }: Props) => <button {...strip(rest)}>{children}</button>
  const TextInput = (rest: Props) => <input {...strip(rest)} />
  const Textarea = (rest: Props) => <textarea {...strip(rest)} />
  const FormControlLabel = ({ children, ...rest }: Props) => <label {...strip(rest)}>{children}</label>
  const FormControl = Object.assign(({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>, { Label: FormControlLabel })
  const SelectOption = ({ children, ...rest }: Props) => <option {...strip(rest)}>{children}</option>
  const Select = Object.assign(({ children, ...rest }: Props) => <select {...strip(rest)}>{children}</select>, { Option: SelectOption })
  const SegmentedControlButton = ({ children, ...rest }: Props) => <button {...strip(rest)}>{children}</button>
  const SegmentedControl = Object.assign(({ children, ...rest }: Props) => <div {...strip(rest)}>{children}</div>, { Button: SegmentedControlButton })
  return { Stack, Text, Label, Button, IconButton, TextInput, Textarea, FormControl, Select, SegmentedControl }
})

// Resolves the real English strings from configure.json (same pattern
// openapiSynth.test.ts uses for a non-component file) rather than
// pulling react-i18next's provider machinery into this test, and
// catches a copy regression the same way a snapshot of the rendered
// text would.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars: Record<string, unknown> = {}) => {
      const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], configure)
      if (typeof value !== 'string') return key
      return value.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars[name] ?? ''))
    },
  }),
}))

// The response viewer's own rendering (syntax highlighting, view
// switching) is OutputViewer.tsx's own tested concern -- this stand-in
// keeps the same value/testId slot so what's asserted here is that
// RequestTestPanel handed it the real response, not how it's drawn.
vi.mock('../shared/OutputViewer', () => ({
  OutputViewer: ({ value, testId }: { value: string; testId?: string }) => <div data-testid={testId}>{value}</div>,
}))

const testHTTPRequestOperation = vi.fn()
vi.mock('../shared/bindings', () => ({
  ConfigureService: { TestHTTPRequestOperation: (...args: unknown[]) => testHTTPRequestOperation(...args) },
}))

describe('RequestTestPanel -- the no-schema path (goal 0370 S2)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    testHTTPRequestOperation.mockReset()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function panel() {
    return container.querySelector('[data-testid="request-test-panel"]')
  }

  it('sends the implicit method+URL operation and renders the result, with the schema hint as a caption underneath', async () => {
    testHTTPRequestOperation.mockResolvedValue({
      StatusCode: 200, Body: '{"ok":true}', Headers: { 'Content-Type': 'application/json' }, Error: '', DurationMs: 12,
    })

    const ref = createRef<RequestTestPanelHandle>()
    root = createRoot(container)
    await act(async () => {
      root.render(
        <RequestTestPanel
          ref={ref}
          operations={[]}
          effectiveSpec=""
          label="No Schema Draft"
          baseURL="http://127.0.0.1:1/widgets"
          method="GET"
          authType={AuthType.AuthNone}
          auth={null}
          jose={null}
          headers={null}
          secretRef=""
          requestID={null}
        />,
      )
    })

    // Declared before any run -- the hint is a standing caption, never
    // a gate blocking the rest of the panel (contract item 1).
    const hint = container.querySelector('[data-testid="declare-schema-hint"]')
    expect(hint?.textContent).toBe(configure.requestTestPanel.declareSchemaHint)
    expect(panel()).not.toBeNull()

    await act(async () => {
      ref.current?.trigger()
      // trigger() is fire-and-forget (its own imperative-handle
      // contract); a macrotask tick reliably drains runTest's await
      // chain (the mocked network call, then its state updates)
      // regardless of exactly how many microtask hops it takes.
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(testHTTPRequestOperation).toHaveBeenCalledTimes(1)
    const call = testHTTPRequestOperation.mock.calls[0][0] as { Path: string; Method: string; OpenAPISpec: string; BaseURL: string }
    expect(call.Path).toBe('/')
    expect(call.Method).toBe('GET')
    expect(call.BaseURL).toBe('http://127.0.0.1:1/widgets')
    // The synthesized spec is a real, parseable OpenAPI document (the
    // same door a declared schema goes through), never an empty string.
    const spec = JSON.parse(call.OpenAPISpec) as { paths: Record<string, Record<string, unknown>> }
    expect(spec.paths['/'].get).toBeDefined()

    const response = container.querySelector('[data-testid="request-test-response"]')
    expect(response?.textContent).toBe('{"ok":true}')
    // The hint still renders underneath the now-populated result pane.
    expect(container.querySelector('[data-testid="declare-schema-hint"]')?.textContent)
      .toBe(configure.requestTestPanel.declareSchemaHint)
  })

  it('never no-ops: the inline Run button is disabled with its reason when there is no URL yet', async () => {
    root = createRoot(container)
    await act(async () => {
      root.render(
        <RequestTestPanel
          operations={[]}
          effectiveSpec=""
          label="No URL Draft"
          baseURL=""
          method="GET"
          authType={AuthType.AuthNone}
          auth={null}
          jose={null}
          headers={null}
          secretRef=""
          requestID={null}
        />,
      )
    })

    const button = container.querySelector('[data-testid="run-request-test"]') as HTMLButtonElement | null
    expect(button).not.toBeNull()
    expect(button?.disabled).toBe(true)
    expect(button?.title).toBe(configure.requestTestPanel.urlRequiredToTest)
    expect(button?.getAttribute('aria-description')).toBe(configure.requestTestPanel.urlRequiredToTest)

    await act(async () => { button?.click() })
    expect(testHTTPRequestOperation).not.toHaveBeenCalled()
  })
})
