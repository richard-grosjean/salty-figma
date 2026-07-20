/// <reference types="@figma/plugin-typings" />
// Reads the current document's variables and text styles into plain,
// serializable snapshots (see types.ts). All Figma async API access lives here.

import type {
  DesignSystemSnapshot,
  ReadCollection,
  ReadTextStyle,
  ReadValue,
  ReadVariable,
  ResolvedType,
} from '../types'
import { dottedName, num, rgbaToCss, splitName } from './format'

async function readValue(
  value: VariableValue,
  cache: Map<string, Variable | null>,
): Promise<ReadValue> {
  if (typeof value === 'boolean') return { kind: 'boolean', value }
  if (typeof value === 'number') return { kind: 'number', value: num(value) }
  if (typeof value === 'string') return { kind: 'string', value }

  // Alias -> resolve to the target variable's dotted path.
  if ('type' in value && value.type === 'VARIABLE_ALIAS') {
    let target = cache.get(value.id)
    if (target === undefined) {
      target = await figma.variables.getVariableByIdAsync(value.id)
      cache.set(value.id, target)
    }
    return {
      kind: 'alias',
      path: target ? dottedName(target.name, target.resolvedType === 'COLOR') : value.id,
    }
  }

  // RGB / RGBA color.
  const rgba = value as RGBA
  const a = 'a' in rgba ? rgba.a : 1
  return {
    kind: 'color',
    hex: rgbaToCss(rgba.r, rgba.g, rgba.b, a),
    r: rgba.r,
    g: rgba.g,
    b: rgba.b,
    a,
  }
}

async function readCollection(collection: VariableCollection): Promise<ReadCollection> {
  const cache = new Map<string, Variable | null>()
  const variables: ReadVariable[] = []

  for (const id of collection.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id)
    if (!v) continue
    const valuesByMode: Record<string, ReadValue> = {}
    for (const modeId of Object.keys(v.valuesByMode)) {
      valuesByMode[modeId] = await readValue(v.valuesByMode[modeId], cache)
    }
    variables.push({
      name: v.name,
      path: splitName(v.name, v.resolvedType === 'COLOR'),
      resolvedType: v.resolvedType as ResolvedType,
      valuesByMode,
    })
  }

  return {
    id: collection.id,
    name: collection.name,
    defaultModeId: collection.defaultModeId,
    modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
    variables,
  }
}

// Font-related metrics are always expressed relative to the font size:
// line-height as a percentage of it, letter-spacing in em. A PIXELS value from
// Figma is divided by the style's font size to make it relative.

function lineHeightToCss(lh: LineHeight, fontSize: number): string {
  if (lh.unit === 'AUTO') return 'normal'
  if (lh.unit === 'PERCENT') return `${num(lh.value)}%`
  // PIXELS -> percentage of the font size.
  if (fontSize > 0) return `${num((lh.value / fontSize) * 100, 2)}%`
  return `${num(lh.value)}px`
}

function letterSpacingToCss(ls: LetterSpacing, fontSize: number): string {
  if (ls.unit === 'PERCENT') return `${num(ls.value / 100, 4)}em`
  // PIXELS -> em (relative to the font size).
  if (fontSize > 0) return `${num(ls.value / fontSize, 4)}em`
  return `${num(ls.value)}px`
}

/** Map a Figma font style ("Medium", "Bold", "Regular Italic") to a numeric weight. */
function weightFromStyle(style: string): number | null {
  const s = style.toLowerCase()
  const table: Array<[string, number]> = [
    ['thin', 100],
    ['extralight', 200],
    ['extra light', 200],
    ['ultralight', 200],
    ['semibold', 600],
    ['semi bold', 600],
    ['demibold', 600],
    ['extrabold', 800],
    ['extra bold', 800],
    ['ultrabold', 800],
    ['light', 300],
    ['regular', 400],
    ['normal', 400],
    ['medium', 500],
    ['bold', 700],
    ['black', 900],
    ['heavy', 900],
  ]
  for (const [needle, weight] of table) {
    if (s.includes(needle)) return weight
  }
  return null
}

async function readTextStyle(style: TextStyle): Promise<ReadTextStyle> {
  return {
    name: style.name,
    path: splitName(style.name),
    fontFamily: style.fontName.family,
    fontStyle: style.fontName.style,
    fontSize: num(style.fontSize),
    fontWeight: weightFromStyle(style.fontName.style),
    lineHeight: lineHeightToCss(style.lineHeight, style.fontSize),
    letterSpacing: letterSpacingToCss(style.letterSpacing, style.fontSize),
    textTransform:
      style.textCase === 'UPPER'
        ? 'uppercase'
        : style.textCase === 'LOWER'
          ? 'lowercase'
          : style.textCase === 'TITLE'
            ? 'capitalize'
            : 'none',
    textDecoration:
      style.textDecoration === 'UNDERLINE'
        ? 'underline'
        : style.textDecoration === 'STRIKETHROUGH'
          ? 'line-through'
          : 'none',
  }
}

export async function readDesignSystem(): Promise<DesignSystemSnapshot> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync()
  const readCollections: ReadCollection[] = []
  for (const c of collections) {
    readCollections.push(await readCollection(c))
  }

  const styles = await figma.getLocalTextStylesAsync()
  const textStyles: ReadTextStyle[] = []
  for (const s of styles) {
    textStyles.push(await readTextStyle(s))
  }

  return { collections: readCollections, textStyles }
}
