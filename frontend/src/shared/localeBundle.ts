import common from '../locales/en/common.json'
import app from '../locales/en/app.json'
import composition from '../locales/en/composition.json'
import configure from '../locales/en/configure.json'
import secrets from '../locales/en/secrets.json'
import views from '../locales/en/views.json'
import { mergeAtlasLocaleModules } from './atlasLocaleMerge'

// The English bundle, assembled once and shared by BOTH resolvers:
// app/i18n.ts hands it to i18next as the `en` resources, and
// shared/copy.ts walks it directly for every caller that has no React
// tree to reach i18next's hook from (module-scope registries, and the
// declaration-JSON generators that run under vitest without a boot).
// Assembling it here rather than inside i18n.ts is what keeps the two
// resolvers reading ONE set of files -- a key present for the app is
// present for a registry, always.
//
// Lives in shared/ (a dependency-cruiser leaf) because copy.ts must
// reach it and shared/ can never import app/.
//
// Atlas's namespace is assembled from one file PER NOUN
// (locales/en/atlas/*.json, goal 0180 slice 2) rather than a single
// atlas.json, which used to be Atlas's worst merge-collision file --
// import.meta.glob discovers every file eagerly, the same
// static-bundled/zero-network-call shape as the plain imports above,
// and mergeAtlasLocaleModules refuses a top-level key collision
// between two files rather than silently clobbering one file's subtree
// with another's. The NAMESPACE stays singular ('atlas',
// useTranslation('atlas')): the file split is invisible to every
// t()/copy() call site.
const atlasLocaleModules = import.meta.glob('../locales/en/atlas/*.json', { eager: true, import: 'default' }) as Record<string, Record<string, unknown>>
const atlas = mergeAtlasLocaleModules(atlasLocaleModules)

export const LOCALE_NAMESPACES = ['common', 'app', 'atlas', 'composition', 'configure', 'secrets', 'views'] as const

export const DEFAULT_NAMESPACE = 'common'

export const EN_RESOURCES: Record<string, Record<string, unknown>> = {
  common,
  app,
  atlas,
  composition,
  configure,
  secrets,
  views,
}
