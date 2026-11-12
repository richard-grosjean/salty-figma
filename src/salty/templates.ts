// Generates text-styles.ts from Figma text styles: a plain `textStyles` object
// (register it with defineTemplates({ textStyle: textStyles }) in your project).
//
// Each category (heading, body, button, …) gets a `base` holding the values its
// sizes share — font family, weight, line-height, letter-spacing, … (the most
// common value wins). Each size then holds its fontSize plus only the values
// that differ from the base:
//   heading: { base: { fontFamily: '{fontFamily.heading}', … },
//              large: { fontSize: '{fontSizes.heading.large}' }, … }
//
// Font size / family reference the Figma variables bound to the text style
// ({fontSizes.…} / {fontFamily.…}); unbound sizes fall back to HDClamp(px) and
// unbound families to a derived {fontFamily.main}-style token. Top-level styles
// that aren't inside a category (e.g. "Headline XL") are skipped.
//
// Desktop/mobile variants of the same style (e.g. "xxxl/desktop" + "xxxl/mobile")
// are merged into a single "xxxl". Salty templates don't support media queries,
// so the responsive size is expressed as HDClamp(desktopPx, mobilePx) — desktop
// first, mobile second. Line-height / letter-spacing are relative (%/em) and so
// viewport-independent; the desktop values are kept.

import type { DesignSystemSnapshot, ReadTextStyle } from '../types'
import { familiesOf, familyKeyMap, figmaFamilyKeys } from './fonts'
import { hdClamp, isRaw, tokenRef, weightFromSegment } from './format'
import { serialize, setPath, Tree } from './serialize'
import type { GenResult } from './variables'

function isPlainObject(v: unknown): v is Tree {
  return typeof v === 'object' && v !== null && !isRaw(v) && !Array.isArray(v)
}

/** A leaf style object (has fontSize) vs. a grouping node (nested style names). */
function isLeafStyle(v: unknown): boolean {
  return isPlainObject(v) && 'fontSize' in v
}

/**
 * Collapse the weight level so styles only ever nest down to the size level.
 * Figma text styles are named category/size/weight (e.g. `Body/Large/Regular`),
 * which would otherwise emit a third `body.large.400` key. Instead each size
 * keeps a single style whose fontWeight is: the sole child weight when only one
 * is used; regular (400) when several are used; or the style's own defined
 * weight when the name carries no weight level at all.
 *
 * Weights are only ever recognised at the third level or deeper: the first level
 * is the category (`heading`) and the second is the size (`large`), so neither is
 * folded into a fontWeight. Below that, a "weight group" is a node whose children
 * are all leaves keyed by a weight word (`regular`/`medium`/`bold`/…) — those
 * collapse to one leaf. A level that mixes weight words with other names is a size
 * scale — e.g. a heading sized `small`/`regular`/`medium`/`large` — so it's
 * descended into but never collapsed, keeping `regular`/`medium` as sizes.
 */
function isWeightKey(k: string): boolean {
  return weightFromSegment(k) !== null
}

// `level` is the hierarchy level of node's children (categories = 1). A weight
// group's members sit one level below, so collapsing at level >= 2 keeps weights
// out of the first (category) and second (size) levels.
function collapseWeights(node: Tree, level: number): void {
  for (const k of Object.keys(node)) {
    const child = node[k]
    if (!isPlainObject(child) || isLeafStyle(child)) continue
    const keys = Object.keys(child)
    const allWeights =
      keys.length > 0 && keys.every((ck) => isWeightKey(ck) && isLeafStyle(child[ck]))
    if (level >= 2 && allWeights) {
      node[k] = pickWeight(child) // weight group -> single leaf
    } else {
      collapseWeights(child, level + 1) // size (or higher) level -> descend
    }
  }
}

/** Pick the single leaf for a collapsed weight group (see collapseWeights). */
function pickWeight(group: Tree): Tree {
  const leaves = Object.keys(group).map((k) => group[k] as Tree)
  if (leaves.length === 1) return leaves[0]
  // Several weights -> default to regular (400), keeping a regular variant's
  // metrics when present (size metrics are identical across weights anyway).
  const base = leaves.find((l) => l.fontWeight === 400) ?? leaves[0]
  return { ...base, fontWeight: 400 }
}

type Viewport = 'desktop' | 'mobile'

function viewportOf(seg: string): Viewport | null {
  const s = seg.toLowerCase()
  return s === 'desktop' ? 'desktop' : s === 'mobile' ? 'mobile' : null
}

/** Strip a desktop/mobile segment from a text-style path -> merged key + which viewport. */
function splitViewport(path: string[]): { key: string[]; viewport: Viewport | null } {
  const idx = path.findIndex((seg) => viewportOf(seg) !== null)
  if (idx === -1) return { key: path, viewport: null }
  return {
    key: [...path.slice(0, idx), ...path.slice(idx + 1)],
    viewport: viewportOf(path[idx]),
  }
}

function familyRef(s: ReadTextStyle, familyKeys: Map<string, string>): string {
  if (s.fontFamilyRef) return tokenRef(s.fontFamilyRef)
  const key = familyKeys.get(s.fontFamily)
  // Reference the fontFamily.* token (defined in variables.css.ts); fall back to
  // the raw family if the font has no text style / token.
  return key ? tokenRef(`fontFamily.${key}`) : s.fontFamily
}

/**
 * Full style object for one size. Font size is the bound {fontSizes.…} variable
 * (responsive via its desktop/mobile modes); without one it's HDClamp(desktop),
 * or HDClamp(desktop, mobile) when a mobile text style variant exists.
 * textTransform / textDecoration are always present here (incl. 'none') so the
 * base extraction can compare them; 'none' is dropped again afterwards.
 */
function styleObject(
  s: ReadTextStyle,
  familyKeys: Map<string, string>,
  mobile?: ReadTextStyle,
): Tree {
  const obj: Tree = {
    fontSize: s.fontSizeRef
      ? tokenRef(s.fontSizeRef)
      : mobile
        ? hdClamp(s.fontSize, mobile.fontSize)
        : hdClamp(s.fontSize),
    fontFamily: familyRef(s, familyKeys),
  }
  if (s.fontWeight !== null) obj.fontWeight = s.fontWeight
  obj.lineHeight = s.lineHeight
  obj.letterSpacing = s.letterSpacing
  obj.textTransform = s.textTransform
  obj.textDecoration = s.textDecoration
  return obj
}

/** Properties moved into a category's `base`, in output order. */
const BASE_PROPS = [
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'textDecoration',
]

/** CSS initial values: a base/size never needs to state these. */
const INITIAL: Record<string, string> = { textTransform: 'none', textDecoration: 'none' }

const ABSENT = '\u0000absent'

function valueKey(v: unknown): string {
  return v === undefined ? ABSENT : JSON.stringify(v)
}

/** Most common value of `prop` across the leaves (ties: first seen). */
function commonValue(leaves: Tree[], prop: string): unknown {
  const counts = new Map<string, { value: unknown; n: number }>()
  for (const l of leaves) {
    const k = valueKey(l[prop])
    const c = counts.get(k)
    if (c) c.n++
    else counts.set(k, { value: l[prop], n: 1 })
  }
  let best: { value: unknown; n: number } | undefined
  for (const c of counts.values()) if (!best || c.n > best.n) best = c
  return best?.value
}

/**
 * Split each group of sizes into a shared `base` + per-size overrides. Applied
 * to every node below the root that directly holds size leaves.
 */
function extractBases(node: Tree, isRoot: boolean, warnings: string[], path: string[]): Tree {
  const out: Tree = {}
  const keys = Object.keys(node)
  const leafKeys = keys.filter((k) => isLeafStyle(node[k]))
  const leaves = leafKeys.map((k) => node[k] as Tree)

  let base: Tree | null = null
  if (!isRoot && leaves.length) {
    if ('base' in node) {
      warnings.push(`"${path.join('/')}" has a style named "base"; shared values not extracted.`)
    } else {
      base = {}
      for (const prop of BASE_PROPS) {
        const v = commonValue(leaves, prop)
        if (v !== undefined && v !== INITIAL[prop]) base[prop] = v
      }
      out.base = base
    }
  }

  for (const k of keys) {
    const child = node[k]
    if (!isPlainObject(child)) continue
    if (!isLeafStyle(child)) {
      out[k] = extractBases(child, false, warnings, [...path, k])
      continue
    }
    const size: Tree = { fontSize: child.fontSize }
    for (const prop of BASE_PROPS) {
      const v = child[prop]
      if (v === undefined) continue
      const inherited = base ? (base[prop] ?? INITIAL[prop]) : INITIAL[prop]
      if (valueKey(v) !== valueKey(inherited)) size[prop] = v
    }
    out[k] = size
  }
  return out
}

interface StyleGroup {
  key: string[]
  desktop?: ReadTextStyle
  mobile?: ReadTextStyle
  plain?: ReadTextStyle
}

export function generateTemplates(snapshot: DesignSystemSnapshot): GenResult {
  const warnings: string[] = []

  if (snapshot.textStyles.length === 0) {
    warnings.push('No local text styles found — text-styles.ts skipped.')
    return { contents: '', warnings }
  }

  const familyKeys = familyKeyMap(familiesOf(snapshot), figmaFamilyKeys(snapshot.collections))

  // Group desktop/mobile variants under a shared (viewport-stripped) key.
  const groups = new Map<string, StyleGroup>()
  const order: string[] = []
  for (const s of snapshot.textStyles) {
    const path = s.path.length ? s.path : [s.name]
    const { key, viewport } = splitViewport(path)
    const id = key.join(' ')
    let g = groups.get(id)
    if (!g) {
      g = { key }
      groups.set(id, g)
      order.push(id)
    }
    if (viewport === 'desktop') g.desktop = s
    else if (viewport === 'mobile') g.mobile = s
    else g.plain = s
  }

  const loose: string[] = []
  const grouped: Tree = {}
  for (const id of order) {
    const g = groups.get(id)!
    const base = g.desktop ?? g.plain ?? g.mobile
    if (!base) continue
    // Only styles inside a category (heading/large, …) are exported.
    if (g.key.length < 2) {
      loose.push(base.name)
      continue
    }

    const mobile = g.mobile && g.mobile !== base ? g.mobile : undefined
    const obj = styleObject(base, familyKeys, mobile)
    setPath(grouped, g.key, obj)
  }
  if (loose.length) {
    warnings.push(
      `Skipped ${loose.length} text style(s) not inside a category: ${loose.join(', ')}.`,
    )
  }

  // Collapse the weight level so styles nest only down to the size level.
  // Children of the root are categories (level 1).
  collapseWeights(grouped, 1)

  const textStyles = extractBases(grouped, true, warnings, [])
  const body = serialize(textStyles)

  const lines: string[] = [
    ...(body.includes('HDClamp(') ? [`import { HDClamp } from './helpers';`, ''] : []),
    `export const textStyles = ${body} as const;`,
    '',
  ]

  return { contents: lines.join('\n'), warnings }
}
