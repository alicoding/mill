// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import views from '../locales/en/views.json'

type Props = Record<string, unknown> & { children?: ReactNode }

vi.mock('@primer/react', () => ({
  Button: ({ children, ...props }: Props) => <button {...props}>{children}</button>,
  Stack: ({ children }: Props) => <div>{children}</div>,
  Text: ({ children, ...props }: Props) => <span {...props}>{children}</span>,
}))
vi.mock('../shared/CopyDiagnosisButton', () => ({
  CopyDiagnosisButton: ({ error, testId }: { error: string; testId: string }) => (
    <button data-testid={testId} data-error={error}>copy</button>
  ),
}))
vi.mock('../shared/openExternal', () => ({ openExternalUrl: vi.fn() }))

const { UpdateFailureStatus } = await import('./UpdatesSection')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('UpdateFailureStatus', () => {
  it('renders the backup sentence while retaining the technical cause only in Copy diagnosis', () => {
    const cause = 'backup: participant plugin-state: schema 2 is not supported'
    const t = (key: string) => key === 'settings.updates.installFailedBackup'
      ? views.settings.updates.installFailedBackup
      : key

    act(() => root.render(<UpdateFailureStatus stage="backup" error={cause} t={t} />))

    expect(container.querySelector('[data-testid="update-install-error"]')?.textContent)
      .toBe("Couldn't back up your data. The update hasn't started.")
    expect(container.textContent).not.toContain(cause)
    expect(container.querySelector('[data-testid="update-error-copy"]')?.getAttribute('data-error')).toBe(cause)
  })
})
