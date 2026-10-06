/// <reference types="@figma/plugin-typings" />
// Dev Mode codegen: turn the selected node into a Salty CSS snippet.
//   styled    -> export const Name = styled('tag', { base: { … } })
//   className -> export const nameStyles = className({ base: { … } })
//
// Colors resolve to token refs ({colors.x}) via a cached index built from the
// document's COLOR variables; numeric values fall back to HDClamp(px).

import { hdClamp, num, rgbaToCss, tokenRef, Raw } from './format'
import { familyKeyMap } from './fonts'
import { readCollections } from './read'
import { serialize, Tree } from './serialize'

// hexUppercase -> dotted token path, e.g. "#3EF58F" -> "colors.green"
let colorIndex: Map<string, string> | null = null

// fontFamily -> token key ("main"/"secondary"/…), so Dev Mode output references
// {fontFamily.main} to match fonts.css / templates.css.ts.
let fontFamilyIndex: Map<string, string> | null = null

export async function buildFontFamilyIndex(): Promise<Map<string, string>> {
  const styles = await figma.getLocalTextStylesAsync()
  return familyKeyMap(styles.map((s) => s.fontName.family))
}

function resolveFontFamily(family: string): string {
  const key = fontFamilyIndex?.get(family)
  return key ? tokenRef(`fontFamily.${key}`) : family
}

export async function buildColorIndex(): Promise<Map<string, string>> {
  // Same snapshot as the exporter, so refs match variables.css.ts paths exactly.
  const index = new Map<string, string>()
  for (const c of await readCollections()) {
    for (const v of c.variables) {
      if (v.resolvedType !== 'COLOR') continue
      const val = v.valuesByMode[c.defaultModeId]
      if (val?.kind !== 'color') continue
      const css = rgbaToCss(val.r, val.g, val.b, val.a).toUpperCase()
      const path = v.path.join('.')
      if (!index.has(css)) index.set(css, path)
    }
  }
  return index
}

function resolveColor(css: string): string {
  const hit = colorIndex?.get(css.toUpperCase())
  return hit ? tokenRef(hit) : css
}

function paintToColor(paint: Paint | undefined): string | undefined {
  if (!paint || paint.visible === false || paint.type !== 'SOLID') return undefined
  const a = paint.opacity ?? 1
  return resolveColor(rgbaToCss(paint.color.r, paint.color.g, paint.color.b, a))
}

function firstVisibleSolid(fills: unknown): Paint | undefined {
  if (!Array.isArray(fills)) return undefined
  return fills.find((f: Paint) => f.visible !== false && f.type === 'SOLID')
}

// --- Gradients ---------------------------------------------------------------
// Figma paints map to CSS backgrounds:
//   GRADIENT_LINEAR  -> linear-gradient(<deg>, <stops>)
//   GRADIENT_RADIAL  -> radial-gradient(<rx> <ry> at <cx> <cy>, <stops>)
//   GRADIENT_ANGULAR -> conic-gradient(from <deg> at <cx> <cy>, <stops>)
//   GRADIENT_DIAMOND -> approximated as radial-gradient (no CSS equivalent)
// Direction/placement is recovered from `gradientTransform` (object-normalized
// space); stop colours resolve to {colors.x} refs like everywhere else.

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360
}

function pct(n: number): string {
  return `${num(n * 100, 1)}%`
}

/** Invert a 2x3 affine transform ([[a,b,tx],[c,d,ty]]); null if singular. */
function invert(t: Transform): Transform | null {
  const [[a, b, tx], [c, d, ty]] = t
  const det = a * d - b * c
  if (!det) return null
  const ia = d / det
  const ib = -b / det
  const ic = -c / det
  const id = a / det
  return [
    [ia, ib, -(ia * tx + ib * ty)],
    [ic, id, -(ic * tx + id * ty)],
  ]
}

/** `<color> <pos>%, …` for a gradient's stops, folding in the paint opacity. */
function gradientStops(paint: GradientPaint): string {
  const o = paint.opacity ?? 1
  return paint.gradientStops
    .map((s) => {
      const a = ('a' in s.color ? s.color.a : 1) * o
      const col = resolveColor(rgbaToCss(s.color.r, s.color.g, s.color.b, a))
      return `${col} ${num(s.position * 100, 1)}%`
    })
    .join(', ')
}

function gradientToCss(paint: GradientPaint): string {
  const stops = gradientStops(paint)
  if (paint.type === 'GRADIENT_LINEAR') {
    // Gradient increases along (a, b) in object space (y-down); convert to a CSS
    // angle measured clockwise from "up".
    const [a, b] = paint.gradientTransform[0]
    const deg = Math.round(norm360((Math.atan2(a, -b) * 180) / Math.PI))
    return `linear-gradient(${deg}deg, ${stops})`
  }
  // Radial / angular / diamond are centred; recover the handle points from the
  // inverse transform: p0 = centre, p1/p2 = ends of the primary/secondary axes.
  const m = invert(paint.gradientTransform) ?? [
    [1, 0, 0],
    [0, 1, 0],
  ]
  const cx = m[0][2]
  const cy = m[1][2]
  if (paint.type === 'GRADIENT_ANGULAR') {
    const deg = Math.round(norm360((Math.atan2(m[0][0], -m[1][0]) * 180) / Math.PI))
    return `conic-gradient(from ${deg}deg at ${pct(cx)} ${pct(cy)}, ${stops})`
  }
  // GRADIENT_RADIAL and (approximated) GRADIENT_DIAMOND.
  const rx = Math.hypot(m[0][0], m[1][0])
  const ry = Math.hypot(m[0][1], m[1][1])
  return `radial-gradient(${pct(rx)} ${pct(ry)} at ${pct(cx)} ${pct(cy)}, ${stops})`
}

/** A single paint as a CSS background layer, or undefined if unsupported. */
function paintToLayer(paint: Paint): { css: string; solid: boolean } | undefined {
  if (paint.visible === false) return undefined
  if (paint.type === 'SOLID') {
    const a = paint.opacity ?? 1
    return { css: resolveColor(rgbaToCss(paint.color.r, paint.color.g, paint.color.b, a)), solid: true }
  }
  if (paint.type.startsWith('GRADIENT_')) {
    return { css: gradientToCss(paint as GradientPaint), solid: false }
  }
  return undefined // IMAGE / VIDEO / PATTERN — not supported
}

/**
 * Turn a node's `fills` into a CSS `background` value. A lone solid stays a bare
 * colour; otherwise every visible paint becomes a layer. Figma paints run
 * bottom->top, CSS layers top->bottom, so the order is reversed. Only the last
 * (bottom) CSS layer may be a bare colour, so any solid above it is emitted as a
 * `linear-gradient(c, c)` solid image.
 */
function fillsToBackground(fills: unknown): string | undefined {
  if (!Array.isArray(fills)) return undefined
  const layers = fills.map(paintToLayer).filter(Boolean) as { css: string; solid: boolean }[]
  if (layers.length === 0) return undefined
  layers.reverse()
  if (layers.length === 1 && layers[0].solid) return layers[0].css
  return layers
    .map((l, i) =>
      l.solid && i !== layers.length - 1 ? `linear-gradient(${l.css}, ${l.css})` : l.css,
    )
    .join(', ')
}

const AXIS_ALIGN: Record<string, string> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_BETWEEN: 'space-between',
  BASELINE: 'baseline',
}

function px(n: number): Raw | number {
  return n === 0 ? 0 : hdClamp(n)
}

/** Extract a Salty `base` style object from a node. */
function nodeToBase(node: SceneNode): Tree {
  const base: Tree = {}

  // Auto layout -> flex.
  const f = node as FrameNode
  if ('layoutMode' in f && f.layoutMode && f.layoutMode !== 'NONE') {
    base.display = 'flex'
    base.flexDirection = f.layoutMode === 'VERTICAL' ? 'column' : 'row'
    if (f.itemSpacing) base.gap = px(f.itemSpacing)
    if (f.primaryAxisAlignItems && f.primaryAxisAlignItems !== 'MIN') {
      base.justifyContent = AXIS_ALIGN[f.primaryAxisAlignItems]
    }
    if (f.counterAxisAlignItems && f.counterAxisAlignItems !== 'MIN') {
      base.alignItems = AXIS_ALIGN[f.counterAxisAlignItems]
    }
    const pt = f.paddingTop || 0
    const pr = f.paddingRight || 0
    const pb = f.paddingBottom || 0
    const pl = f.paddingLeft || 0
    if (pt || pr || pb || pl) {
      if (pt === pb && pr === pl && (pt || pr)) {
        base.padding = pt === pr ? px(pt) : `${fmt(pt)} ${fmt(pr)}`
      } else {
        if (pt) base.paddingTop = px(pt)
        if (pr) base.paddingRight = px(pr)
        if (pb) base.paddingBottom = px(pb)
        if (pl) base.paddingLeft = px(pl)
      }
    }
  }

  // Background (solids + gradients, layered).
  if ('fills' in node && node.type !== 'TEXT') {
    const bg = fillsToBackground((node as GeometryMixin).fills)
    if (bg) base.background = bg
  }

  // Corner radius.
  const c = node as unknown as CornerMixin
  if ('cornerRadius' in c && typeof c.cornerRadius === 'number' && c.cornerRadius > 0) {
    base.borderRadius = px(c.cornerRadius)
  }

  // Text.
  if (node.type === 'TEXT') {
    const t = node as TextNode
    const color = paintToColor(firstVisibleSolid(t.fills))
    if (color) base.color = color
    if (typeof t.fontSize === 'number') base.fontSize = px(t.fontSize)
    if (t.fontName !== figma.mixed) base.fontFamily = resolveFontFamily(t.fontName.family)
    if (t.textAlignHorizontal && t.textAlignHorizontal !== 'LEFT') {
      base.textAlign = t.textAlignHorizontal.toLowerCase()
    }
  }

  return base
}

function fmt(n: number): string {
  return `${Math.round(n)}px`
}

function pascalCase(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ')
  const pascal = parts.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : '')).join('')
  return /^[A-Za-z]/.test(pascal) ? pascal : `Component${pascal}`
}

function camelCase(name: string): string {
  const p = pascalCase(name)
  return p[0].toLowerCase() + p.slice(1)
}

const TAG_BY_TYPE: Record<string, string> = {
  TEXT: 'span',
  FRAME: 'div',
  COMPONENT: 'div',
  INSTANCE: 'div',
  GROUP: 'div',
  RECTANGLE: 'div',
  SECTION: 'section',
}

export function nodeToSnippet(node: SceneNode, style: 'styled' | 'className'): string {
  const base = nodeToBase(node)
  const body = serialize({ base })
  if (style === 'className') {
    return `import { className } from '@salty-css/react/class-name';\n\nexport const ${camelCase(node.name)}Styles = className(${body});\n`
  }
  const tag = TAG_BY_TYPE[node.type] ?? 'div'
  return `import { styled } from '@salty-css/react/styled';\n\nexport const ${pascalCase(node.name)} = styled('${tag}', ${body});\n`
}

export function registerCodegen(): void {
  figma.codegen.on('generate', async ({ node, language }) => {
    if (!colorIndex) {
      try {
        colorIndex = await buildColorIndex()
      } catch {
        colorIndex = new Map()
      }
    }
    if (!fontFamilyIndex) {
      try {
        fontFamilyIndex = await buildFontFamilyIndex()
      } catch {
        fontFamilyIndex = new Map()
      }
    }
    const style = language === 'className' ? 'className' : 'styled'
    return [
      {
        title: `Salty CSS — ${style}`,
        code: nodeToSnippet(node, style),
        language: 'TYPESCRIPT',
      },
    ]
  })
}
