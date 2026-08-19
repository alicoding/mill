// Option-color resolution (goal 0105 part 3): explicit color from the
// column's OptionColors when set at that option's index, else the
// standard palette by index -- deterministic, so the same List
// renders identically on every surface. Names are Primer Label
// variants / semantic token stems.
export const OPTION_COLOR_PALETTE = ['success', 'danger', 'attention', 'accent', 'done', 'sponsors'] as const
export type OptionColor = (typeof OPTION_COLOR_PALETTE)[number]

export function optionColor(options: string[] | null | undefined, optionColors: string[] | null | undefined, value: string): OptionColor | null {
  const idx = (options ?? []).indexOf(value)
  if (idx === -1) return null
  const explicit = optionColors?.[idx]
  if (explicit && (OPTION_COLOR_PALETTE as readonly string[]).includes(explicit)) return explicit as OptionColor
  return OPTION_COLOR_PALETTE[idx % OPTION_COLOR_PALETTE.length]
}
