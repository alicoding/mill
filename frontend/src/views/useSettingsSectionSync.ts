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

  // Scroll-sync: biased to the top third of the viewport (rootMargin
  // shrinks the bottom 66%) so a section is marked active as soon as its
  // heading crosses into the upper part of the pane, not only once it's
  // fully in view -- matches the design contract's VS Code-style bias.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        const topmost = visible.reduce((a, b) => (a.boundingClientRect.top <= b.boundingClientRect.top ? a : b))
        for (const [id, el] of sectionEls.current) {
          if (el === topmost.target) { setActiveId(id); break }
        }
      },
      { rootMargin: '0px 0px -66% 0px', threshold: 0 },
    )
    for (const id of sectionIds) {
      const el = sectionEls.current.get(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
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
