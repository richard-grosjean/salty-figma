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

const SEGMENT_ALIASES: Record<string, string> = {
  headline: 'heading',
  r: 'regular',
}

/** Canonicalise known synonym segments, e.g. "headline" -> "heading". Case-insensitive. */
export function renameSegment(seg: string): string {
  return SEGMENT_ALIASES[seg.toLowerCase()] ?? seg
}

const SIZE_WORD: Record<string, string> = {
  s: 'small',
  sm: 'small',
  m: 'medium',
  md: 'medium',
  l: 'large',
  lg: 'large',
}

/**
 * Expand a t-shirt size abbreviation into a readable key. An optional run of
 * `x`s is kept as an "extra" prefix and the base letter is spelled out:
 *   "xxxl" / "XXXL" -> "xxxLarge"    "l" -> "large"     "xl" -> "xLarge"
 *   "xs" -> "xSmall"                 "sm" -> "small"    "md" -> "medium"
 * Segments that aren't a size abbreviation (already-spelled "large", "heading",
 * "medium", …) are returned unchanged.
 */
export function expandSizeSegment(seg: string): string {
  const m = /^(x*)(sm|md|lg|s|m|l)$/i.exec(seg)
  if (!m) return seg
  const xs = m[1].toLowerCase()
  const word = SIZE_WORD[m[2].toLowerCase()]
  return xs ? xs + word[0].toUpperCase() + word.slice(1) : word
}

/**
 * Pull a numeric "shade" out of a camelCased color leaf segment. Matches an
 * optional letters prefix, 2–3 digits, and an optional trailing "Default" word:
 *   "offBlack900"        -> { prefix: "offBlack", num: "900" }
 *   "offBlack950Default" -> { prefix: "offBlack", num: "950" }   (Default -> base shade)
 *   "900"                -> { prefix: "",         num: "900" }
 * Single-digit names ("light1", "heading1") and shade-less names ("white") don't
 * match and return null so they're left untouched.
 */
export function extractShade(seg: string): { prefix: string; num: string } | null {
  const m = /^([A-Za-z]*?)(\d{2,3})(?:default)?$/i.exec(seg)
  return m ? { prefix: m[1], num: m[2] } : null
}

/** Group shade suffixes and collapse a leaf that restates its parent folder. */
function shadePath(segs: string[]): string[] {
  const last = segs.length - 1
  const shade = extractShade(segs[last])
  if (!shade) return segs

  const head = segs.slice(0, last)
  const parent = last > 0 ? segs[last - 1] : undefined
  // Leaf just restates its parent folder ("offBlack/offBlack900") -> drop the
  // redundant prefix so the shade sits directly under the folder.
  if (shade.prefix && parent && shade.prefix.toLowerCase() === parent.toLowerCase()) {
    return [...head, shade.num]
  }
  // Otherwise nest the shade under its own prefix key ("colors/offBlack900").
  if (shade.prefix) return [...head, shade.prefix, shade.num]
  return [...head, shade.num]
}

/** Ensure a color path lives under a top-level `colors` namespace (no double-prefix). */
function namespaceColors(path: string[]): string[] {
  const head = path[0]?.toLowerCase()
  return head === 'colors' || head === 'color' ? path : ['colors', ...path]
}

/**
 * Split a Figma variable name on its "/" group separators and camelCase each
 * segment: "Font Size/Body Large" -> ["fontSize", "bodyLarge"]. When `isColor`
 * is set, colors are grouped under a top-level `colors` namespace and the leaf's
 * trailing shade is folded into a shared key:
 *   "offBlack900"                 -> ["colors", "offBlack", "900"]
 *   "offBlack/offBlack900"        -> ["colors", "offBlack", "900"]  (leaf restates its folder)
 *   "offBlack/offBlack950Default" -> ["colors", "offBlack", "950"]
 *   "colors/offBlack900"          -> ["colors", "offBlack", "900"]  (already namespaced)
 *   "white"                       -> ["colors", "white"]
 * Centralising this keeps emitted object keys and alias/token refs (which
 * resolve through the same path) consistently structured across every output.
 */
export function splitName(name: string, isColor = false): string[] {
  const segs = name
    .split('/')
    .map((s) => camelCase(s))
    .filter(Boolean)
  if (!isColor || segs.length === 0) return segs
  return namespaceColors(shadePath(segs))
}

/** dotted path for a variable name, e.g. "colors/offBlack900" -> "colors.offBlack.900" (when isColor). */
export function dottedName(name: string, isColor = false): string {
  return splitName(name, isColor).join('.')
}
