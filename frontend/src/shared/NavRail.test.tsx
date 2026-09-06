import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import NavRail, { type NavRailGroup } from './NavRail'
import { CONFIGURE_KINDS, groupConfigureKinds, resolveKindLabel, type ConfigureKind } from './configureKinds'

// The kit's NavList pulls its stylesheet in at import, which the node
// test runtime cannot load; the stand-ins below keep the same slot
// shape (group, heading with an auxiliary line, item, leading visual)
// so what is asserted is this component's composition -- grouping,
// order, the current-page mark -- not the kit's own markup.
vi.mock('@primer/react', () => {
  const Item = ({ children, ...rest }: { children: ReactNode } & Record<string, unknown>) => <a {...rest}>{children}</a>
  const Group = ({ children, ...rest }: { children: ReactNode; hideDivider?: boolean } & Record<string, unknown>) => {
    const attrs = { ...rest }
    delete attrs.hideDivider
    return <li {...attrs}><ul>{children}</ul></li>
  }
  const GroupHeading = ({ children, auxiliaryText }: { children: ReactNode; auxiliaryText?: string }) => <><h3>{children}</h3>{auxiliaryText && <div>{auxiliaryText}</div>}</>
  const LeadingVisual = ({ children }: { children: ReactNode }) => <span>{children}</span>
  const NavList = Object.assign(({ children }: { children: ReactNode }) => <ul>{children}</ul>, { Item, Group, GroupHeading, LeadingVisual })
  return { NavList }
})

// The rail's rendered shape (goal 0116): titled groups become NavList
// groups with the caption as the heading's auxiliary line, the active
// item carries aria-current="page", and a plugin-contributed kind
// renders under "From extensions" -- the slot the registry reserves
// for it -- after every built-in group.
function railGroups(kinds: ConfigureKind[]): NavRailGroup<string>[] {
  return groupConfigureKinds(kinds).map(({ group, kinds }) => ({
    id: group.id,
    title: group.id === 'extensions' ? 'From extensions' : group.id,
    caption: group.captionKey ? 'caption' : undefined,
    items: kinds.map((k) => ({ id: k.id, label: resolveKindLabel(k), href: `#/configure/${k.id}`, testId: `item-${k.id}`, icon: k.icon })),
  }))
}

describe('NavRail', () => {
  it('renders a plugin-sourced kind under From extensions, after the built-in groups', () => {
    const fromPlugin: ConfigureKind = {
      id: 'zz-plugin-kind',
      labelKey: 'configureView.lists',
      icon: CONFIGURE_KINDS[0].icon,
      group: 'connections',
      source: { plugin: 'example.plugin' },
    }
    const html = renderToStaticMarkup(
      <NavRail ariaLabel="Configure" testId="rail" groups={railGroups([...CONFIGURE_KINDS, fromPlugin])} activeId="lists" onSelect={() => {}} />,
    )
    const extensionsAt = html.indexOf('From extensions')
    const pluginItemAt = html.indexOf('data-testid="item-zz-plugin-kind"')
    const lastBuiltInAt = html.indexOf('data-testid="item-steptypes"')
    expect(extensionsAt).toBeGreaterThan(lastBuiltInAt)
    expect(pluginItemAt).toBeGreaterThan(extensionsAt)
    expect(html).toContain('data-testid="rail-group-extensions"')
  })

  it('marks only the active item as the current page and lists every registered item', () => {
    const html = renderToStaticMarkup(
      <NavRail ariaLabel="Configure" testId="rail" groups={railGroups(CONFIGURE_KINDS)} activeId="lists" onSelect={() => {}} />,
    )
    expect(html.match(/aria-current="page"/g)?.length).toBe(1)
    for (const kind of CONFIGURE_KINDS) expect(html).toContain(`data-testid="item-${kind.id}"`)
    expect(html).not.toContain('From extensions')
  })

  it('renders the empty slot instead of the list when nothing is left to show', () => {
    const html = renderToStaticMarkup(
      <NavRail ariaLabel="Configure" testId="rail" groups={[{ id: 'data', title: 'Data', items: [] }]} activeId="lists" onSelect={() => {}} empty={<p data-testid="empty">No kind matches.</p>} />,
    )
    expect(html).toContain('data-testid="empty"')
    expect(html).not.toContain('Data')
  })
})
