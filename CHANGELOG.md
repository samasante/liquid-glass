# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/), and this project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-06-22

First public release.

### Added

- **`<Glass>` — a headless liquid-glass lens.** It refracts content with a real SVG
  displacement filter (`feDisplacementMap`): chromatic aberration (`dispersion`), a
  specular edge highlight, an inner-edge meniscus (`bend`), a convex dome
  (`curvature`), and a frosted edge (`frost`). It bends the **real, live DOM** — the
  text stays selectable and the links stay clickable — in **Chrome, Safari, and
  Firefox**. Zero runtime dependencies; React is the only peer.
  - A bare wrap is a glass **material**: it frosts, tints, and edge-lights the page
    behind it cross-browser. The _zero-copy_ live bend uses `backdrop-filter: url()`,
    which ships in **Chrome / Edge only**; Safari and Firefox get the frosted look.
  - Giving a wrap **geometry** (`size` + `center`) bends its own `children`
    **in-place** — a real refraction in **Chrome, Safari, _and_ Firefox**, no copy to
    manage.
  - **`refract={node}`** floats a lens over content it doesn't own (a panel over a
    photo, a loupe over the page) by refracting a copy you hand it; cross-browser.
    `behind` fills the thin bleed the lens samples past a panel-sized copy.
  - **`src`** (a `<video>`) / **`draw`** (a `<canvas>`) refract live media on the GPU
    (WebGL), for the surfaces an SVG filter can't reach (notably Safari video); a
    full-px **`lenses`** array puts many lenses over one surface from one renderer —
    e.g. each control of a video player is its own lens. Each lens can differ in
    SHAPE and look (per-lens `optics` + its own displacement map), so a round button
    and a wide-thin scrub track refract correctly side by side.
  - Geometry is full-px and optional (`width` / `height` / `size` / `radius` /
    `center`), each a plain number **or** a motion value, so a lens can follow a
    pointer or animate at 60fps without re-rendering React. The look lives in one
    `optics` prop.
- **One balanced default look** out of the box (no presets). Override any optic
  through the `optics` prop.
- **Built-in motion utilities** for interactive glass controls, so you don't need
  framer-motion: `glassValue`, `animateGlassValue`, `deriveGlass`, `cubicBezier`,
  `glassEase`, plus `useLensWobble`, `rubberBand`, and `GlassDiv`.
- **Copy-paste components** in [`examples/`](examples): a video player
  (`GlassVideoControls`) and macOS-style switch, slider, notification, and
  context-menu panels — a few dozen lines each on the public API.

### Cross-browser

- WebKit-safe by construction: a 1× filter supersample in Safari (a 2× one blows
  past Safari's filter source-graphic ceiling and silently drops the specular and
  dispersion passes); shape-only, debounced displacement-map regeneration (never
  mid-drag, or Safari throttles the passes); a per-update filter-`id` bump to defeat
  WebKit's filter-output cache; a specular mask sampled from the raw map in Safari;
  page-zoom–stable lens geometry; and a displacement cap that keeps a large lens
  inside Safari's filter-region limit. See [`BROWSERS.md`](BROWSERS.md).

[0.1.0]: https://github.com/samasante/liquid-glass/releases/tag/v0.1.0
