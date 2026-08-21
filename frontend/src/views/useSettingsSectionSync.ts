import { useEffect, useRef, useState } from 'react'

// Scroll-sync + deep-link landing for the Settings TOC (goal 0077).
// Split out of SettingsView.tsx to keep that file under the 500-line
// convention (architecture.md) -- this hook owns section-root
// registration, which one is "active" (IntersectionObserver-driven),
// and the one-shot scroll for both a TOC click and an incoming
// View.section deep-link.
export function useSettingsSectionSync(sectionIds: string[], initialSection: string | undefined, reducedMotion: boolean) {
  const [activeId, setActiveId] = useState(sectionIds[0])
  const sectionEls = useRef(new Map<string, HTMLElement>())
  const consumedInitialSection = useRef<string | undefined>(undefined)

  const registerSection = (id: string) => (el: HTMLElement | null) => {
    if (el) sectionEls.current.set(id, el)
    else sectionEls.current.delete(id)
  }

  const scrollToSection = (id: string) => {
    sectionEls.current.get(id)?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
  }

  // Scroll-sync: active = the nearest section heading ABOVE the
  // reading line (just under the sticky filter -- a deeper line lets
  // two short sections sit above it at page top and marks the wrong
  // one), recomputed from a full
  // DOM snapshot on every scroll tick. Deliberately NOT an
  // IntersectionObserver: IO callbacks only carry entries whose state
  // CHANGED, so scrolling back up delivered only the departing
  // section (not-intersecting) and the stale active id stuck. A
  // rAF-throttled capture-phase
  // scroll listener sees the settings pane's own scroll (element
  // scroll doesn't bubble, capture does) and nine getBoundingClientRect
  // calls per tick are cheap.
  useEffect(() => {
    let raf = 0
    const computeActive = () => {
      raf = 0
      const bandLine = 120
      let candidate = sectionIds[0]
      for (const id of sectionIds) {
        const el = sectionEls.current.get(id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= bandLine) candidate = id
        else break
      }
      // A short final section can never climb above the reading line
      // -- when the scroll container rests at its bottom, the last
      // section is what the reader is looking at. The walk must stop
      // at the nearest ACTUAL scroll container (overflow-y auto/scroll
      // AND real overflow), not just the nearest ancestor whose
      // content happens to be taller than its own box: Primer's own
      // PageLayout.Content wrapper (App.tsx's own comment on
      // `view-pane` has the fuller history) sits between pagePanel and
      // the real scroller (`.view-pane`) with overflow-y:visible --
      // its scrollHeight exceeds its clientHeight too (any element
      // with overflowing children reports that, regardless of its own
      // overflow property), so a height-only check stops one level
      // too early, on a node where writing .scrollTop is a silent
      // no-op.
      const first = sectionEls.current.get(sectionIds[0])
      const isRealScroller = (el: HTMLElement) => {
        const overflowY = getComputedStyle(el).overflowY
        return (overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight
      }
      let scroller: HTMLElement | null = first?.parentElement ?? null
      while (scroller && !isRealScroller(scroller)) scroller = scroller.parentElement
      if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        candidate = sectionIds[sectionIds.length - 1]
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
  }, [sectionIds])

  // Deep-link landing: consumed once per distinct incoming section id
  // (a palette re-run of the same "Open Settings -> X" command while
  // already on that section is then a no-op scroll, not a re-jump every
  // render) -- same guard shape AtlasView's own initialCardID uses.
  useEffect(() => {
    if (!initialSection || consumedInitialSection.current === initialSection) return
    consumedInitialSection.current = initialSection
    const raf = requestAnimationFrame(() => scrollToSection(initialSection))
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scrollToSection closes over reducedMotion, already a hook dependency
  }, [initialSection])

  return { activeId, registerSection, scrollToSection }
}
