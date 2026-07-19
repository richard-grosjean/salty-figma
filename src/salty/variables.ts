// Generates variables.css.ts from Figma variable collections.
//
// v1 mapping heuristics (tune in config.ts once we see the real Figma file):
//   COLOR / STRING / BOOLEAN  -> top-level group at the variable's path
//   FLOAT in a scaling group   -> responsive.base = HDClamp(desktop),
//                                 responsive['@largeMobileDown'] = MobileClamp(mobile)
//   FLOAT in fontWeights/zIndex -> top-level raw number (never clamped)

import type { DesignSystemSnapshot, ReadCollection, ReadValue, ReadVariable } from '../types'
import { classifyModes, findThemeCollection, isNonClampGroup } from './config'
import { hdClamp, mobileClamp, Raw, tokenRef } from './format'
import { serialize, setPath, Tree } from './serialize'

export interface GenResult {
  contents: string
  warnings: string[]
}

function pickValue(v: ReadVariable, modeId: string): ReadValue | undefined {
  return v.valuesByMode[modeId] ?? v.valuesByMode[Object.keys(v.valuesByMode)[0]]
}

function staticValue(val: ReadValue | undefined): string | number | boolean | Raw | undefined {
  if (!val) return undefined
  switch (val.kind) {
    case 'color':
      return val.hex
    case 'string':
      return val.value
    case 'number':
      return val.value
    case 'boolean':
      return val.value
    case 'alias':
      return tokenRef(val.path)
  }
}

export function generateVariables(snapshot: DesignSystemSnapshot): GenResult {
  const warnings: string[] = []
  const themeCollection = findThemeCollection(snapshot.collections)
  const collections = snapshot.collections.filter((c) => c !== themeCollection)

  if (collections.length === 0) {
    warnings.push('No non-theme variable collections found — variables.css.ts will be empty.')
  }

  const top: Tree = {}
  const base: Tree = {}
  const mobile: Tree = {}
  let usedHDClamp = false
  let usedMobileClamp = false

  for (const collection of collections) {
    const { desktopModeId, mobileModeId } = classifyModes(collection)

    for (const v of collection.variables) {
      const group = v.path[0] ?? 'misc'
      const desktop = pickValue(v, desktopModeId)

      // Non-clamp: colors, strings, booleans, and numeric groups like fontWeights/zIndex.
      const isFloat = v.resolvedType === 'FLOAT'
      const clampable = isFloat && !isNonClampGroup(group)

      if (!clampable) {
        setPath(top, v.path, staticValue(desktop))
        continue
      }

      // Clampable FLOAT -> responsive.base (+ mobile override when present).
      const desktopNum = desktop && desktop.kind === 'number' ? desktop.value : undefined
      if (desktop && desktop.kind === 'alias') {
        setPath(base, v.path, tokenRef(desktop.path))
      } else if (desktopNum !== undefined) {
        setPath(base, v.path, hdClamp(desktopNum))
        usedHDClamp = true
      } else {
        warnings.push(`"${v.name}": desktop value is not numeric; skipped.`)
      }

      if (mobileModeId) {
        const mob = pickValue(v, mobileModeId)
        if (mob && mob.kind === 'number') {
          setPath(mobile, v.path, mobileClamp(mob.value))
          usedMobileClamp = true
        } else if (mob && mob.kind === 'alias') {
          setPath(mobile, v.path, tokenRef(mob.path))
        }
      }
    }
  }

  const root: Tree = { ...top }
  const responsive: Tree = {}
  if (Object.keys(base).length) responsive.base = base
  if (Object.keys(mobile).length) responsive['@largeMobileDown'] = mobile
  if (Object.keys(responsive).length) root.responsive = responsive

  const helperImports: string[] = []
  if (usedHDClamp) helperImports.push('HDClamp')
  if (usedMobileClamp) helperImports.push('MobileClamp')

  const lines: string[] = [`import { defineVariables } from '@salty-css/core/config';`]
  if (helperImports.length) {
    lines.push(`import { ${helperImports.join(', ')} } from './helpers.css';`)
  }
  lines.push('')
  lines.push(`export default defineVariables(${serialize(root)});`)
  lines.push('')

  return { contents: lines.join('\n'), warnings }
}
