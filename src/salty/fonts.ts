// Generates fonts.css (plain CSS @font-face rules) from the document's text
// styles, and derives the fontFamily.* tokens that variables.css.ts defines and
// templates.css.ts references. All three stay consistent because they share the
// family ordering computed here.
//
// One @font-face is emitted per distinct (family, weight, italic) combination
// actually used by a text style, following the convention:
//   url('/fonts/<Family>-<Style>.woff2') format('woff2'), … .woff …

import type { DesignSystemSnapshot } from '../types'
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

/** Map each raw family name to its token key, shared by templates.css.ts and Dev Mode. */
export function familyKeyMap(families: string[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const f of collectFontFamilies(families)) map.set(f.family, f.key)
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

/** CSS font-weight value: keywords for 400/700 (matching common convention), else numeric. */
function cssWeight(weight: number): string {
  if (weight === 400) return 'normal'
  if (weight === 700) return 'bold'
  return String(weight)
}

function fileBase(family: string): string {
  return family.replace(/\s+/g, '')
}

export function generateFonts(snapshot: DesignSystemSnapshot): GenResult {
  const warnings: string[] = []
  const faces = collectFontFaces(snapshot)

  if (faces.length === 0) {
    warnings.push('No local text styles found — fonts.css skipped.')
    return { contents: '', warnings }
  }

  const blocks = faces.map((f) => {
    const style = styleName(f.weight, f.italic)
    const base = fileBase(f.family)
    return [
      `@font-face {`,
      `  font-family: '${f.family}';`,
      `  src:`,
      `    url('/fonts/${base}-${style}.woff2') format('woff2'),`,
      `    url('/fonts/${base}-${style}.woff') format('woff');`,
      `  font-weight: ${cssWeight(f.weight)};`,
      `  font-style: ${f.italic ? 'italic' : 'normal'};`,
      `  font-display: swap;`,
      `}`,
    ].join('\n')
  })

  return { contents: blocks.join('\n') + '\n', warnings }
}
