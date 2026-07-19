// Generates themes.css.ts from the semantic THEME variable collection.
// Each mode (Light / Dark / Grey / …) becomes an entry in `themes`, and the
// whole thing is wired into Salty via defineVariables({ conditional: { theme } }).

import type { DesignSystemSnapshot, ReadValue } from '../types'
import { findThemeCollection } from './config'
import { camelCase, tokenRef } from './format'
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

  for (const mode of collection.modes) {
    let key = themeKey(mode.name)
    while (seen.has(key)) key += '_'
    seen.add(key)

    const values: Tree = {}
    for (const v of collection.variables) {
      setPath(values, v.path, themeValue(v.valuesByMode[mode.modeId]))
    }
    themes[key] = { title: mode.name, values }
  }

  const keys = Object.keys(themes)
  const conditionalTheme: Tree = {}
  for (const k of keys) conditionalTheme[k] = { __raw: `themes.${k}.values` }

  const lines: string[] = [
    `import { defineVariables } from '@salty-css/core/config';`,
    '',
    `export const themes = ${serialize(themes)} as const;`,
    '',
    `export type Themes = typeof themes;`,
    `export type ThemeName = keyof Themes;`,
    '',
    `export default defineVariables(${serialize({ conditional: { theme: conditionalTheme } })});`,
    '',
  ]

  return { contents: lines.join('\n'), warnings }
}
