import { lazy } from 'react'

// The frame component is loaded lazily: this module sits on the
// activation path (canvasToolAdapter -> hostApi), which must stay free
// of the app's own component graph (loader.ts's import discipline).
// Its own file so PluginFaceFrame.tsx's only export stays the
// pluginFramedFaceComponent factory (goal 0419 S1b: a local
// component-shaped binding in an otherwise factory-only file breaks
// Fast Refresh's own file-shape check).
export const PluginFrame = lazy(() => import('../app/PluginFrame').then((m) => ({ default: m.PluginFrame })))
