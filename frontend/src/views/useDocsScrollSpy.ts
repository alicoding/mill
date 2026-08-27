import { useEffect, useState } from 'react'
import { isScrollContainer } from '../shared/scrollContainer'
import type { DocsHeading } from './docsHeadings'

// Scroll-spy + click-to-scroll for the Docs TOC rail (goal 0235 S2) --
// the SAME rAF-throttled capture-phase scroll-listener shape as
// Settings' own TOC (useSettingsSectionSync.ts, goal 0077), reused
// rather than reinvented: an IntersectionObserver was tried first and
// did not fire reliably against Primer PageLayout's own nested
// `.view-pane` scroll container in this app shell (root:null delivered
// exactly one callback, at initial observe time, then never again on
// scroll) -- the same class of gotcha useSettingsSectionSync's own
// header comment already documents for this exact layout.
// document.getElementById replaces that hook's ref-registration Map:
// only one docs page's headings ever exist in the DOM at a time
// (dangerouslySetInnerHTML replaces the whole page on navigation), so
// ids alone are enough to find each heading element.
export function useDocsScrollSpy(headings: DocsHeading[], reducedMotion: boolean) {
  const [activeId, setActiveId] = useState('')

  const scrollToHeading = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  }

  useEffect(() => {
    if (headings.length === 0) {
      setActiveId('')
      return
    }
    let raf = 0
    const computeActive = () => {
      raf = 0
      const bandLine = 120
      let candidate = headings[0].id
      for (const h of headings) {
        const el = document.getElementById(h.id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= bandLine) candidate = h.id
        else break
      }
      // Same "stop at the nearest ACTUAL scroll container" reasoning as
      // useSettingsSectionSync: Primer's own PageLayout.Content wrapper
      // sits between this page and the real scroller (`.view-pane`)
      // with overflow-y:visible, so a height-only check would stop one
      // level too early.
      const first = document.getElementById(headings[0].id)
      let scroller: HTMLElement | null = first?.parentElement ?? null
      while (scroller && !isScrollContainer(scroller)) scroller = scroller.parentElement
      if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        candidate = headings[headings.length - 1].id
      }
      setActiveId((cur) => (cur === candidate ? cur : candidate))
    }
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(computeActive)
    }
    window.addEventListener('scroll', onScroll, true)
    computeActive()
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [headings])

  return { activeId, scrollToHeading }
}
