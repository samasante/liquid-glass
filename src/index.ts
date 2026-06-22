/**
 * @samasante/liquid-glass — a headless React liquid-glass lens, Apple-style
 * "Liquid Glass" for the web. Zero runtime dependencies; React is a peer.
 *
 * ONE primitive, `<Glass>`, in a few modes:
 *   • a bare wrap is a glass MATERIAL — frosts + tints + edge-lights in every
 *     browser, and bends the live page behind it in Chrome / Edge (the live bend
 *     is `backdrop-filter: url()`, Blink-only).
 *   • give it geometry + content to bend that content IN-PLACE
 *     (`<Glass center size>{x}</Glass>`) — a real refraction in EVERY browser.
 *   • `refract={node}` bends a COPY of any node (float a lens over content you
 *     don't own — the panel / loupe pattern), cross-browser.
 *   • `src` (a video) / `draw` (a canvas painter) + `lenses` runs ONE WebGL
 *     renderer that samples the medium and draws every lens — the media Safari
 *     won't SVG-filter, and the way to put many lenses over one surface.
 *
 * ```tsx
 * import { Glass } from "@samasante/liquid-glass";
 *
 * <Glass className="rounded-xl px-4 py-2">Save</Glass>;       // glass material
 * <Glass refract={<Wallpaper />} behind="#222"><Card /></Glass>; // panel over a bg
 * <Glass src="/clip.mp4" lenses={controls}>{transport}</Glass>;  // video player
 * ```
 */

// The mental model: a <Glass> lens refracts a COPY of what's behind it, because
// cross-browser an SVG filter can only touch the element's own pixels. So every
// API answers one question — where does that copy come from?
//   • the element's own content → a bare wrap (frost cross-browser; live-page bend
//       is Chrome/Edge-only) or, with geometry, an in-place bend (cross-browser)
//   • a node you pass            → <Glass refract={…}>
//   • a video / canvas           → <Glass src={…} /> or <Glass draw={…} /> (WebGL)
// `optics` is the one look bag; width/height/size/radius/center are geometry.

// ── The lens primitive ──────────────────────────────────────────────────────
export { Glass } from "./Glass";
export type { GlassProps } from "./Glass";

// ── The look: one optics bag for every lens. ────────────────────────────────
export type { GlassOptics } from "./displacement";

// ── Motion values: drive lens geometry without a framer-motion dependency. ──
export {
  glassValue,
  deriveGlass,
  animateGlassValue,
  glassEase,
  cubicBezier,
} from "./signal";
export type { GlassValue } from "./signal";

// ─────────────────────────────────────────────────────────────────────────────
//  Advanced — escape hatches + control-recipe helpers. Most apps never reach
//  for these; they exist to reproduce the interactive examples (switch / slider).
// ─────────────────────────────────────────────────────────────────────────────

/** @advanced Descriptor for multiple lenses over one `<Glass src/draw>` surface. */
export type { GlassSurfaceLens } from "./GlassSurface";

/** @advanced Structural contracts behind the motion utilities above. */
export type { GlassMotionValue, GlassAnimation } from "./signal";

/** @advanced Recipe helpers for hand-built interactive controls (see the switch
 *  + slider examples): a no-rerender motion div, a drag-overshoot easer, and a
 *  velocity squash-stretch spring. */
export { useLensWobble, rubberBand, GlassDiv } from "./interaction";
