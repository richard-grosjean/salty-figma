// Shared types between the main thread (code.ts) and the UI (ui.ts).

export type OutputStyle = 'styled' | 'className'

/** A generated Salty CSS file, ready to preview / download. */
export interface GeneratedFile {
  /** Suggested filename, e.g. "variables.css.ts". */
  name: string
  contents: string
}

// ---------------------------------------------------------------------------
// Serializable snapshots of the Figma design system (read on the main thread,
// generated into source either there or forwarded to the UI).
// ---------------------------------------------------------------------------

export type ResolvedType = 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN'

/** A single Figma variable value, per mode, with aliases pre-resolved to a token path. */
export type ReadValue =
  | { kind: 'color'; hex: string; r: number; g: number; b: number; a: number }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  /** VARIABLE_ALIAS resolved to the dotted path of its target, e.g. "colors.green". */
  | { kind: 'alias'; path: string }

export interface ReadVariable {
  /** Raw Figma name, e.g. "colors/light1/100". */
  name: string
  /** Name split on "/", e.g. ["colors","light1","100"]. */
  path: string[]
  resolvedType: ResolvedType
  /** modeId -> value */
  valuesByMode: Record<string, ReadValue>
}

export interface ReadMode {
  modeId: string
  name: string
}

export interface ReadCollection {
  id: string
  name: string
  defaultModeId: string
  modes: ReadMode[]
  variables: ReadVariable[]
}

export interface ReadTextStyle {
  /** Raw Figma name, e.g. "heading/xLarge". */
  name: string
  path: string[]
  fontFamily: string
  fontStyle: string
  fontSize: number
  fontWeight: number | null
  /** css line-height string, always font-size-relative: "105%" or "normal" (AUTO). */
  lineHeight: string
  /** css letter-spacing string, always font-size-relative em, e.g. "-0.03em" or "0em". */
  letterSpacing: string
  textTransform: string
  textDecoration: string
}

export interface DesignSystemSnapshot {
  collections: ReadCollection[]
  textStyles: ReadTextStyle[]
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type UIToMain =
  | { type: 'export'; targets: ExportTarget[]; outputStyle: OutputStyle }
  | { type: 'close' }
  | { type: 'resize'; width: number; height: number }

export type ExportTarget = 'variables' | 'themes' | 'templates' | 'fonts'

export type MainToUI =
  | { type: 'exported'; files: GeneratedFile[]; warnings: string[] }
  | { type: 'error'; message: string }
