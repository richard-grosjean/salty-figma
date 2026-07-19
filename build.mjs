// Build script for the Salty CSS Figma plugin.
//
// Produces the two files the manifest points at:
//   dist/code.js  - the main/sandbox thread (talks to the Figma document + codegen)
//   dist/ui.html  - the export UI iframe, with the UI bundle inlined as a <script>
//                   (Figma only loads a single HTML file for the UI).

import * as esbuild from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const watch = process.argv.includes('--watch')
mkdirSync('dist', { recursive: true })

const common = {
  bundle: true,
  target: 'es2018',
  format: 'iife',
  legalComments: 'none',
  logLevel: 'info',
}

const inlineUiPlugin = {
  name: 'inline-ui',
  setup(build) {
    build.onEnd((result) => {
      const uiJs = result.outputFiles?.[0]?.text ?? ''
      if (!uiJs.trim()) throw new Error('inline-ui: UI bundle was empty')
      const html = readFileSync('src/ui.html', 'utf8')
      const inject = `<script>\n${uiJs}\n</script>`
      writeFileSync('dist/ui.html', html.replace('</body>', `${inject}\n</body>`))
      console.log('wrote dist/ui.html')
    })
  },
}

// write:false keeps the UI bundle in memory so the plugin can inline it into the HTML.
const uiOptions = { ...common, entryPoints: ['src/ui.ts'], write: false, plugins: [inlineUiPlugin] }
const codeOptions = { ...common, entryPoints: ['src/code.ts'], outfile: 'dist/code.js' }

async function run() {
  if (watch) {
    const [uiCtx, codeCtx] = await Promise.all([
      esbuild.context(uiOptions),
      esbuild.context(codeOptions),
    ])
    await Promise.all([uiCtx.watch(), codeCtx.watch()])
    console.log('watching for changes…')
  } else {
    await Promise.all([esbuild.build(uiOptions), esbuild.build(codeOptions)])
    console.log('build complete')
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
