import React from 'react'
import i18next from 'i18next'
import { writeClipboardText } from '../shared/clipboardWrite'
import { composeDiagnosis } from '../shared/diagnosis'
import styles from './AppErrorBoundary.module.css'

// The last line of defense for the whole render tree: without this, a
// single render error anywhere below the root unmounts EVERYTHING into
// a silent white window (observed live on an installed build -- only
// the native chrome survived). React error boundaries must be class
// components; this one deliberately renders plain token-styled markup
// with no Primer/ThemeProvider dependency, because the themed tree may
// be exactly what crashed. Render errors only -- event-handler and
// async errors don't reach a boundary by React's own contract.
// Copy goes through i18next.t directly (module-level i18n init from
// main.tsx survives any React crash) -- the useTranslation hook can't
// run inside a class fallback anyway. The copy payload is composed via
// diagnosis.ts's composeDiagnosis (a plain function, no Primer/React
// dependency), never shared/CopyDiagnosisButton -- that component
// renders Primer, which this boundary must not depend on either.
interface State {
  error: Error | null
  componentStack: string
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null, componentStack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? '' })
    console.error('[AppErrorBoundary]', error, info.componentStack)
  }

  private details(): string {
    const { error, componentStack } = this.state
    return `${error?.message ?? 'unknown error'}\n\n${error?.stack ?? ''}\n\nComponent stack:${componentStack}`
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={styles.shell} data-testid="app-error-boundary">
        <h1 className={styles.heading}>{i18next.t('app:errorBoundary.heading')}</h1>
        <p className={styles.body}>{i18next.t('app:errorBoundary.body')}</p>
        <pre className={styles.details} data-testid="error-details">{this.details()}</pre>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.button}
            data-testid="error-copy-details"
            // Falls back to the bare crash details (composeDiagnosis's
            // pre-goal-0127 behavior) if the AppDiagnostics round trip
            // itself fails -- this button must still copy SOMETHING
            // even when whatever crashed the render tree also broke
            // the Wails bridge.
            onClick={() => void composeDiagnosis({ error: this.details() }).catch(() => this.details()).then(writeClipboardText)}
          >
            {i18next.t('app:errorBoundary.copyDetails')}
          </button>
          <button
            type="button"
            className={styles.button}
            data-testid="error-reload"
            onClick={() => window.location.reload()}
          >
            {i18next.t('app:errorBoundary.reload')}
          </button>
        </div>
      </div>
    )
  }
}

// A deliberate render-time crash reachable only at its own hash route
// (#/millcrashprobe) -- the e2e seam proving the boundary against the
// real bundle, same second-hash-route mechanism ADR-0033 established.
export function CrashProbe(): React.ReactElement {
  throw new Error('crash probe: deliberate render error for the boundary e2e')
}
