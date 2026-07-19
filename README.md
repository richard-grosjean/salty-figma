# Salty CSS Exporter (Figma plugin)

A hybrid Figma plugin that bridges a Figma design system and [Salty CSS](https://salty-css.dev):

- **Editor UI (Design mode)** — bulk-exports the file's variables and text styles into Salty
  `.css.ts` source files you can preview, copy, or download as a zip.
- **Dev Mode codegen** — select any node to get a `styled()` / `className` snippet in the Inspect
  panel, with colors resolved to token refs and numeric values wrapped in `HDClamp(px)`.

Modelled on the conventions in `gigaton-website/apps/website/src/styles/`.

## What it exports

| Target | Output file | Salty API |
|--------|-------------|-----------|
| Variables | `variables.css.ts` | `defineVariables({ colors, fontFamily, … , responsive: { base, '@largeMobileDown' } })` |
| Themes | `themes.css.ts` | `defineVariables({ conditional: { theme } })` |
| Text styles | `templates.css.ts` | `defineTemplates({ textStyle })` |

### Mapping rules (v1)

- **Colors / strings / booleans** → top-level groups at the variable's `/`-path.
- **Numeric variables** in scaling groups → `responsive.base` as `HDClamp(desktop)`, and (when the
  collection has a mobile mode) `responsive['@largeMobileDown']` as `MobileClamp(mobile)`.
- **`fontWeights` / `zIndex`** numbers → emitted raw (never clamped).
- **The theme collection** (a collection named theme/semantic, or one with Light/Dark modes) → each
  mode becomes a theme; alias values become `{colors.x}` refs.
- Anything that doesn't resolve to a token falls back to `HDClamp(px)` (desktop) / `MobileClamp(px)`.

All heuristics live in [`src/salty/config.ts`](src/salty/config.ts) — tune the collection/mode name
hints and non-clamp groups there to match how your Figma variables are actually organised.

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
    variables.ts     -> variables.css.ts
    themes.ts        -> themes.css.ts
    templates.ts     -> templates.css.ts
    codegen.ts       node -> styled()/className snippet
    format.ts        rgba/clamp/token-ref formatting
    serialize.ts     value tree -> pretty TS source
```
