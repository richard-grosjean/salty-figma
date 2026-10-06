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
import { findThemeCollection } from './config'
import {
  dottedName,
  expandSizeSegment,
  num,
  renameSegment,
  rgbaToCss,
  leafPaths,
  splitName,
} from './format'

type VarCache = Map<string, Variable | null>

async function getVar(id: string, cache: VarCache): Promise<Variable | null> {
  let v = cache.get(id)
  if (v === undefined) {
    v = await figma.variables.getVariableByIdAsync(id)
    cache.set(id, v)
  }
  return v
}

function isAlias(v: unknown): v is VariableAlias {
  return !!v && typeof v === 'object' && (v as VariableAlias).type === 'VARIABLE_ALIAS'
}

// Variable expression args arrive wrapped as `{ resolvedType, value }`.
function unwrapArg(a: unknown): unknown {
  return a && typeof a === 'object' && !('id' in a) && 'value' in a
    ? (a as { value: unknown }).value
    : a
}

/**
 * A color composed from another color + opacity (Figma's "color @ N%"). Written
 * as `{color, opacity}`, read back as a COMPOSE_COLOR expression; accept both.
 * Opacity is 0..100 and may itself be a FLOAT alias.
 */
function composedParts(val: unknown): { color: unknown; opacity: unknown } | null {
  if (!val || typeof val !== 'object') return null
  const o = val as Record<string, unknown>
  if (o.type === 'VARIABLE_EXPRESSION') {
    const args = o.expressionArguments
    if (o.expressionFunction !== 'COMPOSE_COLOR' || !Array.isArray(args)) return null
    return { color: unwrapArg(args[0]), opacity: unwrapArg(args[1]) }
  }
  if ('color' in o && 'opacity' in o) return { color: o.color, opacity: o.opacity }
  return null
}

/** Resolve a variable value to RGBA or a number, following aliases in their default mode. */
export async function resolveValue(
  val: unknown,
  cache: VarCache,
  depth = 0,
): Promise<RGBA | number | null> {
  if (val == null || depth > 12) return null
  if (typeof val === 'number') return val
  if (typeof val !== 'object') return null
  if (isAlias(val)) {
    const t = await getVar(val.id, cache)
    if (!t) return null
    const col = await figma.variables.getVariableCollectionByIdAsync(t.variableCollectionId)
    const modeId = col?.defaultModeId ?? Object.keys(t.valuesByMode)[0]
    return resolveValue(t.valuesByMode[modeId], cache, depth + 1)
  }
  const parts = composedParts(val)
  if (parts) {
    const base = await resolveValue(parts.color, cache, depth + 1)
    if (!base || typeof base !== 'object') return null
    const pct = await resolveValue(parts.opacity, cache, depth + 1)
    // Figma ignores the opacity when the source color is already translucent.
    if (typeof pct !== 'number' || base.a < 1) return base
    return { ...base, a: Math.min(1, Math.max(0, pct / 100)) }
  }
  const c = val as RGBA
  if (typeof c.r !== 'number') return null
  return { r: c.r, g: c.g, b: c.b, a: 'a' in c && typeof c.a === 'number' ? c.a : 1 }
}

function colorValue(c: RGBA): ReadValue {
  return { kind: 'color', hex: rgbaToCss(c.r, c.g, c.b, c.a), r: c.r, g: c.g, b: c.b, a: c.a }
}

async function aliasPath(alias: VariableAlias, cache: VarCache): Promise<string> {
  const target = await getVar(alias.id, cache)
  return target ? dottedName(target.name, target.resolvedType === 'COLOR') : alias.id
}

async function readValue(value: VariableValue, cache: VarCache): Promise<ReadValue> {
  if (typeof value === 'boolean') return { kind: 'boolean', value }
  if (typeof value === 'number') return { kind: 'number', value: num(value) }
  if (typeof value === 'string') return { kind: 'string', value }

  // Alias -> resolve to the target variable's dotted path.
  if (isAlias(value)) return { kind: 'alias', path: await aliasPath(value, cache) }

  // Color @ opacity -> plain rgba() of the resolved color.
  if (composedParts(value)) {
    const resolved = await resolveValue(value, cache)
    if (!resolved || typeof resolved !== 'object') return { kind: 'string', value: 'transparent' }
    return colorValue(resolved)
  }

  // RGB / RGBA color.
  const rgba = value as RGBA
  return colorValue({ r: rgba.r, g: rgba.g, b: rgba.b, a: 'a' in rgba ? rgba.a : 1 })
}

async function readCollection(collection: VariableCollection): Promise<ReadCollection> {
  const cache: VarCache = new Map()
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

/**
 * Canonicalise segments (headline -> heading, r -> regular) and expand t-shirt
 * size abbreviations ("xxxl" -> "xxxLarge"). Weight segments are left as words:
 * the templates generator decides which level is a weight (from its siblings)
 * and folds it into the style's `fontWeight`, so a size named `Headline/Medium`
 * stays "medium" instead of being mistaken for a 500 weight.
 */
function textStylePath(name: string): string[] {
  return splitName(name).map((s) => expandSizeSegment(renameSegment(s)))
}

async function readTextStyle(style: TextStyle): Promise<ReadTextStyle> {
  const fontWeight = weightFromStyle(style.fontName.style)
  return {
    name: style.name,
    path: textStylePath(style.name),
    fontFamily: style.fontName.family,
    fontStyle: style.fontName.style,
    fontSize: num(style.fontSize),
    fontWeight,
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

/**
 * Read every local variable collection. Palette paths that are also groups are
 * moved under LEAF_KEY, and alias refs are rewritten to match, so variables,
 * themes and codegen all agree on where each token lives.
 */
export async function readCollections(): Promise<ReadCollection[]> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync()
  const read: ReadCollection[] = []
  for (const c of collections) read.push(await readCollection(c))

  const theme = findThemeCollection(read)
  const palette = read.filter((c) => c !== theme).flatMap((c) => c.variables)
  const fix = leafPaths(palette.map((v) => v.path))
  for (const v of palette) v.path = fix(v.path)
  for (const c of read) {
    for (const v of c.variables) {
      for (const val of Object.values(v.valuesByMode)) {
        if (val.kind === 'alias') val.path = fix(val.path.split('.')).join('.')
      }
    }
  }
  return read
}

export async function readDesignSystem(): Promise<DesignSystemSnapshot> {
  const collections = await readCollections()

  const styles = await figma.getLocalTextStylesAsync()
  const textStyles: ReadTextStyle[] = []
  for (const s of styles) {
    textStyles.push(await readTextStyle(s))
  }

  return { collections, textStyles }
}
