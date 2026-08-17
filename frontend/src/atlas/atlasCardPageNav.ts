import { useEffect, useReducer } from 'react'

// The card page's own chip-navigation stack (goal 0081 slice A5,
// LOCKED design 5b "chips navigate, and you can come back"):
// session-local, unlimited depth. Esc/Close both tear down the whole
// page rather than stepping back one level -- Primer's Dialog already
// wires Esc to the page's own onClose (a full unmount), so "Esc closes
// from ANY depth, stack discarded" needs no branching here at all.
export interface CardPageNavState {
  currentID: string
  stack: string[]
}

export type CardPageNavAction =
  | { type: 'navigate'; toID: string }
  | { type: 'back' }
  | { type: 'reset'; toID: string }

// cardPageNavReducer is the pure push/pop/reset logic behind
// useCardPageNav below, kept free of React so it's independently
// unit-testable (atlasCardPageNav.test.ts).
export function cardPageNavReducer(state: CardPageNavState, action: CardPageNavAction): CardPageNavState {
  switch (action.type) {
    case 'navigate':
      if (action.toID === state.currentID) return state
      return { currentID: action.toID, stack: [...state.stack, state.currentID] }
    case 'back': {
      if (state.stack.length === 0) return state
      const nextStack = state.stack.slice(0, -1)
      return { currentID: state.stack[state.stack.length - 1], stack: nextStack }
    }
    case 'reset':
      return { currentID: action.toID, stack: [] }
    default:
      return state
  }
}

const BACK_TITLE_MAX_CHARS = 24

// truncateBackTitle bounds the back button's own visible title (the
// LOCKED design's "← with the previous card's title") to ~24
// characters so a long title never pushes the header's Close/kebab out
// of the viewport.
export function truncateBackTitle(title: string): string {
  return title.length > BACK_TITLE_MAX_CHARS ? `${title.slice(0, BACK_TITLE_MAX_CHARS - 1)}…` : title
}

// useCardPageNav wraps cardPageNavReducer for the page component: a
// mounted instance always starts with an empty stack at rootCardID
// (verified for the real deep-link path -- AtlasView unmounts before
// ever pointing a new "open" at a different card -- and defensively
// re-asserted here via the reset effect below, so the guarantee holds
// even if that call pattern ever changes).
export function useCardPageNav(rootCardID: string) {
  const [state, dispatch] = useReducer(cardPageNavReducer, { currentID: rootCardID, stack: [] })

  useEffect(() => {
    dispatch({ type: 'reset', toID: rootCardID })
  }, [rootCardID])

  return {
    currentID: state.currentID,
    previousID: state.stack.length > 0 ? state.stack[state.stack.length - 1] : null,
    navigate: (toID: string) => dispatch({ type: 'navigate', toID }),
    back: () => dispatch({ type: 'back' }),
  }
}
