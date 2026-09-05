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
  // Extensions used to be a Settings group and is now its own
  // destination (goal 0349), so a saved `settings.open.extensions`
  // link, a bookmark, or a restored session lands on the real page
  // rather than on General.
  if (view.kind === 'settings' && view.section === 'extensions') {
    return { kind: 'extensions' }
  }
  return view
}
