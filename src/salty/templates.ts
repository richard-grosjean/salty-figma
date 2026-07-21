// Generates templates.css.ts from Figma text styles, as Salty defineTemplates
// under a `textStyle` template group. Font sizes are wrapped in HDClamp(px);
// line-height / letter-spacing keep their CSS unit strings.
//
// Desktop/mobile variants of the same style (e.g. "xxxl/desktop" + "xxxl/mobile")
// are merged into a single "xxxl". Salty templates don't support media queries,
// so the responsive size is expressed as HDClamp(desktopPx, mobilePx) — desktop
// first, mobile second. Line-height / letter-spacing are relative (%/em) and so
// viewport-independent; the desktop values are kept.

import type { DesignSystemSnapshot, ReadTextStyle } from '../types'
import { familiesOf, familyKeyMap } from './fonts'
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
  const key = familyKeys.get(s.fontFamily)
  // Reference the fontFamily.* token (defined in variables.css.ts); fall back to
  // the raw family if the font has no text style / token.
  return key ? tokenRef(`fontFamily.${key}`) : s.fontFamily
}

/**
 * Style object for a template. Font size is HDClamp(desktop); when a mobile
 * variant exists it becomes HDClamp(desktop, mobile) so the size scales down
 * without a media query.
 */
function styleObject(
  s: ReadTextStyle,
  familyKeys: Map<string, string>,
  mobile?: ReadTextStyle,
): Tree {
  const obj: Tree = {
    fontFamily: familyRef(s, familyKeys),
    fontSize: mobile ? hdClamp(s.fontSize, mobile.fontSize) : hdClamp(s.fontSize),
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
  }
  if (s.fontWeight !== null) obj.fontWeight = s.fontWeight
  if (s.textTransform !== 'none') obj.textTransform = s.textTransform
  if (s.textDecoration !== 'none') obj.textDecoration = s.textDecoration
  return obj
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
    warnings.push('No local text styles found — templates.css.ts skipped.')
    return { contents: '', warnings }
  }

  const familyKeys = familyKeyMap(familiesOf(snapshot))

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

  const textStyles: Tree = {}
  for (const id of order) {
    const g = groups.get(id)!
    const base = g.desktop ?? g.plain ?? g.mobile
    if (!base) continue

    const mobile = g.mobile && g.mobile !== base ? g.mobile : undefined
    const obj = styleObject(base, familyKeys, mobile)
    setPath(textStyles, g.key.length ? g.key : [base.name], obj)
  }

  // Collapse the weight level so styles nest only down to the size level.
  // Children of the root are categories (level 1).
  collapseWeights(textStyles, 1)

  const lines: string[] = [
    `import { defineTemplates } from '@salty-css/core/factories';`,
    `import { HDClamp } from './helpers.css';`,
    '',
    `export const textStyles = ${serialize(textStyles)} as const;`,
    '',
    `export default defineTemplates({`,
    `  textStyle: {`,
    `    ...textStyles,`,
    `  },`,
    `});`,
    '',
  ]

  return { contents: lines.join('\n'), warnings }
}
