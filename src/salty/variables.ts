// Generates variables.css.ts from Figma variable collections.
//
// v1 mapping heuristics (tune in config.ts once we see the real Figma file):
//   COLOR / STRING / BOOLEAN  -> top-level group at the variable's path
//   FLOAT in a scaling group   -> responsive.base = HDClamp(desktop),
//                                 responsive['@largeMobileDown'] = MobileClamp(mobile)
//   FLOAT in fontWeights/zIndex -> top-level raw number (never clamped)
//   scaling FLOATs named just a number (spacing/16) -> skipped; code uses HDClamp(16)

import type { DesignSystemSnapshot, ReadCollection, ReadValue, ReadVariable } from '../types'
import { classifyModes, findThemeCollection, isNonClampGroup } from './config'
import { baseFamilyKeys, familiesOf, figmaFamilyKeys } from './fonts'
import { hdClamp, isRaw, mobileClamp, raw, Raw, tokenRef } from './format'
import { serialize, setPath, Tree } from './serialize'

export interface GenResult {
  contents: string
  warnings: string[]
}

export interface VariablesResult extends GenResult {
  /** colors.ts — a plain module so both the Salty config and other code can import it. */
  colors: string
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

type VarIndex = Map<string, { v: ReadVariable; c: ReadCollection }>

function indexVariables(collections: ReadCollection[]): VarIndex {
  const map: VarIndex = new Map()
  for (const c of collections) for (const v of c.variables) map.set(v.id, { v, c })
  return map
}

/**
 * The number behind a value, following aliases. Each hop reads the target's
 * desktop or mobile mode (per its own collection), falling back to its default.
 */
function resolveNumber(
  val: ReadValue | undefined,
  viewport: 'desktop' | 'mobile',
  byId: VarIndex,
  depth = 0,
): number | undefined {
  if (!val || depth > 12) return undefined
  if (val.kind === 'number') return val.value
  if (val.kind !== 'alias' || !val.id) return undefined
  const hit = byId.get(val.id)
  if (!hit) return undefined
  const modes = classifyModes(hit.c)
  const modeId = (viewport === 'mobile' && modes.mobileModeId) || modes.desktopModeId
  return resolveNumber(pickValue(hit.v, modeId), viewport, byId, depth + 1)
}

/** A name that's just a number, optionally with a unit: "16", "1.5", "24px". */
function isNumericName(seg: string | undefined): boolean {
  return !!seg && /^\d+(\.\d+)?(px|rem)?$/i.test(seg)
}

export function generateVariables(snapshot: DesignSystemSnapshot): VariablesResult {
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

  // Font family layer 1 (main/secondary/…) is defined by defineFont() in
  // fonts.css.ts. Figma fontFamily.* variables become layer 2 here, pointing at
  // the layer-1 key of the family they hold: heading -> '{fontFamily.main}'.
  const textFamilies = new Set(familiesOf(snapshot))
  const baseKeys = baseFamilyKeys(familiesOf(snapshot), [...figmaFamilyKeys(snapshot.collections).keys()])

  const byId = indexVariables(snapshot.collections)

  for (const collection of collections) {
    const { desktopModeId, mobileModeId } = classifyModes(collection)

    for (const v of collection.variables) {
      const group = v.path[0] ?? 'misc'
      const desktop = pickValue(v, desktopModeId)

      // Non-clamp: colors, strings, booleans, and numeric groups like fontWeights/zIndex.
      const isFloat = v.resolvedType === 'FLOAT'
      const clampable = isFloat && !isNonClampGroup(group)

      if (v.path[0] === 'fontFamily' && desktop?.kind === 'string') {
        const base = baseKeys.get(desktop.value)
        if (base) {
          // Same key as layer 1 — already defined by defineFont(); skip.
          if (v.path.slice(1).join('.') === base) continue
          if (!textFamilies.has(desktop.value)) {
            warnings.push(
              `"${v.name}": "${desktop.value}" isn't used by any text style, so fonts.css.ts has no defineFont() for {fontFamily.${base}}.`,
            )
          }
          setPath(top, v.path, tokenRef(`fontFamily.${base}`))
          continue
        }
      }

      if (!clampable) {
        setPath(top, v.path, staticValue(desktop))
        continue
      }

      // Scale steps named after their own value (spacing/16, spacing/24px) add
      // nothing over HDClamp(16) in code, so they're skipped.
      if (isNumericName(v.path[v.path.length - 1])) continue

      // Clampable FLOAT -> responsive.base = HDClamp(desktop) and, when the
      // collection has a mobile mode, '@largeMobileDown' = MobileClamp(mobile).
      // Aliases are resolved to their number (in the target's matching mode) so
      // every value is clamped, even when it points at a skipped scale step.
      const desktopNum = resolveNumber(desktop, 'desktop', byId)
      if (desktopNum !== undefined) {
        setPath(base, v.path, hdClamp(desktopNum))
        usedHDClamp = true
      } else if (desktop?.kind === 'alias') {
        setPath(base, v.path, tokenRef(desktop.path))
        warnings.push(`"${v.name}": alias to "${desktop.path}" couldn't be resolved; kept as a token ref.`)
      } else {
        warnings.push(`"${v.name}": desktop value is not numeric; skipped.`)
      }

      if (mobileModeId) {
        const mob = pickValue(v, mobileModeId)
        const mobileNum = resolveNumber(mob, 'mobile', byId)
        if (mobileNum !== undefined) {
          setPath(mobile, v.path, mobileClamp(mobileNum))
          usedMobileClamp = true
        } else if (mob?.kind === 'alias') {
          setPath(mobile, v.path, tokenRef(mob.path))
        }
      }
    }
  }

  // Colors live in their own plain module (colors.ts); variables.css.ts imports
  // it and lists `colors` first.
  const { colors, ...rest } = top
  const hasColors = !!colors && typeof colors === 'object' && !isRaw(colors)
  const root: Tree = hasColors ? { colors: raw('colors'), ...rest } : { ...rest }
  const responsive: Tree = {}
  if (Object.keys(base).length) responsive.base = base
  if (Object.keys(mobile).length) responsive['@largeMobileDown'] = mobile
  if (Object.keys(responsive).length) root.responsive = responsive

  const helperImports: string[] = []
  if (usedHDClamp) helperImports.push('HDClamp')
  if (usedMobileClamp) helperImports.push('MobileClamp')

  const lines: string[] = [`import { defineVariables } from '@salty-css/core/config';`]
  if (hasColors) lines.push(`import { colors } from './colors';`)
  if (helperImports.length) {
    lines.push(`import { ${helperImports.join(', ')} } from './helpers';`)
  }
  lines.push('')
  lines.push(
    `export default defineVariables(${serialize(root).replace(
      /^(  )fontFamily: \{$/m,
      '$1fontFamily: {\n$1$1// Font Family Layer 2 - use level 1 font family variable names from imports',
    )});`,
  )
  lines.push('')

  const colorsFile = hasColors
    ? [
        '// Plain module so both the Salty config and other code can import it',
        `export const colors = ${serialize(colors)};`,
        '',
      ].join('\n')
    : ''

  return { contents: lines.join('\n'), colors: colorsFile, warnings }
}
