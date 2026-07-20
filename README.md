# Salty CSS Exporter (Figma plugin)

A hybrid Figma plugin that bridges a Figma design system and [Salty CSS](https://salty-css.dev):

- **Editor UI (Design mode)** — bulk-exports the file's variables and text styles into Salty
  `.css.ts` source files you can preview, copy, or download as a zip.
- **Dev Mode codegen** — select any node to get a `styled()` / `className` snippet in the Inspect
  panel, with colors resolved to `{colors.…}` refs, font families to `{fontFamily.…}` refs, and
  numeric values wrapped in `HDClamp(px)`.

Modelled on the conventions in `gigaton-website/apps/website/src/styles/`.

## What it exports

| Target | Output file | Salty API |
|--------|-------------|-----------|
| Variables | `variables.css.ts` | `defineVariables({ colors, fontFamily, … , responsive: { base, '@largeMobileDown' } })` |
| Themes | `themes.css.ts` | `defineVariables({ conditional: { theme } })` + a generated `Theme` interface |
| Text styles | `templates.css.ts` | `defineTemplates({ textStyle })` |
| Fonts | `fonts.css` | plain CSS `@font-face` rules |

### Mapping rules (v1)

- **Colors** → grouped under a top-level `colors` namespace (see conversions below).
- **Strings / booleans** → top-level groups at the variable's `/`-path.
- **Numeric variables** in scaling groups → `responsive.base` as `HDClamp(desktop)`, and (when the
  collection has a mobile mode) `responsive['@largeMobileDown']` as `MobileClamp(mobile)`.
- **`fontWeights` / `zIndex`** numbers → emitted raw (never clamped).
- **The theme collection** (a collection named theme/semantic, or one with Light/Dark modes) → each
  mode becomes a theme with a `title` + flat `values`; alias values become `{colors.x}` refs. The
  generated `Theme` interface types each value `string`, marking a key optional when only some modes
  set it (`themes` is emitted `as const satisfies Record<string, Theme>`).
- Anything that doesn't resolve to a token falls back to `HDClamp(px)` (desktop) / `MobileClamp(px)`.

All heuristics live in [`src/salty/config.ts`](src/salty/config.ts) — tune the collection/mode name
hints and non-clamp groups there to match how your Figma variables are actually organised.

### Automated name conversions

To keep the emitted tokens idiomatic, some Figma names are rewritten. The conversion helpers live in
[`src/salty/format.ts`](src/salty/format.ts) (`splitName`, `expandSizeSegment`, `renameSegment`).

**Colors** — namespaced under `colors` and scale shades folded into nested keys:

| Figma variable | Token path |
|----------------|------------|
| `offBlack900`, `colors/offBlack900` | `colors.offBlack.900` |
| `offBlack/offBlack900` (leaf restates its folder) | `colors.offBlack.900` |
| `offBlack/offBlack950Default` (`…Default` = base shade) | `colors.offBlack.950` |
| `white` | `colors.white` |

A trailing 2–3 digit shade (50–950) is split off; single digits (`light1`) and pure numbers are left
alone. Already-`colors`-prefixed names aren't double-namespaced.

**Font families** — the distinct families used by text styles become `fontFamily.main`,
`fontFamily.secondary`, … (ordered by usage frequency). `templates.css.ts` and the Dev Mode snippet
reference `{fontFamily.main}`, `variables.css.ts` defines the tokens, and `fonts.css` emits one
`@font-face` per distinct `(family, weight, italic)` used, as `/fonts/<Family>-<Style>.woff2`.

**Text styles** — segment names are canonicalised:

| Figma segment | Key |
|---------------|-----|
| `xxxl` / `XXXL` | `xxxLarge` |
| `xl`, `xxl`, `xs` | `xLarge`, `xxLarge`, `xSmall` |
| `l`, `s`, `m` (and `lg` / `sm` / `md`) | `large`, `small`, `medium` |
| `headline` | `heading` |
| `r` | `regular` |

Desktop/mobile variants of the same style are merged into one entry, with the size expressed as
`HDClamp(desktopPx, mobilePx)` — e.g. `Headline/XXXL/desktop` + `Headline/XXXL/mobile` →
`heading.xxxLarge` with `fontSize: HDClamp(80, 40)`. Line-height / letter-spacing are relative
(`%` / `em`) and viewport-independent, so the desktop values carry over.

## Develop

```bash
npm install
npm run watch      # rebuild dist/ on change
npm run typecheck
```

Then in Figma: **Plugins → Development → Import plugin from manifest…** and pick `manifest.json`.
Run it in the editor for bulk export, or open **Dev Mode** and select a node for codegen.

Before publishing, add an `"id"` to `manifest.json` (Figma assigns one in the publish flow).

## Layout

```
src/
  code.ts            main thread: Dev Mode codegen vs. editor export UI
  ui.html / ui.ts    export UI (preview, copy, zip download via fflate)
  types.ts           shared message + snapshot types
  salty/
    read.ts          reads Figma variables + text styles -> plain snapshot
    config.ts        mapping heuristics (collection/mode classification)
    variables.ts     -> variables.css.ts (colors, fontFamily tokens, responsive)
    themes.ts        -> themes.css.ts (+ Theme interface)
    templates.ts     -> templates.css.ts (desktop/mobile merge)
    fonts.ts         -> fonts.css (@font-face) + fontFamily token derivation
    codegen.ts       node -> styled()/className snippet
    format.ts        rgba/clamp/token-ref formatting + name conversions
    serialize.ts     value tree -> pretty TS source
```
