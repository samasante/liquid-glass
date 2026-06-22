# liquid-glass

**Real liquid glass for the web.** A headless React lens that refracts the live
DOM, so the text stays selectable, the links stay clickable, and the motion is
real. It renders in **Chrome, Safari, and Firefox**, with zero runtime
dependencies. React is the only peer.

![Liquid Glass — a lens refracting the live page](./docs/hero.jpg)

**[Live demo + docs → glass.samasante.com](https://glass.samasante.com)**

> Most "liquid glass" libraries use `backdrop-filter: url()`, which only works in
> Chromium, so they fall back to a flat blur in Safari and Firefox. The WebGL
> ones rasterize an `html2canvas` **screenshot**, so the text under the glass is
> frozen and stale. This one runs an SVG displacement filter on the element
> itself (`filter: url()`), so it refracts the **real, live DOM**, and it works
> across browsers.

```bash
npm i @samasante/liquid-glass
# react + react-dom are peer deps
```

```tsx
import { Glass } from "@samasante/liquid-glass";

<Glass style={{ background: "rgba(248,113,113,0.4)", borderRadius: 14, padding: "12px 22px" }}>
  Save
</Glass>;
```

Wrap any styled box and it becomes a glass **material**: it frosts and tints the
page behind it, rims it with a soft bright edge, and — in **Chrome / Edge** —
bends the live page through it. Your translucent colour is the tint; the
`children` render crisp. No provider, no CSS import, no config. Size and style it
with CSS (`className`, `style`, Tailwind); change any optic through `optics`.

**The one cross-browser catch (web-platform physics, not a choice).** Bending the
_live_ page uses `backdrop-filter: url()`, which ships in **Chrome / Edge only**.
In **Safari and Firefox** a wrapped `<Glass>` still frosts + tints + edge-lights —
it reads as glass — but it can't bend the live page; bending there needs a **copy**
of what's behind the glass.

**To bend in every browser, refract a copy** — the same `<Glass>`, you just tell it
what to bend. It works in **Chrome, Safari, _and_ Firefox**:

- **In-place** — give a `<Glass>` geometry (`size` + `center`) and it bends its own
  `children` (a hero, a card), no copy to manage:

  ```tsx
  <Glass size={160} center={{ x: mx, y: my }}>
    <Hero />
  </Glass>;
  ```

- **`refract={node}`** — float a lens over content it doesn't own (a panel over a photo,
  a loupe over the page). Hand it the node to copy; `behind` fills the bleed; `children`
  render crisp on top:

  ```tsx
  <Glass refract={<img src="/photo.jpg" />} behind="#222"
         width={420} height={84} radius={20}>
    <Notification />
  </Glass>;
  ```

- **`src` / `draw` + `lenses`** — a `<video>` / `<canvas>`, refracted on the GPU (live
  media an SVG filter can't reach). One renderer samples the medium and draws many
  lenses over it, so each control of a video player is its own lens.

One rule across every mode: **`children` are the crisp layer on top.** See the
copy-paste [`GlassNotification`](https://github.com/samasante/liquid-glass/blob/main/examples/GlassNotification.tsx)
(panel over a photo) and [`GlassVideoControls`](https://github.com/samasante/liquid-glass/blob/main/examples/GlassVideoControls.tsx)
(lenses over a `<video>`).

## Why

| | this | other SVG-filter libs | WebGL snapshot libs |
|---|---|---|---|
| Refracts **live** DOM (text selectable, links clickable) | yes | yes (Chrome only) | no, static screenshot |
| Works in **Safari + Firefox** | yes | no, flat blur | yes, but a snapshot |
| Headless / composable | yes | no, a styled widget | no |
| Bundle | **tiny, 0 deps** | small | large (three.js) |

![A glass lens sweeping across live "Liquid Glass" text and the wallpaper, bending them with chromatic dispersion at the rim](./docs/lens.gif)

## How it works

A rounded-rect **signed-distance field** is rasterized to a displacement map (red
and green encode X/Y displacement, blue a specular mask). That map feeds an SVG
`feDisplacementMap` on the content via `filter: url(#…)`, with a 3-pass RGB split
for chromatic aberration. Geometry is driven by lightweight motion values written
imperatively each frame, so a lens follows the pointer or animates at 60fps
without re-rendering React.

The hard part is Safari — the WebKit-specific fixes (1× filter, shape-only map
regeneration, cache-busting filter ids) are built in. See [`BROWSERS.md`](https://github.com/samasante/liquid-glass/blob/main/BROWSERS.md)
for details and the support matrix.

## API

### `<Glass>`

| Prop | Type | Default | Notes |
|---|---|---|---|
| `children` | `ReactNode` | none | The DOM the lens refracts (DOM mode). |
| `refract` | `ReactNode` | none | Refract THIS instead (e.g. a sibling image/video). The children render crisp on top. |
| `behind` | `string` | auto | Solid fill for the bleed edge of a `refract` copy. Omit it to auto-derive from the page's background; set it for a precise edge over a photo, or `"transparent"` to opt out. |
| `optics` | `Partial<GlassOptics>` | balanced default | The look. See the list below. |
| `width`, `height` | `number \| motion` | fit the element | Lens size in **full** px. Omit and the lens fits the wrapped element. |
| `size` | `number \| [w, h]` |  | Shorthand for `width` + `height` (a number is square). |
| `radius` | `number \| motion` | the element's radius | Corner radius in px. |
| `center` | `{ x, y }` | `{ 0.5, 0.5 }` | Lens centre as a fraction (0 to 1) of the element — for a positioned or moving lens (a slider thumb, a video control). |
| `src`, `draw` | `string`, `fn` |  | A video URL or a per-frame canvas painter (WebGL mode). |
| `filterResolution` | `number` | `1` | Chromium-only supersample (`2` is crisp). Forced to 1 in Safari. |
| `live` | `boolean` | `false` | Re-rasterize every frame for self-animating refracted content (Safari). |

`width`, `height`, `radius`, and `center.x` / `center.y` take a plain
number **or** a motion value (anything with `{ get(); on('change', cb) }`,
including a framer-motion `MotionValue`), so a control can animate them at 60fps.

#### Optics (`optics={{ … }}`)

One `GlassOptics` vocabulary (the look, with no geometry) drives **both** the DOM
`<Glass>` and the WebGL surface below.

- `strength`: refraction strength (the most a pixel moves, a 0 to 1 fraction of
  the box). `scaleX` and `scaleY` override it per axis.
- `depth`: how far the bend reaches in from the edge (0 to 1). It also gates
  `curvature`.
- `curvature`: the convex dome (0 to 1), the magnified "liquid" middle. `depth`
  gates it, so at a low depth the centre stays flat.
- `dispersion`: chromatic aberration, the colour split at the edges.
- `bend`: the rim refraction (0 to 1) — the "liquid" lip; extra inward refraction
  in a thin band at the edge so the background wraps at the contour. `0` is a plain
  magnifier.
- `bendWidth`: the width of that band, a 0 to 1 fraction of `min(W, H)`. Default
  `0.16`.
- `sheen`, `sheenWidth`, `sheenFalloff`, `sheenAngle`: the directional edge
  highlight (intensity, thickness, falloff, and the angle it pools toward).
  `specular` is the overall gain.
- `glow`, `glowSpread`, `glowFalloff`: the soft inner glow.
- `frost`: frosted blur. `brightness`: the veil. `splay`: corner splay.
- `sheenDark` and the `*Shadow` fields are **DOM `<Glass>` only**. On the WebGL
  surface, use CSS on the container instead.

### Defaults

One balanced default look ships out of the box, with no presets to pick from.
Override any optic through `optics`: `<Glass optics={{ dispersion: 0.8, frost: 4 }} />`.

### Motion utilities (opt-in, for building interactive controls)

`glassValue`, `animateGlassValue`, `deriveGlass`, `cubicBezier`, `glassEase`,
`useLensWobble` (velocity squash-stretch), `rubberBand`, and `GlassDiv` (a
transform-only div). None of them are required to use `<Glass>`.

### Video, canvas, and many lenses over one surface

Safari won't SVG-filter a live `<video>`, so for media `<Glass>` runs **one WebGL
renderer** that samples the medium and draws every lens from it. Pass `src` (a video)
or `draw` (a per-frame `<canvas>` painter), and a full-px `lenses={[{ x, y, w, h,
radius }]}` array (one `optics`, shared) for many lenses over one surface — each
control of a video player is its own lens bending the footage. The interactive
controls are the `children`, crisp on top.

```tsx
import { Glass, type GlassSurfaceLens } from "@samasante/liquid-glass";

const lenses: GlassSurfaceLens[] = [
  { x: 0.27, y: 0.5, w: 62, h: 62, radius: 31 }, // rewind
  { x: 0.5,  y: 0.5, w: 104, h: 104, radius: 52 }, // play / pause
  { x: 0.73, y: 0.5, w: 62, h: 62, radius: 31 }, // forward
];

<Glass
  src="/clip.mp4"
  optics={{ depth: 1, curvature: 0.42, dispersion: 0.28 }}
  lenses={lenses}
  videoRef={videoRef}
  paused={!playing}
>
  {/* crisp transport controls, positioned over the lenses */}
</Glass>;

// A generative canvas: pass `draw`; the lens refracts the painted frame.
<Glass draw={(ctx, t) => paint(ctx, t)} size={160} center={pt} />;
```

You drive playback yourself with `videoRef` + `paused` (plus `poster` / `loop` /
`muted` / `autoPlay` / `crossOrigin`) — a normal controlled component, no context.
`GlassSurfaceLens` types the `lenses` array. The full player is in the copy-paste
[`GlassVideoControls`](https://github.com/samasante/liquid-glass/blob/main/examples/GlassVideoControls.tsx)
example.

## Components (copy and own them)

Finished components live in [`examples/`](https://github.com/samasante/liquid-glass/tree/main/examples)
as code you own and restyle: a **video player** (`GlassVideoControls`), and
macOS-style **switch**, **slider**, **notification**, and **context menu** panels.

**The glass part is tiny — a few props.** The line count in the examples is the
*accessible, interactive shell* (a real `<input type="range">`, drag, keyboard,
ARIA), not the lens. Here's the glass-only essence of each:

```tsx
// Switch — the lens IS the thumb; it slides 0→1 and bends the track through it.
<Glass size={[90, 60]} radius={30} center={{ x: on ? 1 : 0 }}>
  <SwitchTrack />
</Glass>

// Slider — a gentler bend; the handle drives the lens, refracting the fill beneath.
<Glass size={[90, 60]} radius={30} center={{ x: value }} refract={<TrackFill value={value} />}>
  <SliderTrack />
</Glass>

// Notification / menu — a panel over a photo: it refracts a copy of the wallpaper;
// the crisp content + border sit on top (see the example for the full card).
<Glass width={420} height={84} radius={20} refract={<Wallpaper />} behind="#222" />
```

Copy any file from [`examples/`](https://github.com/samasante/liquid-glass/tree/main/examples):
the engine ships on **npm** (versioned, you get fixes) while the components are
**yours to own and restyle**.

## Browser support

Chrome and Edge, Safari (including iOS), and Firefox. See [`BROWSERS.md`](https://github.com/samasante/liquid-glass/blob/main/BROWSERS.md).

## Credit

An implementation of the SDF displacement-map glass technique that Apple popularized
as "Liquid Glass", following the approach Aave's team documented in
[Building glass for the web](https://aave.com/design/building-glass-for-the-web).
Thanks also to [liquid-dom](https://github.com/AndrewPrifer/liquid-dom) for another
take on glass in the browser. Not affiliated with or endorsed by Apple.

## License

[MIT](./LICENSE) © Sam Asante
