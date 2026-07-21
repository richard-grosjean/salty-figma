# Figma Community listing — copy

Paste-ready copy for publishing **Salty CSS Exporter** to the Figma Community
(Plugins → Publish). Fill the text fields from the sections below; the image
assets are listed in the checklist at the bottom.

---

## Name (≤ 40 chars)

```
Salty CSS Exporter
```

## Tagline (one line)

```
Export your Figma variables, themes & text styles to Salty CSS.
```

## Description

```
Salty CSS Exporter bridges your Figma design system and Salty CSS
(https://salty-css.dev) — the build-time CSS-in-JS library for React, Next.js
and Server Components.

In the editor (Design mode) it bulk-exports your file's variables, themes and
text styles into ready-to-use Salty .css.ts source files. Preview each file,
copy it, or download the whole set as a zip.

In Dev Mode select any node to get a styled() or className snippet right in the
Inspect panel — colors resolved to {colors.…} refs, font families to
{fontFamily.…} refs, and numeric values wrapped in responsive clamps.

What you get:
• variables.css.ts — colors, fonts and responsive tokens via defineVariables()
• themes.css.ts — light/dark (and beyond) via a conditional theme + a typed Theme interface
• templates.css.ts — text styles via defineTemplates(), with desktop/mobile merged into fluid clamps
• fonts.css — one @font-face per family / weight / style in use

Names are tidied up automatically: color shades fold into nested keys
(offBlack900 → colors.offBlack.900), t-shirt sizes expand (xl → xLarge), and
font weights become numbers (medium → 500).

Runs entirely on your machine. The plugin only reads the current document and
generates text — no network access, nothing leaves your computer.
```

## Tags

```
salty css, css-in-js, design tokens, variables, themes, text styles,
code export, dev mode, design system, react, nextjs, typescript, styled, codegen
```

## Category

```
Development  (secondary: Design systems)
```

## Support contact

Pick one to enter in the publish form:

```
https://github.com/richard-grosjean/salty-figma/issues
```
```
richard@bou.co
```

## Release notes — v0.1.0

```
First release.
• Bulk export of variables, themes and text styles to Salty CSS .css.ts files
• Dev Mode codegen: styled() and className snippets with token refs and responsive clamps
```

---

## Asset checklist (produce separately — images, not text)

- [ ] **Icon** — 128 × 128 px PNG
- [ ] **Cover art** — 1920 × 960 px PNG
- [ ] **Carousel** (optional) — screenshots of the export UI and a Dev Mode snippet, 16:9

## Before you submit

- [ ] `npm run check` passes (typecheck + build), `dist/` is current
- [ ] Add an `"id"` to `manifest.json` — Figma assigns one in the publish flow
- [ ] Confirm the support contact above (GitHub issues vs. email)
- [ ] `LICENSE` present (MIT)
