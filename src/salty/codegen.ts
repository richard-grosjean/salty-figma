/// <reference types="@figma/plugin-typings" />
// Dev Mode codegen: turn the selected node into a Salty CSS snippet.
//   styled    -> export const Name = styled('tag', { base: { … } })
//   className -> export const nameStyles = className({ base: { … } })
//
// Colors resolve to token refs ({colors.x}) via a cached index built from the
// document's COLOR variables; numeric values fall back to HDClamp(px).

import { hdClamp, rgbaToCss, tokenRef, Raw } from './format'
import { serialize, Tree } from './serialize'

// hexUppercase -> dotted token path, e.g. "#3EF58F" -> "colors.green"
let colorIndex: Map<string, string> | null = null

export async function buildColorIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>()
  const collections = await figma.variables.getLocalVariableCollectionsAsync()
  for (const c of collections) {
    for (const id of c.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id)
      if (!v || v.resolvedType !== 'COLOR') continue
      const val = v.valuesByMode[c.defaultModeId]
      if (!val || typeof val !== 'object' || 'type' in val) continue
      const rgba = val as RGBA
      const a = 'a' in rgba ? rgba.a : 1
      const css = rgbaToCss(rgba.r, rgba.g, rgba.b, a).toUpperCase()
      const path = v.name.split('/').map((s) => s.trim()).filter(Boolean).join('.')
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

  // Background.
  if ('fills' in node && node.type !== 'TEXT') {
    const bg = paintToColor(firstVisibleSolid((node as GeometryMixin).fills))
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
    if (t.fontName !== figma.mixed) base.fontFamily = t.fontName.family
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
