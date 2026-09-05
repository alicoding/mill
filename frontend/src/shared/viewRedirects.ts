import type { View } from './store'

// redirectRetiredView keeps a link to a view that has MOVED working
// (goal 0306): Secret sources used to be a Configure tab and now live
// under Secrets, so anything still addressing the old tab -- a
// bookmark, a restored session, a docs link -- lands where the sources
// actually are instead of on an empty Configure tab. Applied inside
// setView, so no call site has to know a view moved.
export function redirectRetiredView(view: View): View {
  if (view.kind === 'configure' && view.tab === 'secretsources') {
    return { kind: 'secrets', tab: 'sources' }
  }
  return view
}
