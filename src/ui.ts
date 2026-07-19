import { zipSync, strToU8 } from 'fflate'
import type { ExportTarget, GeneratedFile, MainToUI } from './types'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const exportBtn = $<HTMLButtonElement>('export')
const downloadBtn = $<HTMLButtonElement>('download')
const closeBtn = $<HTMLButtonElement>('close')
const messages = $<HTMLDivElement>('messages')
const results = $<HTMLDivElement>('results')

let lastFiles: GeneratedFile[] = []

function selectedTargets(): ExportTarget[] {
  const targets: ExportTarget[] = []
  if ($<HTMLInputElement>('t-variables').checked) targets.push('variables')
  if ($<HTMLInputElement>('t-themes').checked) targets.push('themes')
  if ($<HTMLInputElement>('t-templates').checked) targets.push('templates')
  return targets
}

function post(msg: unknown): void {
  parent.postMessage({ pluginMessage: msg }, '*')
}

exportBtn.addEventListener('click', () => {
  const targets = selectedTargets()
  if (targets.length === 0) {
    renderMessages([], 'Pick at least one target to generate.')
    return
  }
  exportBtn.disabled = true
  exportBtn.textContent = 'Generating…'
  messages.innerHTML = ''
  post({ type: 'export', targets, outputStyle: 'styled' })
})

closeBtn.addEventListener('click', () => post({ type: 'close' }))

downloadBtn.addEventListener('click', () => {
  if (lastFiles.length === 0) return
  const entries: Record<string, Uint8Array> = {}
  for (const f of lastFiles) entries[f.name] = strToU8(f.contents)
  const zipped = zipSync(entries, { level: 6 })
  // Copy into a plain ArrayBuffer so the Blob is happy across the iframe boundary.
  const buf = new Uint8Array(zipped)
  const blob = new Blob([buf], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'salty-css-export.zip'
  a.click()
  URL.revokeObjectURL(url)
})

function renderMessages(warnings: string[], error?: string): void {
  messages.innerHTML = ''
  if (error) {
    const d = document.createElement('div')
    d.className = 'msg error'
    d.textContent = error
    messages.appendChild(d)
  }
  for (const w of warnings) {
    const d = document.createElement('div')
    d.className = 'msg warn'
    d.textContent = '⚠ ' + w
    messages.appendChild(d)
  }
}

function renderResults(files: GeneratedFile[]): void {
  results.innerHTML = ''
  for (const f of files) {
    const details = document.createElement('details')
    details.open = files.length === 1

    const summary = document.createElement('summary')
    summary.textContent = f.name

    const copy = document.createElement('button')
    copy.className = 'small copy'
    copy.textContent = 'Copy'
    copy.addEventListener('click', (e) => {
      e.preventDefault()
      navigator.clipboard.writeText(f.contents).then(() => {
        copy.textContent = 'Copied'
        setTimeout(() => (copy.textContent = 'Copy'), 1200)
      })
    })
    summary.appendChild(copy)

    const pre = document.createElement('pre')
    pre.textContent = f.contents

    details.appendChild(summary)
    details.appendChild(pre)
    results.appendChild(details)
  }
}

onmessage = (event: MessageEvent) => {
  const msg = event.data.pluginMessage as MainToUI | undefined
  if (!msg) return

  exportBtn.disabled = false
  exportBtn.textContent = 'Generate'

  if (msg.type === 'error') {
    renderMessages([], msg.message)
    return
  }
  if (msg.type === 'exported') {
    lastFiles = msg.files
    renderMessages(msg.warnings)
    renderResults(msg.files)
    downloadBtn.disabled = msg.files.length === 0
    if (msg.files.length === 0 && msg.warnings.length === 0) {
      renderMessages([], 'Nothing was generated for the selected targets.')
    }
  }
}
