// Generates themes.css.ts from the semantic THEME variable collection.
// Each mode (Light / Dark / Grey / …) becomes an entry in `themes`, and the
// whole thing is wired into Salty via defineVariables({ conditional: { theme } }).

import type { DesignSystemSnapshot, ReadValue } from '../types'
import { findThemeCollection } from './config'
import { camelCase, isRaw, tokenRef } from './format'
import { serialize, setPath, Tree } from './serialize'
import type { GenResult } from './variables'

function themeKey(modeName: string): string {
  return camelCase(modeName)
}

function themeValue(val: ReadValue | undefined): string | undefined {
  if (!val) return undefined
  if (val.kind === 'alias') return tokenRef(val.path)
  if (val.kind === 'color') return val.hex
  if (val.kind === 'string') return val.value
  if (val.kind === 'number') return String(val.value)
  return undefined
}

// ---------------------------------------------------------------------------
// Theme interface generation.
//
// The `values` shape is derived from the union of every mode's values: each
// leaf is typed `string`, and a key is `required` only when every mode provides
// it (optional `?` otherwise). This keeps the generated `themes` object
// checkable via `satisfies` while tolerating values that only some modes set.
// ---------------------------------------------------------------------------

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** null marks a leaf (typed `string`); an object marks a nested group. */
type TypeTree = { [key: string]: TypeTree | null }

function isPlainObject(v: unknown): v is Tree {
  return v !== null && typeof v === 'object' && !isRaw(v) && !Array.isArray(v)
}

/** Collect the dotted path of every defined leaf in a values tree. */
function collectLeaves(tree: Tree, prefix: string[], out: string[][]): void {
  for (const [k, v] of Object.entries(tree)) {
    if (v === undefined) continue
    if (isPlainObject(v)) collectLeaves(v, [...prefix, k], out)
    else out.push([...prefix, k])
  }
}

/** Merge a leaf path into the union type tree (promoting leaf -> group on conflict). */
function addToUnion(union: TypeTree, path: string[]): void {
  let node = union
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    if (!isPlainObject(node[seg])) node[seg] = {}
    node = node[seg] as TypeTree
  }
  const leaf = path[path.length - 1]
  if (node[leaf] === undefined) node[leaf] = null
}

function emitValuesType(
  node: TypeTree,
  prefix: string[],
  presence: Map<string, number>,
  modeCount: number,
  indent: number,
): string {
  const keys = Object.keys(node)
  if (keys.length === 0) return '{}'
  const pad = '  '.repeat(indent)
  const padIn = '  '.repeat(indent + 1)
  const lines = keys.map((k) => {
    const path = [...prefix, k]
    const optional = (presence.get(path.join('.')) ?? 0) < modeCount ? '?' : ''
    const key = IDENT.test(k) ? k : JSON.stringify(k)
    const child = node[k]
    const type = child === null ? 'string' : emitValuesType(child, path, presence, modeCount, indent + 1)
    return `${padIn}${key}${optional}: ${type};`
  })
  return `{\n${lines.join('\n')}\n${pad}}`
}

/** Build the `Theme["values"]` type source from every mode's values tree. */
function themeValuesType(modeValues: Tree[], modeCount: number): string {
  const union: TypeTree = {}
  const presence = new Map<string, number>()
  for (const values of modeValues) {
    const leaves: string[][] = []
    collectLeaves(values, [], leaves)
    const counted = new Set<string>()
    for (const path of leaves) {
      addToUnion(union, path)
      for (let i = 1; i <= path.length; i++) {
        const key = path.slice(0, i).join('.')
        if (!counted.has(key)) {
          counted.add(key)
          presence.set(key, (presence.get(key) ?? 0) + 1)
        }
      }
    }
  }
  return emitValuesType(union, [], presence, modeCount, 1)
}

export function generateThemes(snapshot: DesignSystemSnapshot): GenResult {
  const warnings: string[] = []
  const collection = findThemeCollection(snapshot.collections)

  if (!collection) {
    warnings.push(
      'No theme collection detected (looked for a collection named theme/semantic or with Light/Dark modes). themes.css.ts skipped.',
    )
    return { contents: '', warnings }
  }

  const themes: Tree = {}
  const seen = new Set<string>()
  const modeValues: Tree[] = []

  for (const mode of collection.modes) {
    let key = themeKey(mode.name)
    while (seen.has(key)) key += '_'
    seen.add(key)

    const values: Tree = {}
    for (const v of collection.variables) {
      setPath(values, v.path, themeValue(v.valuesByMode[mode.modeId]))
    }
    modeValues.push(values)
    themes[key] = { title: mode.name, values }
  }

  const valuesType = themeValuesType(modeValues, collection.modes.length)

  const keys = Object.keys(themes)
  const conditionalTheme: Tree = {}
  for (const k of keys) conditionalTheme[k] = { __raw: `themes.${k}.values` }

  const lines: string[] = [
    `import { defineVariables } from '@salty-css/core/config';`,
    '',
    `export interface Theme {`,
    `  /** Human-readable name of the theme (its Figma mode name). */`,
    `  title: string;`,
    `  /** Semantic theme values, as Salty token references. */`,
    `  values: ${valuesType};`,
    `}`,
    '',
    `export const themes = ${serialize(themes)} as const satisfies Record<string, Theme>;`,
    '',
    `export type Themes = typeof themes;`,
    `export type ThemeName = keyof Themes;`,
    '',
    `export default defineVariables(${serialize({ conditional: { theme: conditionalTheme } })});`,
    '',
  ]

  return { contents: lines.join('\n'), warnings }
}
