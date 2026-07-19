// Heuristics for mapping a Figma variable setup onto the gigaton-website Salty
// conventions. These are intentionally centralised + named so they're easy to
// tune once we see how the real Figma file's collections/modes are organised.

import type { ReadCollection } from '../types'

/** Collections whose name matches one of these are treated as the semantic THEME layer. */
export const THEME_COLLECTION_HINTS = ['theme', 'themes', 'semantic', 'mode', 'modes']

/** Mode names that mean "desktop / base" (-> responsive.base, HDClamp). */
export const DESKTOP_MODE_HINTS = ['desktop', 'hd', 'base', 'default', 'large', 'wide', 'lg']

/** Mode names that mean "mobile override" (-> @largeMobileDown, MobileClamp). */
export const MOBILE_MODE_HINTS = ['mobile', 'sm', 'small', 'phone', 'xs']

/** The breakpoint key used for mobile overrides in variables.css.ts. */
export const MOBILE_BREAKPOINT_KEY = '@largeMobileDown'

/** Top-level group names that should NOT be wrapped in a viewport clamp. */
export const NON_CLAMP_GROUPS = new Set([
  'colors',
  'color',
  'fontfamily',
  'fontfamilies',
  'fontweights',
  'fontweight',
  'durations',
  'easings',
  'zindex',
  'radii',
  'radius',
])

function nameMatches(name: string, hints: string[]): boolean {
  const n = name.toLowerCase()
  return hints.some((h) => n.includes(h))
}

/** The collection that looks like the semantic theme layer, if any. */
export function findThemeCollection(collections: ReadCollection[]): ReadCollection | null {
  // Prefer an explicit name match…
  const named = collections.find((c) => nameMatches(c.name, THEME_COLLECTION_HINTS))
  if (named) return named
  // …otherwise, a multi-mode collection whose modes look like light/dark.
  const themeish = collections.find(
    (c) => c.modes.length >= 2 && c.modes.some((m) => /light|dark|grey|gray/i.test(m.name)),
  )
  return themeish ?? null
}

export interface ResponsiveModes {
  desktopModeId: string
  mobileModeId: string | null
}

/** Classify a collection's modes into a desktop (base) mode and an optional mobile mode. */
export function classifyModes(collection: ReadCollection): ResponsiveModes {
  const mobile = collection.modes.find((m) => nameMatches(m.name, MOBILE_MODE_HINTS))
  const desktop =
    collection.modes.find((m) => nameMatches(m.name, DESKTOP_MODE_HINTS)) ??
    collection.modes.find((m) => m.modeId === collection.defaultModeId) ??
    collection.modes[0]
  return {
    desktopModeId: desktop ? desktop.modeId : collection.defaultModeId,
    mobileModeId: mobile && mobile.modeId !== (desktop && desktop.modeId) ? mobile.modeId : null,
  }
}

/** true if the top-level group name is a raw palette / non-scaling group. */
export function isNonClampGroup(topGroup: string): boolean {
  return NON_CLAMP_GROUPS.has(topGroup.toLowerCase())
}
