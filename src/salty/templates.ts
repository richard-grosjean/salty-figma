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
import { hdClamp, tokenRef } from './format'
import { serialize, setPath, Tree } from './serialize'
import type { GenResult } from './variables'

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
