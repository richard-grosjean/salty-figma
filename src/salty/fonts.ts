// Generates fonts.css.ts (Salty defineFont() per family) from the document's text
// styles, and derives the fontFamily.* tokens that variables.css.ts defines and
// text-styles.ts references. All three stay consistent because they share the
// family ordering computed here.
//
// One @font-face is emitted per distinct (family, weight, italic) combination
// actually used by a text style, following the convention:
//   url('/fonts/<Family>-<Style>.woff2') format('woff2'), … .woff …

import type { DesignSystemSnapshot, ReadCollection } from '../types'
import { camelCase } from './format'
import { serialize, Tree } from './serialize'
import type { GenResult } from './variables'

export interface FontFamilyToken {
  /** Semantic key: 'main', 'secondary', … */
  key: string
  /** Raw Figma font family, e.g. "SF Pro Display". */
  family: string
  /** CSS font-family value for the token, e.g. `"SF Pro Display", sans-serif`. */
  cssValue: string
}

interface FontFace {
  family: string
  weight: number
  italic: boolean
}

// Numeric weight -> the word used in font filenames (…-Regular.woff2).
const WEIGHT_NAMES: Record<number, string> = {
  100: 'Thin',
  200: 'ExtraLight',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
}

const ORDINAL_KEYS = ['main', 'secondary', 'tertiary', 'quaternary']

function familyKey(index: number): string {
  return ORDINAL_KEYS[index] ?? `font${index + 1}`
}

function isItalic(fontStyle: string): boolean {
  return /italic|oblique/i.test(fontStyle)
}

/**
 * Distinct families, ordered by how often they're used (ties: first seen).
 * Takes the raw list of every text style's family (duplicates included) so the
 * same ordering can be reproduced from a snapshot or from the live Figma text
 * styles in Dev Mode — keeping the derived main/secondary/… keys identical.
 */
function orderedFamilies(families: string[]): string[] {
  const count = new Map<string, number>()
  const firstSeen = new Map<string, number>()
  let i = 0
  for (const family of families) {
    if (!family) continue
    count.set(family, (count.get(family) ?? 0) + 1)
    if (!firstSeen.has(family)) firstSeen.set(family, i++)
  }
  return [...count.keys()].sort((a, b) => {
    const byCount = (count.get(b) ?? 0) - (count.get(a) ?? 0)
    return byCount !== 0 ? byCount : (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0)
  })
}

/** A CSS font stack for a family: quoted when it contains spaces, plus a generic fallback. */
function cssFontStack(family: string): string {
  const name = /\s/.test(family) ? `"${family}"` : family
  return `${name}, sans-serif`
}

/** The fontFamily.* tokens (main/secondary/…) derived from a list of used families. */
export function collectFontFamilies(families: string[]): FontFamilyToken[] {
  return orderedFamilies(families).map((family, i) => ({
    key: familyKey(i),
    family,
    cssValue: cssFontStack(family),
  }))
}

/**
 * Font families already defined as Figma variables under `fontFamily.*`:
 * raw family -> its key ("Hanken Grotesk" -> "heading"). The first variable
 * holding a family wins. These take precedence over derived main/secondary/… keys.
 */
export function figmaFamilyKeys(collections: ReadCollection[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const c of collections) {
    for (const v of c.variables) {
      if (v.resolvedType !== 'STRING' || v.path[0] !== 'fontFamily' || v.path.length < 2) continue
      const val = v.valuesByMode[c.defaultModeId] ?? Object.values(v.valuesByMode)[0]
      if (val?.kind !== 'string' || map.has(val.value)) continue
      map.set(val.value, v.path.slice(1).join('.'))
    }
  }
  return map
}

/**
 * Map each raw family name to its token key, shared by text-styles.ts and Dev
 * Mode. Families defined as Figma `fontFamily.*` variables use that key;
 * others get a derived main/secondary/… key.
 */
export function familyKeyMap(
  families: string[],
  figmaKeys: Map<string, string> = new Map(),
): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of collectFontFamilies(families)) map.set(f.family, figmaKeys.get(f.family) ?? f.key)
  return map
}

/** The raw family of every text style, in document order (duplicates kept). */
export function familiesOf(snapshot: DesignSystemSnapshot): string[] {
  return snapshot.textStyles.map((s) => s.fontFamily)
}

/** Distinct (family, weight, italic) faces used by text styles, sorted for stable output. */
function collectFontFaces(snapshot: DesignSystemSnapshot): FontFace[] {
  const rank = new Map(orderedFamilies(familiesOf(snapshot)).map((f, i) => [f, i]))
  const seen = new Map<string, FontFace>()
  for (const s of snapshot.textStyles) {
    if (!s.fontFamily) continue
    const weight = s.fontWeight ?? 400
    const italic = isItalic(s.fontStyle)
    const key = `${s.fontFamily}|${weight}|${italic}`
    if (!seen.has(key)) seen.set(key, { family: s.fontFamily, weight, italic })
  }
  return [...seen.values()].sort(
    (a, b) =>
      (rank.get(a.family) ?? 0) - (rank.get(b.family) ?? 0) ||
      a.weight - b.weight ||
      Number(a.italic) - Number(b.italic),
  )
}

/** Style token used in filenames: "Regular", "Bold", "Italic", "BoldItalic", … */
function styleName(weight: number, italic: boolean): string {
  const base = WEIGHT_NAMES[weight] ?? String(weight)
  if (!italic) return base
  return weight === 400 ? 'Italic' : `${base}Italic`
}

function fileBase(family: string): string {
  return family.replace(/\s+/g, '')
}

/** Generic fallback stack for a family: monospace for mono/code faces, else sans-serif. */
function fallbackStack(family: string): string {
  return /mono|code/i.test(family) ? 'ui-monospace, monospace' : 'system-ui, sans-serif'
}

/** Exported const name for a family: "Hanken Grotesk" -> "hankenGrotesk". */
function constName(family: string): string {
  const name = camelCase(family)
  return /^[A-Za-z_$]/.test(name) ? name : `font${name}`
}

/**
 * fonts.css.ts — one Salty defineFont() per family used by text styles, with a
 * variant per (weight, italic) combination in use. The CSS variable follows the
 * family's fontFamily token key: {fontFamily.heading} -> font-family-heading.
 */
export function generateFonts(snapshot: DesignSystemSnapshot): GenResult {
  const warnings: string[] = []
  const faces = collectFontFaces(snapshot)

  if (faces.length === 0) {
    warnings.push('No local text styles found — fonts.css.ts skipped.')
    return { contents: '', warnings }
  }

  const keys = familyKeyMap(familiesOf(snapshot), figmaFamilyKeys(snapshot.collections))
  const byFamily = new Map<string, FontFace[]>()
  for (const f of faces) {
    const list = byFamily.get(f.family) ?? []
    list.push(f)
    byFamily.set(f.family, list)
  }

  const used = new Set<string>()
  const blocks: string[] = []
  for (const [family, variants] of byFamily) {
    let name = constName(family)
    while (used.has(name)) name += '_'
    used.add(name)

    const key = keys.get(family) ?? family
    const def: Tree = {
      name: family,
      fallback: fallbackStack(family),
      display: 'swap',
      variable: `font-family-${key.replace(/\./g, '-')}`,
      variants: variants.map((f) => ({
        src: `/fonts/${fileBase(f.family)}-${styleName(f.weight, f.italic)}.woff2`,
        weight: f.weight,
        style: f.italic ? 'italic' : 'normal',
      })),
    }
    blocks.push(`export const ${name} = defineFont(${serialize(def)});`)
  }

  const lines = [
    `import { defineFont } from '@salty-css/astro/factories';`,
    '',
    `/* When adding fonts, remember to update the preload links in src/layouts/layout.astro */`,
    '',
    blocks.join('\n\n'),
    '',
  ]
  return { contents: lines.join('\n'), warnings }
}
