// Serialize a plain JS value tree into pretty, TS-friendly source.
//
// Rules:
//   - Raw ({__raw}) values are emitted verbatim (unquoted) -> HDClamp(16), etc.
//   - strings are single-quoted (with escaping); Salty token refs are just strings.
//   - object keys that aren't valid identifiers are quoted.
//   - `undefined` entries are skipped so optional theme values drop out cleanly.

import { isRaw } from './format'

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function quoteKey(key: string): string {
  return IDENT.test(key) ? key : JSON.stringify(key)
}

function quoteString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function serialize(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent)
  const padIn = '  '.repeat(indent + 1)

  if (isRaw(value)) return value.__raw
  if (value === null) return 'null'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return quoteString(value)

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((v) => `${padIn}${serialize(v, indent + 1)}`)
    return `[\n${items.join(',\n')}\n${pad}]`
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    )
    if (entries.length === 0) return '{}'
    const lines = entries.map(([k, v]) => `${padIn}${quoteKey(k)}: ${serialize(v, indent + 1)}`)
    return `{\n${lines.join(',\n')}\n${pad}}`
  }

  return 'undefined'
}

/** Nested plain-object tree used to build up grouped output before serializing. */
export type Tree = { [key: string]: unknown }

/** Set a value at a dotted/segmented path, creating intermediate objects. */
export function setPath(root: Tree, path: string[], value: unknown): void {
  let node = root
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i]
    if (typeof node[seg] !== 'object' || node[seg] === null || isRaw(node[seg])) {
      node[seg] = {}
    }
    node = node[seg] as Tree
  }
  node[path[path.length - 1]] = value
}
