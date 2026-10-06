/// <reference types="@figma/plugin-typings" />
import type { GeneratedFile, MainToUI, UIToMain } from './types'
import { readDesignSystem } from './salty/read'
import { generateVariables } from './salty/variables'
import { generateThemes } from './salty/themes'
import { generateTemplates } from './salty/templates'
import { generateFonts } from './salty/fonts'
import { registerCodegen } from './salty/codegen'

// In Dev Mode the plugin runs headless as a codegen provider.
if (figma.editorType === 'dev') {
  registerCodegen()
} else {
  figma.showUI(__html__, { width: 420, height: 640, themeColors: true, title: 'Salty CSS Exporter' })

  figma.ui.onmessage = async (msg: UIToMain) => {
    if (msg.type === 'close') {
      figma.closePlugin()
      return
    }
    if (msg.type === 'resize') {
      figma.ui.resize(Math.max(320, Math.round(msg.width)), Math.max(360, Math.round(msg.height)))
      return
    }
    if (msg.type !== 'export') return

    try {
      const snapshot = await readDesignSystem()
      const files: GeneratedFile[] = []
      const warnings: string[] = []

      const add = (name: string, gen: { contents: string; warnings: string[] }) => {
        warnings.push(...gen.warnings)
        if (gen.contents.trim()) files.push({ name, contents: gen.contents })
      }

      if (msg.targets.includes('variables')) add('variables.css.ts', generateVariables(snapshot))
      if (msg.targets.includes('themes')) add('themes.css.ts', generateThemes(snapshot))
      if (msg.targets.includes('templates')) add('templates.css.ts', generateTemplates(snapshot))
      if (msg.targets.includes('fonts')) add('fonts.css', generateFonts(snapshot))

      post({ type: 'exported', files, warnings })
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }
}

function post(m: MainToUI): void {
  figma.ui.postMessage(m)
}
