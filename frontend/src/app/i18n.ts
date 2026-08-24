import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import common from '../locales/en/common.json'
import app from '../locales/en/app.json'
import composition from '../locales/en/composition.json'
import configure from '../locales/en/configure.json'
import secrets from '../locales/en/secrets.json'
import views from '../locales/en/views.json'
import { mergeAtlasLocaleModules } from './atlasLocaleMerge'

// Atlas's own namespace is assembled from one file PER NOUN
// (locales/en/atlas/*.json, goal 0180 slice 2) rather than the single
// 477-line atlas.json that used to be Atlas's worst merge-collision
// file (5 of 7 PRs in one arc touched it) -- import.meta.glob discovers
// every file eagerly, same static-bundled/zero-network-call shape as
// the plain imports below, and mergeAtlasLocaleModules refuses a
// top-level key collision between two files rather than silently
// clobbering one file's subtree with another's (see its own header).
// The NAMESPACE stays singular ('atlas', useTranslation('atlas')) --
// every t('...') call site and every e2e string match stays untouched.
const atlasLocaleModules = import.meta.glob('../locales/en/atlas/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>
const atlas = mergeAtlasLocaleModules(atlasLocaleModules)

// docs/goals/archive/0032-copy-management.md's locked research verdict:
// react-i18next + i18next, namespace-per-bounded-context JSON --
// mirroring frontend/src's own app/composition/configure/shared/views
// folders -- chosen over every git-native headless-CMS candidate
// (Decap/Sveltia/Keystatic/Tina), all of which need either a hosted
// OAuth intermediary or a locally-running backend daemon, disqualified
// by SPEC §1.1's no-hosted-service/no-second-daemon constraint. This
// is copy-CENTRALIZATION (key -> string JSON, no authoring UI, no
// CMS product), not localization -- there is no language switcher and
// no plan for one yet; English is the only shipped locale. Resources
// are imported statically and bundled at build time (Vite's own
// resolveJsonModule support), never fetched at runtime, so this adds
// zero network calls and zero server, matching Mill's own hard
// constraints.
//
// Initialized once here and imported for its side effect from
// app/main.tsx, before the first render -- react-i18next's
// useTranslation() hook reads the already-initialized global i18next
// instance from any bounded-context folder without importing this
// module directly (app/ is the only folder allowed to import this,
// per .claude/rules/frontend.md's dependency-cruiser boundaries; every
// other folder just calls useTranslation() from the 'react-i18next'
// package).
void i18n.use(initReactI18next).init({
  resources: {
    en: { common, app, atlas, composition, configure, secrets, views },
  },
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common', 'app', 'atlas', 'composition', 'configure', 'secrets', 'views'],
  interpolation: {
    // React already escapes interpolated values when rendering JSX --
    // i18next's own default (HTML-escaping) would double-escape them.
    escapeValue: false,
  },
  returnNull: false,
})

export default i18n
