import { beforeEach, describe, expect, it } from 'vitest'
import {
	acceptPluginTheme,
	buildThemeCss,
	forgetPluginThemes,
	isKnownScheme,
	isPluginScheme,
	pluginThemeRejections,
	pluginThemeSchemeId,
	pluginThemes,
	pluginThemesFor,
	rebaseThemeCss,
	rejectPluginTheme,
	themeSelector,
	validateThemeCss,
} from './appearanceThemes'

// Primer's own selector shape, copied from
// @primer/primitives/dist/css/functional/themes/light.css: the pair at
// the top of the file, and the higher-specificity form inside the
// prefers-color-scheme block. A contributed theme's stylesheet has to
// carry the same palette, which is what these tests pin.
const PRIMER_LIGHT = `[data-color-mode="light"][data-light-theme="light"],
[data-color-mode="auto"][data-light-theme="light"] {
  --bgColor-default: #ffffff;
  --fgColor-default: #1f2328;
}
@media (prefers-color-scheme: dark) {
  [data-color-mode][data-color-mode="auto"][data-dark-theme="light"] {
    --bgColor-default: #ffffff;
  }
}
`

describe('the theme file parser', () => {
	it('accepts a flat list of documented declarations', () => {
		expect(validateThemeCss('/* warm */\n--bgColor-default: #f6efe2;\n--fgColor-default: #3a3026;\n')).toBeNull()
	})

	it('accepts a last declaration with no trailing semicolon', () => {
		expect(validateThemeCss('--bgColor-default: #fff')).toBeNull()
	})

	it.each([
		['a selector', '--bgColor-default: #fff;\n\n:root {\n--fgColor-default: #000;\n}\n', 3],
		['an at-rule', '--bgColor-default: #fff;\n@import "other.css";\n', 2],
		['a url value', '--bgColor-default: #fff;\n--bgColor-muted: url(http://evil/x.png);\n', 2],
		['an undocumented token', '--bgColor-default: #fff;\n--not-a-token: red;\n', 2],
		['a plain property', '--bgColor-default: #fff;\ncolor: red;\n', 2],
		['an unclosed comment', '--bgColor-default: #fff;\n/* forever\n--fgColor-default: #000;\n', 2],
	])('refuses %s and names its line', (_name, src, line) => {
		expect(validateThemeCss(src)).toMatchObject({ line })
	})
})

describe('the injected stylesheet', () => {
	it('mirrors Primer by rewriting every one of its theme selectors', () => {
		const rebased = rebaseThemeCss(PRIMER_LIGHT, 'light', 'light', 'p.sepia')
		expect(rebased).not.toContain('data-light-theme="light"')
		expect(rebased).not.toContain('data-dark-theme="light"')
		expect(rebased.split(themeSelector('light', 'p.sepia')).length - 1).toBe(3)
		// The prefers-color-scheme block Primer wraps its auto form in
		// survives the rewrite.
		expect(rebased).toContain('@media (prefers-color-scheme: dark)')
	})

	it('leaves a scheme id that is not the base alone', () => {
		expect(rebaseThemeCss(PRIMER_LIGHT, 'dark', 'dark', 'p.slate')).toBe(PRIMER_LIGHT)
	})

	it('puts the theme declarations after the palette it layers over', () => {
		const css = buildThemeCss(PRIMER_LIGHT, 'light', 'p.sepia', '--bgColor-default: #f6efe2;')
		const selector = themeSelector('light', 'p.sepia')
		expect(css.lastIndexOf('#f6efe2')).toBeGreaterThan(css.indexOf('#ffffff'))
		expect(css.trimEnd().endsWith('}')).toBe(true)
		expect(css).toContain(`${selector} {\n--bgColor-default: #f6efe2;\n}`)
	})

	it('names the two attributes Mill resolves, so it ties Primer and wins on order', () => {
		expect(themeSelector('dark', 'p.slate')).toBe('[data-mill-theme="dark"][data-mill-scheme="p.slate"]')
	})
})

describe('the contributed theme registry', () => {
	beforeEach(() => {
		forgetPluginThemes('p')
		forgetPluginThemes('q')
	})

	it('namespaces a scheme id by its plugin', () => {
		expect(pluginThemeSchemeId('p', 'sepia')).toBe('p.sepia')
		expect(isPluginScheme('p.sepia')).toBe(true)
		expect(isPluginScheme('dark_dimmed')).toBe(false)
	})

	it('lists an accepted theme under its own family only', () => {
		acceptPluginTheme({ schemeId: 'p.sepia', pluginId: 'p', pluginName: 'P', label: 'Sepia', family: 'light' })
		acceptPluginTheme({ schemeId: 'p.slate', pluginId: 'p', pluginName: 'P', label: 'Slate', family: 'dark' })
		expect(pluginThemesFor('light').map((t) => t.schemeId)).toEqual(['p.sepia'])
		expect(pluginThemesFor('dark').map((t) => t.schemeId)).toEqual(['p.slate'])
	})

	it('hands out the same snapshot until something changes', () => {
		acceptPluginTheme({ schemeId: 'p.sepia', pluginId: 'p', pluginName: 'P', label: 'Sepia', family: 'light' })
		expect(pluginThemes()).toBe(pluginThemes())
		expect(pluginThemeRejections()).toBe(pluginThemeRejections())
	})

	it('drops a rejected theme from the list and reports it instead', () => {
		acceptPluginTheme({ schemeId: 'p.sepia', pluginId: 'p', pluginName: 'P', label: 'Sepia', family: 'light' })
		rejectPluginTheme({ schemeId: 'p.sepia', pluginName: 'P', label: 'Sepia', line: 4 })
		expect(pluginThemes()).toHaveLength(0)
		expect(pluginThemeRejections()).toEqual([{ schemeId: 'p.sepia', pluginName: 'P', label: 'Sepia', line: 4 }])
	})

	it('forgets the themes of a plugin that stops running', () => {
		acceptPluginTheme({ schemeId: 'p.sepia', pluginId: 'p', pluginName: 'P', label: 'Sepia', family: 'light' })
		acceptPluginTheme({ schemeId: 'q.dusk', pluginId: 'q', pluginName: 'Q', label: 'Dusk', family: 'dark' })
		forgetPluginThemes('p')
		expect(pluginThemes().map((t) => t.schemeId)).toEqual(['q.dusk'])
	})

	it('knows a built-in scheme always, and a contributed one only while it is installed', () => {
		expect(isKnownScheme('light', ['light'])).toBe(true)
		expect(isKnownScheme('p.sepia', ['light'])).toBe(false)
		acceptPluginTheme({ schemeId: 'p.sepia', pluginId: 'p', pluginName: 'P', label: 'Sepia', family: 'light' })
		expect(isKnownScheme('p.sepia', ['light'])).toBe(true)
		forgetPluginThemes('p')
		expect(isKnownScheme('p.sepia', ['light'])).toBe(false)
	})
})
