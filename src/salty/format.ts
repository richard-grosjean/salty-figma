// Low-level value formatting helpers shared by every generator.

/** A raw TS expression that must be emitted WITHOUT quotes (e.g. `HDClamp(16)`). */
export interface Raw {
  __raw: string
}

export function raw(code: string): Raw {
  return { __raw: code }
}

export function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && '__raw' in (v as Record<string, unknown>)
}

/** Round to at most `p` decimals and drop trailing zeros. */
export function num(n: number, p = 3): number {
  const f = Math.pow(10, p)
  return Math.round(n * f) / f
}

function channel(c: number): number {
  return Math.round(c * 255)
}

/** Figma RGBA (0..1 channels) -> "#RRGGBB" when opaque, else "rgba(r, g, b, a)". */
export function rgbaToCss(r: number, g: number, b: number, a: number): string {
  if (a >= 1) {
    const hex = [r, g, b].map((c) => channel(c).toString(16).padStart(2, '0')).join('')
    return `#${hex.toUpperCase()}`
  }
  return `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${num(a, 2)})`
}

/** `HDClamp(px)` desktop clamp expression (optionally with an explicit min). Pixel values are rounded to the nearest integer. */
export function hdClamp(px: number, min?: number): Raw {
  return raw(
    min === undefined ? `HDClamp(${Math.round(px)})` : `HDClamp(${Math.round(px)}, ${Math.round(min)})`,
  )
}

/** `MobileClamp(px)` mobile-override clamp expression. Pixel values are rounded to the nearest integer. */
export function mobileClamp(px: number, min?: number): Raw {
  return raw(
    min === undefined
      ? `MobileClamp(${Math.round(px)})`
      : `MobileClamp(${Math.round(px)}, ${Math.round(min)})`,
  )
}

/** A Salty token reference string, e.g. `{colors.green}`. Emitted as a normal quoted string. */
export function tokenRef(path: string): string {
  return `{${path}}`
}

/**
 * camelCase a raw Figma name segment so spaces (and other separators) are removed:
 * "Body Large" -> "bodyLarge", "Heading 1" -> "heading1", "colors" -> "colors".
 * Splits on any run of non-alphanumeric characters, lower-cases the first word's
 * leading char, and upper-cases each subsequent word's leading char. ALL-CAPS
 * words are lower-cased first ("COLORS" -> "colors"), but mixed-case words keep
 * their internal capitals so already-correct names are preserved unchanged
 * ("zIndex" -> "zIndex", "fontFamily" -> "fontFamily"). Falls back to the
 * trimmed original when the segment has no alphanumeric content.
 */
export function camelCase(segment: string): string {
  const words = segment.match(/[A-Za-z0-9]+/g)
  if (!words) return segment.trim()
  const norm = words.map((w) => (/^[A-Z0-9]+$/.test(w) ? w.toLowerCase() : w))
  const [first, ...rest] = norm
  const lead = first.charAt(0).toLowerCase() + first.slice(1)
  return lead + rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
}

/** Turn a Figma name segment into a safe, camelCased object key ("light1" ok, "100" -> quoted by serializer). */
export function keyFromSegment(seg: string): string {
  return camelCase(seg)
}
