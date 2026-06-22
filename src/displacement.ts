/**
 * Displacement-field generation for the liquid-glass lens.
 *
 * Independent implementation of the SDF displacement-map refraction technique
 * (technique credit in the README). Each pixel of a rounded-rect lens is encoded
 * as:
 *   R — X displacement (0.5 = neutral)
 *   G — Y displacement (0.5 = neutral)
 *   B — specular/glow mask (128 = none, 255 = full)
 * SVG `feDisplacementMap` then refracts the source through it, with an RGB
 * split for chromatic aberration and the B channel lifted into a specular
 * highlight.
 */

export interface GlassLensParams {
  /** Lens half-width in px (map aspect + on-screen size unless overridden). */
  lensW: number;
  /** Lens half-height in px. */
  lensH: number;
  borderRadius: number;
  /** Displacement map resolution (square). */
  mapSize: number;
  /** How far the refraction reaches inward from the edge, as a 0..1 fraction of
   *  the lens (auto-scales with size). Low = a thin rim band with a neutral
   *  centre; near 1 = the refraction fills the whole shape. Also GATES
   *  {@link GlassLensParams.curvature}: the body dome only acts where the
   *  refraction reaches, so a thin `depth` keeps the centre flat no matter how
   *  high `curvature` is — raise `depth` toward 1 to un-gate the dome. */
  depth: number;
  /** 0..1 — strength of the RGB split. */
  dispersion: number;
  /** Refraction strength — the max displacement as a fraction of the filtered
   *  element's box, applied to BOTH axes. */
  strength: number;
  /** Optional per-axis override of `strength` (advanced — for anisotropic lenses
   *  like a wide slider track). When set, wins over `strength` on that axis. */
  scaleX?: number;
  scaleY?: number;
  /** Zero displacement outside the rounded-rect SDF. */
  clipToShape: boolean;
  /** erf falloff towards the lens edge. */
  softEdge: boolean;
  /** Frosted blur of the source before refraction, px. */
  frost: number;
  /** Material mode only: CSS `backdrop-filter: saturate()` over the refracted
   *  backdrop (>1 = more vivid, <1 = the milky/desaturated Apple veil). Ignored
   *  by the copy-based SVG engine. @default 1 */
  saturate?: number;
  /** White (>0) or black (<0) veil over the lens. */
  brightness: number;
  /** Overall specular-highlight gain (scales both the sheen and the glow). */
  specular: number;
  /** Light angle in degrees that the sheen + glow pool toward (0 = left). */
  sheenAngle: number;
  /** Invert the specular into a dark edge instead of a bright one. DOM `<Glass>`
   *  ONLY — the WebGL path always lifts the specular bright. */
  sheenDark: boolean;
  /** Soft inner-glow intensity (0 = none). */
  glow: number;
  /** Inner-glow reach inward, as a fraction of min(W, H). */
  glowSpread: number;
  /** Inner-glow falloff exponent. */
  glowFalloff: number;
  /** Directional edge-sheen intensity (0 = none); pools toward `sheenAngle`. */
  sheen: number;
  /** Edge-sheen band thickness in px. */
  sheenWidth: number;
  /** Edge-sheen falloff exponent. */
  sheenFalloff: number;
  /** Convex curvature as a 0..1 fraction of the lens: `domeDepth = curvature ×
   *  min(W,H)`. 0 = flat window, 1 = full hemisphere dome (strong centre
   *  magnification — the "liquid" middle). Auto-scales with lens size. GATED by
   *  {@link GlassLensParams.depth}: the dome only reads where the refraction
   *  reaches inward, so at low `depth` the centre stays neutral however high
   *  `curvature` is. (A thin-rim control like the slider pairs low `depth` with
   *  high `curvature` to bend just the rim; a magnifier pairs high `depth`.) */
  curvature: number;
  /** Corner splay — 0 = none; higher splays the displacement outward toward the
   *  corners. */
  splay: number;
  /** Inner-edge refraction — the "liquid" lip / rim meniscus. An extra inward
   *  light-bend concentrated in a thin band hugging the rim, layered ON the body
   *  dome (same field, not a separate ring), so the background wraps and
   *  compresses at the contour like the curved lip of a liquid bead. 0 = off (a
   *  plain magnifier). Pair with a GENTLER `curvature` so the body stays subtly
   *  magnified and the rim is what reads as glass thickness. */
  bend: number;
  /** Width of the edge-refraction band as a 0..1 fraction of min(W,H). Smaller =
   *  a crisper, thinner meniscus. @default 0.16 */
  bendWidth: number;
  /** Optional drop shadow following the lens (drag state). */
  edgeShadow?: string;
  edgeInsetShadow?: string;
  /** Optional drop shadow following the lens (rest state). */
  restEdgeShadow?: string;
  restEdgeInsetShadow?: string;
}

/**
 * The OPTICAL look only — every {@link GlassLensParams} field except the geometry
 * (`lensW`/`lensH`/`borderRadius`, which are now top-level `<Glass>` props). This
 * is what the `optics` prop accepts, so geometry can never hide inside the look.
 */
export type GlassOptics = Omit<
  GlassLensParams,
  "lensW" | "lensH" | "borderRadius"
>;

/**
 * The out-of-the-box look — a balanced liquid-glass lens, so `<Glass>` looks
 * good with zero config; override any field via the `lens` prop. (No presets;
 * one good default kept unopinionated.)
 */
export const DEFAULT_LENS_PARAMS: GlassLensParams = {
  lensW: 95,
  lensH: 95,
  borderRadius: 95,
  mapSize: 512,
  clipToShape: true,
  softEdge: true,
  strength: 0.06,
  depth: 0.65,
  curvature: 0.6,
  splay: 0,
  dispersion: 0.5,
  bend: 0,
  bendWidth: 0.16,
  frost: 0.5,
  brightness: 0.1,
  specular: 1,
  sheenAngle: 45,
  sheenDark: false,
  sheen: 0.3,
  sheenWidth: 3,
  sheenFalloff: 1.5,
  glow: 0.12,
  glowSpread: 1,
  glowFalloff: 0.5,
};

export const BLANK_MAP =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** Dispersion spread: the red pass is displaced `DISPERSION_SPREAD` more than
 *  blue, green half that — a single tunable instead of two inline ratios. (The
 *  WebGL shader hard-codes the matching 0.22 / 0.11 split.) */
export const DISPERSION_SPREAD = 0.22;

// erf(x) ≈ tanh(√π · x): a cheap, smooth, monotone approximation good enough for
// the edge feather (the constant is √π rather than a baked-in decimal).
const ERF_K = Math.sqrt(Math.PI);
export const erf = (x: number) => Math.tanh(ERF_K * x);

/**
 * Mean of the dome gradient x/√(R²−x²) over [0, halfExtent]. The integral has a
 * closed form — ∫₀ᴴ x/√(R²−x²) dx = R − √(R²−H²) — so the mean is just that over
 * H, no numerical quadrature. Used to normalize the spherical-cap profile so the
 * average displacement lands at 0.5.
 */
const domeGradientMean = (radius: number, halfExtent: number): number =>
  halfExtent > 0
    ? (radius - Math.sqrt(radius * radius - halfExtent * halfExtent)) /
      halfExtent
    : 0;

export interface DomeConstants {
  Rx: number;
  Ry: number;
  scaleX: number;
  scaleY: number;
}

export const computeDomeConstants = (
  capDepth: number,
  halfW: number,
  halfH: number,
): DomeConstants => {
  // Spherical-cap radius from chord half-width `a` and cap height `h`:
  // R = (a² + h²) / 2h. Clamp the cap height inside the lens.
  const cap = Math.max(0.01, Math.min(capDepth, Math.min(halfW, halfH) - 1));
  const Rx = (halfW * halfW + cap * cap) / (2 * cap);
  const Ry = (halfH * halfH + cap * cap) / (2 * cap);
  const meanX = domeGradientMean(Rx, halfW);
  const meanY = domeGradientMean(Ry, halfH);
  return {
    Rx,
    Ry,
    scaleX: meanX > 0 ? 0.5 / meanX : 1,
    scaleY: meanY > 0 ? 0.5 / meanY : 1,
  };
};

export const domeGradient = (
  distance: number,
  radius: number,
  scale: number,
) => {
  // Hold the sample just inside the radius so the √ stays real at the rim.
  const inside = Math.min(distance, radius * (1 - 1e-3));
  return (inside / Math.sqrt(radius * radius - inside * inside)) * scale;
};

/** `feColorMatrix` values that scale the map's X/Y axes around 0.5. */
export const matrixForAxisScale = (x: number, y: number) =>
  `${x} 0 0 0 ${0.5 * (1 - x)}  0 ${y} 0 0 ${0.5 * (1 - y)}  0 0 1 0 0  0 0 0 1 0`;

const maskCache = new Map<string, string>();

/** Rounded-rect SVG data URI used as a CSS mask for the lens-shaped layers.
 *  The rect is inset half a device pixel so its stroke-free edge lands on the
 *  pixel grid; the corner radius drops the same half pixel to stay concentric. */
export const roundedRectMaskUri = (w: number, h: number, radius: number) => {
  const boxW = Math.max(1, Math.round(w));
  const boxH = Math.max(1, Math.round(h));
  const rad = Math.max(
    0,
    Math.min(Math.round(radius), Math.min(boxW, boxH) / 2),
  );
  const key = `rr·${boxW}·${boxH}·${rad}`;
  const cached = maskCache.get(key);
  if (cached) return { uri: cached, key };
  const inset = 0.5;
  const fillW = Math.max(0, boxW - 2 * inset);
  const fillH = Math.max(0, boxH - 2 * inset);
  const corner = Math.max(0, rad - inset);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none' viewBox='0 0 ${boxW} ${boxH}'>` +
    `<rect fill='black' rx='${corner}' ry='${corner}' x='${inset}' y='${inset}' width='${fillW}' height='${fillH}'/></svg>`;
  const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  maskCache.set(key, uri);
  return { uri, key };
};

/**
 * Lens-shaped SVG mask data URI (opaque fill on transparent) used to clip a
 * blurred layer to the lens shape — a rounded rect. The alpha is the shape; the
 * fill colour is irrelevant (consumers composite by alpha).
 */
export const lensShapeMaskUri = (
  w: number,
  h: number,
  radius: number,
): { uri: string; key: string } => {
  const iw = Math.max(1, Math.round(w));
  const ih = Math.max(1, Math.round(h));
  const r = Math.max(
    0,
    Math.min(Math.round(radius), Math.floor(Math.min(iw, ih) / 2)),
  );
  return roundedRectMaskUri(iw, ih, r);
};

export interface LensMapShape {
  lensHalfWidth: number;
  lensHalfHeight: number;
  borderRadius: number;
  depth: number;
  clipToShape: boolean;
  softEdge: boolean;
  sheenAngle?: number;
  glow?: number;
  glowSpread?: number;
  glowFalloff?: number;
  sheen?: number;
  sheenWidth?: number;
  sheenFalloff?: number;
  curvature?: number;
  splay?: number;
  bend?: number;
  bendWidth?: number;
}

export interface LensMapGenerator {
  generate(shape: LensMapShape): string;
  dispose(): void;
}

// 8-bit signed-around-0.5 channel encode (displacement) and the specular lift
// (0 → 128, 1 → 255). `| 0` truncates after the +0.5 round bias.
const encodeAxis = (signed: number) => ((0.5 + signed) * 255 + 0.5) | 0;
const encodeSpec = (spec: number) => (127 * spec + 128 + 0.5) | 0;

/**
 * Synchronous, quadrant-mirrored map generator (the fast path for animated
 * lenses). Reuses one canvas/ImageData and a per-column dome LUT so it can run
 * every animation frame; returns a PNG data URL. Only the top-left quadrant is
 * computed; the other three are written by reflecting the displacement signs.
 */
export const createLensMapGenerator = (size: number): LensMapGenerator => {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let image: ImageData | null = null;
  let domeLut: Float32Array | null = null;
  let lutDome = -Infinity;
  let lutHalfW = -Infinity;
  let lutHalfH = -Infinity;
  let lutLen = 0;
  let lutDirty = true;
  let dome: DomeConstants | null = null;

  return {
    generate(shape) {
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        ctx = canvas.getContext("2d");
        image = ctx!.createImageData(size, size);
      }
      const {
        lensHalfWidth: halfW,
        lensHalfHeight: halfH,
        borderRadius,
        depth,
        clipToShape,
        softEdge,
        sheenAngle = 45,
        glow = 0,
        glowSpread = 1,
        glowFalloff = 1.5,
        sheen = 0,
        sheenWidth = 3,
        sheenFalloff = 1.5,
        curvature = 0,
        splay = 0,
        bend = 0,
        bendWidth = 0.16,
      } = shape;
      const data = image!.data;
      const half = size >> 1;
      const radius = Math.min(borderRadius, Math.min(halfW, halfH));
      // `depth` is a 0..1 fraction of the lens — how far the refraction reaches
      // inward from the edge. As a fraction it auto-scales with size and, near 1,
      // fills the whole shape instead of leaving a neutral centre.
      const minHalf = Math.min(halfW, halfH);
      const depthPx = Math.min(depth * minHalf, minHalf - 1);
      const innerHalfW = Math.max(0, halfW - depthPx);
      const innerHalfH = Math.max(0, halfH - depthPx);
      const innerRadius = Math.max(
        0,
        Math.min(borderRadius, Math.min(innerHalfW, innerHalfH)),
      );
      // erf width: the feather spans ~`depthPx`; 1/√2 absorbs the erf scale.
      const falloff = depthPx > 0 ? Math.SQRT1_2 / depthPx : 1e6;
      const hasSpecular = glow > 0 || sheen > 0;
      const angle = (sheenAngle * Math.PI) / 180;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const edgeInv = sheenWidth > 0 ? 1 / sheenWidth : 0;
      // How far the glow reaches inward from the edge (a fraction of the lens set
      // by glowSpread) — a soft, ALL-AROUND inner glow, not a directional band.
      const glowReachInv = 1 / Math.max(2, glowSpread * Math.min(halfW, halfH));
      const stepX = (2 * halfW) / size;
      const stepY = (2 * halfH) / size;
      const invW = 1 / halfW;
      const invH = 1 / halfH;
      const hasDome = curvature > 0;
      // `curvature` is a 0..1 fraction of the lens; the spherical-cap height is
      // that fraction of the half-extent (so the dome auto-scales with size).
      const domeCap = curvature * Math.min(halfW, halfH);
      const hasSplay = splay > 0;
      // Inner-edge meniscus: amplify the inward bend in a thin band hugging the
      // outer rim. `erInv` maps the SDF (px) to a 0..1 ramp across the band.
      const hasEdgeRefract = bend > 0;
      const erInv = 1 / Math.max(2, bendWidth * Math.min(halfW, halfH));

      // Distance from a point to the rounded corner arc — shared by the outer
      // SDF and (with the inset extents) the soft-edge feather.
      const cornerDistance = (ox: number, oy: number) =>
        ox > 0 || oy > 0 ? Math.sqrt(ox * ox + oy * oy) : 0;

      if (hasDome) {
        if (
          !dome ||
          Math.abs(domeCap - lutDome) > 0.5 ||
          Math.abs(halfW - lutHalfW) > 1 ||
          Math.abs(halfH - lutHalfH) > 1
        ) {
          dome = computeDomeConstants(domeCap, halfW, halfH);
          lutDome = domeCap;
          lutHalfW = halfW;
          lutHalfH = halfH;
          lutDirty = true;
        }
        if (lutLen !== half) {
          domeLut = new Float32Array(half);
          lutLen = half;
          lutDirty = true;
        }
        if (lutDirty) {
          const lut = domeLut!;
          const d = dome!;
          const r2 = d.Rx * d.Rx;
          const rMax = d.Rx * (1 - 1e-3);
          for (let col = 0; col < half; col += 1) {
            const px = -((col + 0.5) * stepX - halfW);
            const clamped = px < rMax ? px : rMax;
            lut[col] = (clamped / Math.sqrt(r2 - clamped * clamped)) * d.scaleX;
          }
          lutDirty = false;
        }
      }
      const lut = hasDome ? domeLut : null;
      const splayHalf = 0.5 * Math.min(halfW, halfH);
      const splayInv = splayHalf > 0 ? 1 / splayHalf : 0;
      const sheenNorm = Math.SQRT1_2; // 1/√2: normalizes the diagonal projection

      for (let row = 0; row < half; row += 1) {
        const mirrorRow = size - 1 - row;
        const py = -((row + 0.5) * stepY - halfH);
        const edgeY = py - halfH + radius;
        const innerEdgeY = softEdge ? py - innerHalfH + innerRadius : 0;
        const dirYBase =
          hasDome && lut
            ? domeGradient(py, dome!.Ry, dome!.scaleY)
            : py * invH > 1
              ? 1
              : py * invH;
        const normY = py * invH > 1 ? 1 : py * invH;
        const splayY = hasSplay ? Math.max(0, 1 - (halfH - py) * splayInv) : 0;
        const rowBase = row * size;
        const mirrorRowBase = mirrorRow * size;
        for (let col = 0; col < half; col += 1) {
          const mirrorCol = size - 1 - col;
          const px = -((col + 0.5) * stepX - halfW);
          const edgeX = px - halfW + radius;
          const sdf =
            cornerDistance(edgeX > 0 ? edgeX : 0, edgeY > 0 ? edgeY : 0) +
            (edgeX > edgeY ? (edgeX > 0 ? 0 : edgeX) : edgeY > 0 ? 0 : edgeY) -
            radius;

          // Indices of the four mirror targets for this quadrant pixel.
          const i00 = (rowBase + col) * 4; // top-left  (canonical)
          const i01 = (rowBase + mirrorCol) * 4; // top-right (mirror X)
          const i10 = (mirrorRowBase + col) * 4; // bottom-left (mirror Y)
          const i11 = (mirrorRowBase + mirrorCol) * 4; // bottom-right (mirror XY)

          if (clipToShape && sdf >= 0) {
            // Outside the shape: neutral grey, no displacement, no specular.
            for (const idx of [i00, i01, i10, i11]) {
              data[idx] = 128;
              data[idx + 1] = 128;
              data[idx + 2] = 128;
              data[idx + 3] = 255;
            }
            continue;
          }

          let dirX = lut ? lut[col] : px * invW > 1 ? 1 : px * invW;
          let dirY = dirYBase;
          if (hasSplay) {
            const yAtt = splayY * splay;
            const xAtt = Math.max(0, 1 - (halfW - px) * splayInv) * splay;
            if (yAtt > 0.001 || xAtt > 0.001) {
              const prevX = dirX;
              const prevY = dirY;
              dirX = prevX * (1 - yAtt);
              dirY = prevY * (1 - xAtt);
              const prevLen = Math.sqrt(prevX * prevX + prevY * prevY);
              const nextLen = Math.sqrt(dirX * dirX + dirY * dirY);
              if (nextLen > 0.001) {
                const restore = prevLen / nextLen;
                dirX *= restore;
                dirY *= restore;
              }
            }
          }

          let edgeOpacity = 1;
          if (softEdge) {
            const ix = px - innerHalfW + innerRadius;
            const innerSdf =
              cornerDistance(ix > 0 ? ix : 0, innerEdgeY > 0 ? innerEdgeY : 0) +
              (ix > innerEdgeY
                ? ix > 0
                  ? 0
                  : ix
                : innerEdgeY > 0
                  ? 0
                  : innerEdgeY) -
              innerRadius;
            edgeOpacity = 0.5 * (1 + erf(innerSdf * falloff));
          }

          let dx = 0.5 * dirX * edgeOpacity;
          let dy = 0.5 * dirY * edgeOpacity;
          if (hasEdgeRefract) {
            // `s`: 1 at the outer rim (sdf=0) → 0 a band-width inward. The
            // meniscus is a soft BUMP that fades to 0 at BOTH ends and peaks ~1/3
            // of the band INSIDE the contour (6.75 = 27/4 normalises s²(1−s) to
            // peak 1 at s=2/3). It hits 0 at the very rim, so the extra bend lives
            // just inside the edge and never pushes hard AT the contour — the
            // background wraps inside the lip, not on the clip line. Pushes inward
            // along the SAME dome direction, gated by the soft-edge feather.
            const s = sdf < 0 ? Math.max(0, 1 + sdf * erInv) : 0;
            if (s > 0) {
              const len = Math.sqrt(dirX * dirX + dirY * dirY);
              if (len > 1e-4) {
                const m = 6.75 * s * s * (1 - s);
                const a = (0.5 * bend * m * edgeOpacity) / len;
                dx += dirX * a;
                dy += dirY * a;
              }
            }
          }

          // Specular: `specMain` rides the TL↔BR diagonal, `specCross` the
          // TR↔BL diagonal (the specular axis flips with each mirror).
          let specMain = 0;
          let specCross = 0;
          if (hasSpecular) {
            const normX = px * invW > 1 ? 1 : px * invW;
            // Projection onto the specular axis (`sheenAngle`) + its perpendicular,
            // normalized to 0..1 — these make the highlight DIRECTIONAL, so it
            // pools on the corners facing the light instead of ringing the edge.
            const axisMain = Math.min(
              1,
              Math.abs(normX * cosA + normY * sinA) * sheenNorm,
            );
            const axisCross = Math.min(
              1,
              Math.abs(normX * cosA - normY * sinA) * sheenNorm,
            );
            // Outline: a bright edge band that pools toward the light. The 0.16
            // floor keeps a faint edge all the way around so it still reads as
            // glass; the rest sheens toward the specular axis.
            if (sheen > 0) {
              const band = sdf < 0 ? Math.max(0, 1 + sdf * edgeInv) : 0;
              const b = sheen * Math.pow(band, sheenFalloff);
              specMain += b * (0.16 + 0.84 * Math.pow(axisMain, 1.6));
              specCross += b * (0.16 + 0.84 * Math.pow(axisCross, 1.6));
            }
            // Glow: a soft inner glow filling inward from the edge (all around),
            // gently brighter toward the specular axis.
            if (glow > 0) {
              // Soft inner glow: a smoothstep on the distance in from the edge, so
              // it fades with zero slope at BOTH the edge and the reach (no hard
              // ring boundary), reaching deep into the lens (glowSpread) rather
              // than hugging the rim — it blends like the refraction fill does.
              const reach = sdf < 0 ? Math.min(1, -sdf * glowReachInv) : 1;
              const t = 1 - reach;
              const g =
                glow * Math.pow(t * t * (3 - 2 * t), glowFalloff) * edgeOpacity;
              specMain += g * (0.6 + 0.4 * axisMain);
              specCross += g * (0.6 + 0.4 * axisCross);
            }
            if (specMain > 1) specMain = 1;
            else if (specMain < -1) specMain = -1;
            if (specCross > 1) specCross = 1;
            else if (specCross < -1) specCross = -1;
          }

          const rPos = encodeAxis(dx);
          const rNeg = encodeAxis(-dx);
          const gPos = encodeAxis(dy);
          const gNeg = encodeAxis(-dy);
          const bMain = encodeSpec(specMain);
          const bCross = encodeSpec(specCross);

          data[i00] = rPos;
          data[i00 + 1] = gPos;
          data[i00 + 2] = bMain;
          data[i00 + 3] = 255;
          data[i01] = rNeg;
          data[i01 + 1] = gPos;
          data[i01 + 2] = bCross;
          data[i01 + 3] = 255;
          data[i10] = rPos;
          data[i10 + 1] = gNeg;
          data[i10 + 2] = bCross;
          data[i10 + 3] = 255;
          data[i11] = rNeg;
          data[i11 + 1] = gNeg;
          data[i11 + 2] = bMain;
          data[i11 + 3] = 255;
        }
      }
      ctx!.putImageData(image!, 0, 0);
      return canvas.toDataURL();
    },
    dispose() {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
        canvas = null;
      }
      ctx = null;
      image = null;
      domeLut = null;
      dome = null;
      lutDome = -Infinity;
      lutHalfW = -Infinity;
      lutHalfH = -Infinity;
      lutLen = 0;
      lutDirty = true;
    },
  };
};
