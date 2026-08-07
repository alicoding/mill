import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import '@primer/primitives/dist/css/primitives.css'
import '@primer/primitives/dist/css/functional/themes/light.css'
import '@primer/primitives/dist/css/functional/themes/dark.css'
import { ThemeProvider, BaseStyles } from '@primer/react'
import App from './App'
import { COLOR_MODE_STORAGE_KEY } from './theme'

// Read once, synchronously, before the first render, to seed
// ThemeProvider's initial colorMode -- not the ongoing value. App.tsx's
// theme switcher changes it afterward via Primer's own useTheme() hook;
// this constant never changes across re-renders (it's read once, here,
// at module load), so it only ever acts as an initial value and never
// fights the user's later choice. Confirmed directly against
// ThemeProvider's own implementation: it seeds a useSyncedState from
// this prop and only re-syncs when the *prop itself* changes between
// renders, which it never does here.
const initialColorMode = (localStorage.getItem(COLOR_MODE_STORAGE_KEY) as 'light' | 'dark' | 'auto' | null) ?? 'auto'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider colorMode={initialColorMode}>
      <BaseStyles>
        <App />
      </BaseStyles>
    </ThemeProvider>
  </React.StrictMode>,
)
