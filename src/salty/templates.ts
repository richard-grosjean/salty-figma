// Generates templates.css.ts from Figma text styles, as Salty defineTemplates
// under a `textStyle` template group. Font sizes are wrapped in HDClamp(px);
// line-height / letter-spacing keep their CSS unit strings.

import type { DesignSystemSnapshot, ReadTextStyle } from '../types'
import { hdClamp } from './format'
import { serialize, setPath, Tree } from './serialize'
import type { GenResult } from './variables'

function styleObject(s: ReadTextStyle): Tree {
  const obj: Tree = {
    fontFamily: s.fontFamily,
    fontSize: hdClamp(s.fontSize),
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
  }
  if (s.fontWeight !== null) obj.fontWeight = s.fontWeight
  if (s.textTransform !== 'none') obj.textTransform = s.textTransform
  if (s.textDecoration !== 'none') obj.textDecoration = s.textDecoration
  return obj
}

export function generateTemplates(snapshot: DesignSystemSnapshot): GenResult {
  const warnings: string[] = []

  if (snapshot.textStyles.length === 0) {
    warnings.push('No local text styles found — templates.css.ts skipped.')
    return { contents: '', warnings }
  }

  const textStyles: Tree = {}
  for (const s of snapshot.textStyles) {
    const path = s.path.length ? s.path : [s.name]
    setPath(textStyles, path, styleObject(s))
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
