import React, {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GlassLensParams,
  type GlassOptics,
  BLANK_MAP,
  DISPERSION_SPREAD,
  DEFAULT_LENS_PARAMS,
  LensMapGenerator,
  createLensMapGenerator,
  matrixForAxisScale,
  roundedRectMaskUri,
  lensShapeMaskUri,
} from "./displacement";
import {
  GlassValue,
  deriveGlass,
  isGlassMotionValue,
  readGlassValue,
} from "./signal";
import { GlassSurface, type GlassSurfaceLens } from "./GlassSurface";
import { GlassMaterial } from "./GlassMaterial";

/**
 * Resolve WebKit (Safari) on mount. SSR-safe: returns `false` on the server and
 * the first client render — so hydration matches — then settles to the real
 * value with a re-render. WebKit drives two behaviour gates: supersampling is
 * forced off (see {@link GlassProps.filterResolution}) and the specular mask is
 * sampled from the raw map.
 */
const useIsWebKit = () => {
  const [isWebKit, setIsWebKit] = useState(false);
  useEffect(() => {
    setIsWebKit(
      typeof navigator !== "undefined" &&
        /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent),
    );
  }, []);
  return isWebKit;
};

/**
 * The shared filter-primitive chain: generated map (R/G displacement, B
 * specular) → optional axis rescale → RGB-split displacement for chromatic
 * aberration → specular lift from the B channel → lens-rect hole/composite.
 * Also used by the backdrop-filter glass surfaces so dock/menus run the exact
 * same pipeline.
 */
const LensFilterContents: React.FC<{
  lens: GlassLensParams;
  mapHref: string;
  feImageRef?: React.Ref<SVGFEImageElement>;
  mapMatrixRef?: React.Ref<SVGFEColorMatrixElement>;
  /** Pre-computed stdDeviation string; rendered only when frost > 0. */
  blurStdDeviation?: string;
  /** Safari samples the specular mask from rawMap (its map composite differs). */
  specularFromRawMap?: boolean;
  /** Backdrop variant: apply brightness inside the filter (no DOM veil). */
  brightnessInFilter?: boolean;
  /**
   * Filter region size in px (userSpaceOnUse). `scaleX`/`scaleY` are
   * object-bounding-box-style fractions; the displacement scale is in user px,
   * so they're converted with the obb diagonal normalization
   * `√((w²+h²)/2)` — the look is unchanged from the obb era but both engines
   * now agree (WebKit handled obb per-primitive subregions inconsistently on
   * non-square regions, which skewed the lens to an oval).
   */
  filterW?: number;
  filterH?: number;
  /**
   * feImage carrying the lens-shape alpha mask. Supplied when `frost > 0`
   * so the blurred result is clipped to the lens shape instead of the
   * rectangular filter region (otherwise a high blur shows a square edge).
   */
  clipShapeRef?: React.Ref<SVGFEImageElement>;
}> = ({
  lens,
  mapHref,
  feImageRef,
  mapMatrixRef,
  blurStdDeviation,
  specularFromRawMap,
  brightnessInFilter,
  filterW,
  filterH,
  clipShapeRef,
}) => {
  // `strength` drives both axes; scaleX/scaleY are optional per-axis overrides.
  const lensSX = lens.scaleX ?? lens.strength;
  const lensSY = lens.scaleY ?? lens.strength;
  const maxScale = Math.max(lensSX, lensSY);
  // Displacement scale in user px: convert the obb-fraction scale with the same
  // diagonal normalization the obb spec uses for non-axis lengths, so existing
  // strength values keep their look under userSpaceOnUse.
  const dispNorm =
    filterW && filterH
      ? Math.sqrt((filterW * filterW + filterH * filterH) / 2)
      : 1;
  const dispScale = maxScale * dispNorm;
  const mapScaleX = maxScale > 0 ? lensSX / maxScale : 0;
  const mapScaleY = maxScale > 0 ? lensSY / maxScale : 0;
  const needsMapScale = !(mapScaleX === 1 && mapScaleY === 1);
  const mapInput = needsMapScale ? "scaledMap" : "map";
  const hasBlur = lens.frost > 0 && !!blurStdDeviation;
  const sourceInput = hasBlur ? "blurred" : "SourceGraphic";
  const hasSpecular = lens.glow > 0 || lens.sheen > 0;
  const spec = lens.specular;
  // A lens-shape alpha mask is needed whenever a layer must be clipped to the
  // lens silhouette instead of its rectangular filter subregion: the frosted
  // blur, and the in-filter brightness veil (a flat flood would otherwise show
  // the rectangular subregion poking past the rounded lens).
  const inFilterBrightness = brightnessInFilter && lens.brightness !== 0;
  const needsShape = hasBlur || inFilterBrightness;

  return (
    <>
      <feFlood floodColor="rgb(128,128,128)" floodOpacity="1" result="mapBg" />
      <feImage
        ref={feImageRef}
        data-lens=""
        href={mapHref}
        preserveAspectRatio="none"
        result="rawMap"
      />
      <feComposite in="rawMap" in2="mapBg" operator="over" result="map" />
      {needsMapScale && (
        <feColorMatrix
          ref={mapMatrixRef}
          in="map"
          type="matrix"
          values={matrixForAxisScale(mapScaleX, mapScaleY)}
          result="scaledMap"
        />
      )}
      {hasBlur && (
        <feGaussianBlur
          in="SourceGraphic"
          stdDeviation={blurStdDeviation}
          result="blurred"
        />
      )}
      {needsShape && (
        <feImage
          ref={clipShapeRef}
          data-lens=""
          href={BLANK_MAP}
          preserveAspectRatio="none"
          result="lensShape"
        />
      )}
      {lens.dispersion > 0 ? (
        <>
          {/* Chromatic aberration, SYMMETRIC about the base bend: R fringes
              outward (+½ spread), B inward (−½ spread), G stays at the base. The
              average displacement is therefore the base, so raising `dispersion`
              fringes the edges WITHOUT zooming/shifting the refracted field — the
              asymmetric split (R/G above base, B at base) made the mean bend grow
              with dispersion, which shifted the whole copy in Safari. Total R→B
              spread is unchanged, so the look magnitude holds. */}
          <feDisplacementMap
            data-lens=""
            in={sourceInput}
            in2={mapInput}
            scale={dispScale * (1 + DISPERSION_SPREAD * 0.5 * lens.dispersion)}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="refractR"
          />
          <feDisplacementMap
            data-lens=""
            in={sourceInput}
            in2={mapInput}
            scale={dispScale}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="refractG"
          />
          <feDisplacementMap
            data-lens=""
            in={sourceInput}
            in2={mapInput}
            scale={dispScale * (1 - DISPERSION_SPREAD * 0.5 * lens.dispersion)}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="refractB"
          />
          <feComposite
            in="refractR"
            in2="refractG"
            operator="arithmetic"
            k1="0"
            k2="1"
            k3="1"
            k4="0"
            result="refractRG"
          />
          <feComposite
            in="refractRG"
            in2="refractB"
            operator="arithmetic"
            k1="0"
            k2="1"
            k3="1"
            k4="0"
            result="lensOut"
          />
        </>
      ) : (
        <feDisplacementMap
          data-lens=""
          in={sourceInput}
          in2={mapInput}
          scale={dispScale}
          xChannelSelector="R"
          yChannelSelector="G"
          result="lensOut"
        />
      )}
      {hasSpecular &&
        (lens.sheenDark ? (
          <>
            <feColorMatrix
              in={specularFromRawMap ? "rawMap" : "map"}
              type="matrix"
              values={`0 0 ${-spec} 0 ${1 + (128 * spec) / 255}  0 0 ${-spec} 0 ${1 + (128 * spec) / 255}  0 0 ${-spec} 0 ${1 + (128 * spec) / 255}  0 0 0 0 1`}
              result="sheenMask"
            />
            <feComposite
              in="sheenMask"
              in2="lensOut"
              operator="arithmetic"
              k1="1"
              k2="0"
              k3="0"
              k4="0"
              result="lensOut"
            />
          </>
        ) : (
          <>
            <feColorMatrix
              in={specularFromRawMap ? "rawMap" : "map"}
              type="matrix"
              values={`0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 ${-128 / 255}`}
              result="sheenMask"
            />
            <feComposite
              in="sheenMask"
              in2="lensOut"
              operator="arithmetic"
              k1="0"
              k2={spec}
              k3="1"
              k4="0"
              result="lensOut"
            />
          </>
        ))}
      {inFilterBrightness && (
        <>
          <feFlood
            data-lens=""
            floodColor={lens.brightness > 0 ? "white" : "black"}
            floodOpacity={Math.abs(lens.brightness)}
            result="brightnessFlood"
          />
          {/* clip the flat veil to the lens silhouette before blending it */}
          <feComposite
            in="brightnessFlood"
            in2="lensShape"
            operator="in"
            result="brightnessVeil"
          />
          {/* Alpha-blend the veil OVER the lens (not additive): a white veil
              lightens, a black veil darkens. An additive blend would make the
              black (negative-brightness) veil a no-op — brightness < 0 would do
              nothing and the lens would keep a baseline tint. */}
          <feComposite
            in="brightnessVeil"
            in2="lensOut"
            operator="over"
            result="lensOut"
          />
        </>
      )}
      {needsShape ? (
        // Shape-clipped composite: clip the lens result to the lens-shape alpha
        // (`lensShape`, declared above) and hole the SourceGraphic with the same
        // shape, so the lens follows the rounded silhouette instead of
        // the rectangular filter subregion. Used by the frosted blur and the
        // in-filter brightness veil.
        <>
          <feComposite
            in="lensOut"
            in2="lensShape"
            operator="in"
            result="lensOut"
          />
          <feComposite
            in="SourceGraphic"
            in2="lensShape"
            operator="out"
            result="cutoutSrc"
          />
          <feComposite in="lensOut" in2="cutoutSrc" operator="over" />
        </>
      ) : (
        <>
          <feFlood
            data-lens=""
            floodColor="black"
            floodOpacity="1"
            result="lensMask"
          />
          <feComposite
            in="SourceGraphic"
            in2="lensMask"
            operator="out"
            result="cutoutSrc"
          />
          <feComposite in="lensOut" in2="cutoutSrc" operator="over" />
        </>
      )}
    </>
  );
};

// Internal: the DOM (SVG-filter) lens, in the engine's half-extent vocabulary.
// The public <Glass> adapter (below) maps the new full-px props onto these, so
// the engine internals never change.
export interface GlassDOMProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  children?: React.ReactNode;
  lens?: Partial<GlassLensParams>;
  x?: GlassValue;
  y?: GlassValue;
  lensW?: GlassValue;
  lensH?: GlassValue;
  borderRadius?: GlassValue;
  refractionTarget?: React.ReactNode;
  refractionBackground?: string;
  overlay?: React.ReactNode;
  tintColor?: string;
  tintOpacity?: GlassValue;
  tintBlur?: GlassValue;
  shadowOpacity?: GlassValue;
  restShadowOpacity?: GlassValue;
  edgeBias?: GlassValue;
  depth?: GlassValue;
  scale?: GlassValue;
  filterResolution?: number;
  brightnessInFilter?: boolean;
  pixelUnits?: boolean;
  live?: boolean;
  onLensMapChange?: (url: string | null) => void;
}

/**
 * The headless liquid-glass lens. A bare wrap is a glass MATERIAL (frosts + tints +
 * edge-lights everywhere; bends the live page in Chrome/Edge only — to bend in every
 * browser, give it geometry to bend its content in-place, or `refract` a copy). Pass
 * `refract` to refract a given node, or `src` (a video URL) / `draw` (a per-frame
 * canvas painter) to refract that medium via WebGL, for the media Safari won't SVG-filter.
 *
 * Geometry is FULL px and OPTIONAL: omit it and the lens fits the wrapped
 * element (and inherits its corner radius). The look lives in one `optics` prop.
 *
 * @example
 * ```tsx
 * <Glass><Card /></Glass>                                 // fits the element
 * <Glass refract={<Wallpaper />} behind="#222"><Card /></Glass> // panel over a bg
 * <Glass size={300} center={{ x: mx, y: my }}>…</Glass>   // a moving lens
 * <Glass src="/clip.mp4" size={120} />                    // glass over video
 * ```
 */
export interface GlassProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  children?: React.ReactNode;
  /** Refract THIS instead of the children (e.g. the page background); the
   *  children then render crisp on top. The panel / menu pattern. */
  refract?: React.ReactNode;
  /** Solid fill for the thin bleed ring the lens samples just past the
   *  panel-sized `refract` copy (without it that edge warps at high strength).
   *  Omit it and it auto-derives from the nearest ancestor's solid background —
   *  so a panel on a coloured page needs none. Set it explicitly (a photo
   *  backdrop reads cleanest with a hand-picked edge colour) or pass
   *  "transparent" to opt out. @default auto (ancestor background) */
  behind?: string;
  /** A video URL to refract via WebGL (the media Safari won't SVG-filter). */
  src?: string;
  /** A per-frame canvas painter to refract via WebGL. `t` is ms since mount. */
  draw?: (ctx: CanvasRenderingContext2D, t: number) => void;

  // ── Geometry: FULL px, a number OR a motion value. Omit any → fit the box. ──
  // Auto-fit (omitting width) shrink-wraps the wrapped element, so that element
  // must have an intrinsic in-flow size: a normal-flow box (a button, a card),
  // not a bare `position:absolute` / `width:100%` child. If it doesn't, give an
  // explicit `width`/`height` (or `size`).
  /** Lens width in px (full). Omit → fit the wrapped element (which must have an
   *  intrinsic in-flow size; otherwise pass an explicit width). */
  width?: GlassValue;
  /** Lens height in px (full). Omit → fit the wrapped element. */
  height?: GlassValue;
  /** Shorthand: a number = square, `[w, h]` = both. `width`/`height` win over it. */
  size?: GlassValue | [GlassValue, GlassValue];
  /** Corner radius in px. Omit → inherit the element's computed border-radius. */
  radius?: GlassValue;
  /** Lens centre, a 0..1 fraction of the element. @default { x: 0.5, y: 0.5 } */
  center?: { x?: GlassValue; y?: GlassValue };

  /** The optical look (every knob except geometry). The default is balanced. */
  optics?: Partial<GlassOptics>;

  // ── Animation / rendering ──
  /** Re-rasterize each frame for self-animating refracted DOM content (Safari). */
  live?: boolean;
  /** Chromium-only supersample (`2` = crisp); forced to 1 in Safari. @default 1 */
  filterResolution?: number;

  // ── Multi-lens surface (a video player whose controls are each a lens) ──
  /** Many lenses over one `src` video from one renderer. FULL-px geometry per
   *  lens (`w`/`h`/`radius`, like the top-level props); all share one `optics`
   *  look + one displacement map. */
  lenses?: GlassSurfaceLens[];
  videoRef?: React.Ref<HTMLVideoElement>;
  paused?: boolean;
  poster?: string;
  loop?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
  crossOrigin?: "anonymous" | "use-credentials";
  maxDpr?: number;

  // ── Advanced (recipe-grade; most apps never touch these) ──
  /** Animate the optics `curvature` / `strength` as motion values. */
  depth?: GlassValue;
  scale?: GlassValue;
  /** Composite the brightness veil inside the filter (large, fast lenses). */
  brightnessInFilter?: boolean;
  /** `userSpaceOnUse` filter for a small lens on a large non-square surface. */
  pixelUnits?: boolean;
  /** A node refracted on top of the children (rare). */
  overlay?: React.ReactNode;
  onLensMapChange?: (url: string | null) => void;
  /**
   * Recipe-grade lens knobs, grouped under one escape hatch so they stay off the
   * everyday surface — the controls (switch / slider) drive them; most apps never
   * touch them. `unstable_` because the exact set may change before 1.0.
   */
  unstable_lens?: {
    /** Lens-following veil (the resting white pill of a switch / slider). */
    tintColor?: string;
    tintOpacity?: GlassValue;
    tintBlur?: GlassValue;
    shadowOpacity?: GlassValue;
    restShadowOpacity?: GlassValue;
    edgeBias?: GlassValue;
  };
}

export const GlassDOM: React.FC<GlassDOMProps> = ({
  children,
  lens,
  x = 0.5,
  y = 0.5,
  lensW,
  lensH,
  borderRadius,
  refractionTarget,
  refractionBackground = "transparent",
  overlay,
  tintColor,
  tintOpacity,
  tintBlur,
  shadowOpacity,
  restShadowOpacity,
  edgeBias,
  depth,
  scale,
  filterResolution = 1,
  brightnessInFilter = false,
  pixelUnits = false,
  live = false,
  onLensMapChange,
  className,
  style,
  ...rest
}) => {
  const isWebKit = useIsWebKit();
  const isWebKitRef = useRef(isWebKit);
  isWebKitRef.current = isWebKit;
  const brightnessInFilterRef = useRef(brightnessInFilter);
  brightnessInFilterRef.current = brightnessInFilter;
  const pixelUnitsRef = useRef(pixelUnits);
  pixelUnitsRef.current = pixelUnits;
  const liveRef = useRef(live);
  liveRef.current = live;
  const filterResolutionRef = useRef(filterResolution);
  filterResolutionRef.current = filterResolution;
  const merged = useMemo(
    () => ({
      ...DEFAULT_LENS_PARAMS,
      ...lens,
    }),
    [lens],
  );
  const mergedRef = useRef(merged);
  mergedRef.current = merged;
  const baseId = useId().replace(/:/g, "");

  const containerRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);
  const refractionRef = useRef<HTMLDivElement>(null);
  const overlayClipRef = useRef<HTMLDivElement>(null);
  const brightnessRef = useRef<HTMLDivElement>(null);
  const tintRef = useRef<HTMLDivElement>(null);
  const blurRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const restShadowRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<SVGFilterElement>(null);
  const feImageRef = useRef<SVGFEImageElement>(null);
  const shapeImageRef = useRef<SVGFEImageElement>(null);
  const mapMatrixRef = useRef<SVGFEColorMatrixElement>(null);
  const lensElsRef = useRef<Element[]>([]);
  const dispElsRef = useRef<Element[]>([]);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const sized = size.w > 0 && size.h > 0;

  // `behind` fills the thin bleed ring around a refracted COPY — the few px the
  // lens samples past the panel-sized copy at high strength (without it that
  // edge warps/blackens). When it's omitted, auto-derive it from the nearest
  // ancestor's solid background, so a panel sitting on a coloured page needs no
  // `behind` at all. An explicit value (including "transparent") always wins; a
  // photo backdrop still reads cleanest with a hand-picked edge colour once you
  // crank strength, which is why the photo examples keep one.
  const hasCopy = refractionTarget != null;
  const [autoBehind, setAutoBehind] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!hasCopy || refractionBackground !== "transparent") {
      setAutoBehind(null);
      return;
    }
    if (typeof window === "undefined") return;
    let el = containerRef.current?.parentElement ?? null;
    let found: string | null = null;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      const parts = bg.match(/rgba?\(([^)]+)\)/)?.[1].split(",");
      const alpha = parts && parts[3] != null ? parseFloat(parts[3]) : 1;
      if (alpha > 0.95) {
        found = bg;
        break;
      }
      el = el.parentElement;
    }
    setAutoBehind(found);
  }, [hasCopy, refractionBackground]);
  const bleedFill =
    refractionBackground !== "transparent"
      ? refractionBackground
      : (autoBehind ?? "transparent");

  // Live numeric state mirrored from props/motion values.
  const xRef = useRef(0.5);
  const yRef = useRef(0.5);
  const halfWRef = useRef(merged.lensW);
  const halfHRef = useRef(merged.lensH);
  const radiusRef = useRef(merged.borderRadius);
  // Auto-fit: when a geometry prop is omitted, the lens fills the measured
  // element (and inherits its computed border-radius). These flags say which
  // axes were given; the geometry pass falls back to the measured box otherwise.
  const hasWRef = useRef(lensW !== undefined);
  hasWRef.current = lensW !== undefined;
  const hasHRef = useRef(lensH !== undefined);
  hasHRef.current = lensH !== undefined;
  const hasRRef = useRef(borderRadius !== undefined);
  hasRRef.current = borderRadius !== undefined;
  const autoRadiusRef = useRef(0);
  const depthRef = useRef(merged.depth);
  const scaleXRef = useRef(merged.scaleX ?? merged.strength);
  const scaleYRef = useRef(merged.scaleY ?? merged.strength);
  const tintOpacityRef = useRef(1);
  const tintBlurRef = useRef(0);
  const shadowOpacityRef = useRef(1);
  const restShadowOpacityRef = useRef(0);
  const edgeBiasRef = useRef(0.5);

  const lastLeftRef = useRef(NaN);
  const lastTopRef = useRef(NaN);
  const lastScaleRef = useRef(NaN);
  // Browser page-zoom factor (cmd-+). Safari does NOT rescale a userSpaceOnUse
  // filter's px coords under page zoom, so the bend drifts off the lens; we detect
  // the factor (window.outerWidth / innerWidth — Safari halves innerWidth at 2×)
  // and multiply the px coords by it. 1 at 100% and in Blink (which rescales them
  // itself), so it's a no-op except for zoomed WebKit.
  const zoomRef = useRef(1);
  const versionRef = useRef(0);
  const maskKeyRef = useRef("");
  const updateQueuedRef = useRef(false);
  const mapUrlRef = useRef<string | null>(null);
  const shapeUrlRef = useRef<string | null>(null);
  const generatorRef = useRef<{ gen: LensMapGenerator; size: number } | null>(
    null,
  );
  const tintColorRef = useRef(tintColor);
  tintColorRef.current = tintColor;
  const onMapChangeRef = useRef(onLensMapChange);
  onMapChangeRef.current = onLensMapChange;

  // Source bleed (tight-region / pixelUnits mode): how far the refracted copy
  // extends past the surface, filled with `refractionBackground`. Without it the
  // displacement samples past the surface edge and the lens warps/blackens there
  // — the real fix for edge contortion (vs. clamping the lens far from the edge).
  // Sized to the displacement reach + feather, so a lens sitting at the very edge
  // still refracts solid background instead of nothing.
  const bleedNorm =
    size.w > 0 && size.h > 0
      ? Math.sqrt((size.w * size.w + size.h * size.h) / 2)
      : 0;
  let bleedStrength = Math.max(
    merged.scaleX ?? merged.strength,
    merged.scaleY ?? merged.strength,
  );
  // Mirror updateGeometry's displacement cap (search "bound the displacement") here:
  // the bleed sizes the source copy AND feeds the filter-region width, so it has to
  // be capped the same way or the region keeps growing past Safari's ceiling even
  // though the bend is capped. Same lens-relative, dispersion-aware cap, in both
  // browsers, so the two stay in sync. No-op at normal strengths.
  if (bleedNorm > 0) {
    // lensW/lensH may be motion values; fall back to the measured surface size for
    // those (motion-valued lenses are small + low-strength, so never hit the cap).
    const fullLW = typeof lensW === "number" ? lensW * 2 : size.w;
    const fullLH = typeof lensH === "number" ? lensH * 2 : size.h;
    // Same dispersion factor as updateGeometry's cap + margin, so bleed + region
    // stay in sync. The dispersed R channel reaches `1 + SPREAD*dispersion` x the
    // base (NOT a fixed 1.2 — that under-margins at dispersion > ~0.9, which let the
    // colour fringe clip/drift past the lens at high dispersion).
    const dispFactor = 1 + DISPERSION_SPREAD * merged.dispersion;
    bleedStrength = Math.min(
      bleedStrength,
      (Math.max(fullLW, fullLH) * 0.6) / (bleedNorm * dispFactor),
    );
  }
  const bleed =
    pixelUnits && refractionTarget != null && size.w > 0 && size.h > 0
      ? Math.ceil(
          bleedStrength *
            bleedNorm *
            (1 + DISPERSION_SPREAD * merged.dispersion) *
            0.5 +
            merged.depth +
            28,
        ) + 16
      : 0;
  const bleedRef = useRef(bleed);
  bleedRef.current = bleed;

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      // Auto-fit radius: inherit the corner when `radius` is omitted. Prefer the
      // container's own radius, but fall back to the WRAPPED element's — the
      // common `<Glass><Card/></Glass>` rounds the lens to the card, even though
      // the radius lives on the child, not on the (unstyled) Glass container.
      if (!hasRRef.current && typeof getComputedStyle !== "undefined") {
        let r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
        const child = sourceRef.current?.firstElementChild;
        if (!r && child) {
          r = parseFloat(getComputedStyle(child).borderTopLeftRadius) || 0;
        }
        autoRadiusRef.current = r;
      }
      setSize((prev) =>
        prev.w === rect.width && prev.h === rect.height
          ? prev
          : { w: rect.width, h: rect.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const updateGeometry = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    // Prefer the ResizeObserver-tracked size to the live measure — a forced
    // reflow every frame would tank `live` mode (one rAF per frame). Fall back
    // to a measure only before the observer has settled.
    let w = sizeRef.current.w;
    let h = sizeRef.current.h;
    if (!(w > 0 && h > 0)) {
      const rect = container.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
    }
    if (!(w > 0 && h > 0)) return;
    const lensParams = mergedRef.current;

    const sx = scaleXRef.current;
    const sy = scaleYRef.current;
    let maxScale = Math.max(sx, sy);
    const dispersion = lensParams.dispersion;

    const halfW = hasWRef.current ? halfWRef.current : w / 2;
    const halfH = hasHRef.current ? halfHRef.current : h / 2;
    const radius = hasRRef.current ? radiusRef.current : autoRadiusRef.current;
    let cx = xRef.current * w;
    let cy = yRef.current * h;
    // Keep the lens fully on the surface in tight-region (pixelUnits) mode — it
    // sticks at the edge instead of running off it. The bled source means the
    // displacement at that edge still samples background, so no warp.
    if (pixelUnitsRef.current && refractionRef.current) {
      cx = Math.max(halfW, Math.min(w - halfW, cx));
      cy = Math.max(halfH, Math.min(h - halfH, cy));
    }
    const left = cx - halfW;
    const top = cy - halfH;
    const fullW = 2 * halfW;
    const fullH = 2 * halfH;

    // Bound the displacement to the LENS's own size. Our displacement is
    // SURFACE-relative (a small lens in a big surface bends strongly), so a high
    // `strength` on a large surface produces a huge px displacement — which both (a)
    // inflates the SVG filter region (the margin `m` below + the source bleed) past
    // Safari's hard filter-size ceiling, so Safari renders the bend MISALIGNED with
    // the lens (it drifts off the round clip), and (b) is non-physical anyway (you
    // can't refract more than the lens spans). Capping the displacement to ~0.6x the
    // lens size keeps the region bounded AND the bend physical. Applied in BOTH
    // browsers (not just WebKit) so the look is IDENTICAL cross-browser — at normal
    // strengths every shipped surface bends well under its lens, so this is a no-op
    // (verified byte-identical); only an extreme strength on a big surface is
    // clamped, the same in Chrome and Safari.
    if (pixelUnitsRef.current) {
      const norm = Math.sqrt((w * w + h * h) / 2);
      // Dispersion widens the region: the R channel displaces `1 + SPREAD*dispersion`
      // x the base (e.g. 1.44x at dispersion 2). Divide the cap by that real factor —
      // a FIXED 1.2 under-margins past dispersion ~0.9, so the colour fringe samples
      // beyond the region and clips/drifts (the loupe-with-high-dispersion bug). The
      // margin `m` + bleed use the SAME factor so they all stay in sync.
      const dispFactor = 1 + DISPERSION_SPREAD * dispersion;
      const maxDisp = Math.max(fullW, fullH) * 0.6;
      if (norm > 0)
        maxScale = Math.min(maxScale, maxDisp / (norm * dispFactor));
    }

    // Supersample multiplier: the refraction/overlay layers are rendered into
    // a `w*G × h*G` raster scaled down by 1/G, so clip-paths (which live in
    // that layer's own coordinate space) scale by G. Lens subregion fractions
    // are objectBoundingBox so they're resolution-independent and unchanged.
    // Forced to 1 in WebKit (see `filterResolution`) so the filter source stays
    // under Safari's size ceiling and the specular/dispersion passes survive.
    // Read via ref — this callback is memoized on [baseId] and must not capture a
    // stale `filterResolution` (it would freeze in the per-frame `live` loop).
    const fr = filterResolutionRef.current;
    const G = fr !== 1 && !isWebKitRef.current ? fr : 1;
    // Page-zoom compensation for the userSpaceOnUse path (WebKit only — Blink
    // rescales the filter itself). Folded into G so every px coord that already
    // scales by the supersample also scales by zoom. 1 at 100% → byte-identical.
    const GZ = isWebKitRef.current ? G * zoomRef.current : G;

    const posChanged =
      left !== lastLeftRef.current || top !== lastTopRef.current;
    const scaleChanged = maxScale !== lastScaleRef.current;
    lastLeftRef.current = left;
    lastTopRef.current = top;
    lastScaleRef.current = maxScale;

    // `live` forces the subregion write + filter-id bump every frame even when
    // the lens is still, so self-animating refracted content stays live.
    if (posChanged || scaleChanged || liveRef.current) {
      const bias = edgeBiasRef.current;
      const px = pixelUnitsRef.current;
      // pixelUnits (userSpaceOnUse): the lens subregion sits at the lens's
      // absolute position in the filtered element's own coordinate space — the
      // element is a normal, untransformed full-surface copy. Two hard Safari
      // rules force this shape (each one cost a regression):
      //   • Never put a CSS `transform` on the filtered element — real Safari
      //     silently drops `filter: url()` on a transformed element (the lens
      //     vanishes entirely; headless WebKit still renders it, hiding the bug).
      //   • Never offset the filter REGION origin — Safari maps an offset
      //     userSpaceOnUse region's origin onto the SourceGraphic origin, so the
      //     lens samples the page's top-left and freezes that content in place.
      // So we keep the element untransformed and the region pinned at (0, 0),
      // and bound per-frame cost by sizing the region's width/height down to the
      // lens's far edge (origin stays at 0, which is the Safari-safe part).
      const norm = Math.sqrt((w * w + h * h) / 2);
      // `1 + SPREAD*dispersion` = the dispersed R channel's reach (not a fixed 1.2),
      // so the region margin actually contains the colour fringe at high dispersion.
      const dispMax =
        maxScale * norm * (1 + DISPERSION_SPREAD * dispersion) * 0.5;
      const m = Math.ceil(dispMax + depthRef.current + 28);
      // In pixelUnits the refracted copy is bled `bld` px beyond the surface, so
      // the lens sits at (left+bld, top+bld) in the copy's local space; that
      // bleed is also the margin that keeps the displacement on solid source.
      const bld = px && refractionRef.current ? bleedRef.current : 0;
      const lx = String(px ? (left + bld + bias) * GZ : (left + bias) / w);
      const ly = String(px ? (top + bld + bias) * GZ : (top + bias) / h);
      const lw = String(
        px
          ? Math.max(0, fullW - 2 * bias) * GZ
          : Math.max(0, fullW - 2 * bias) / w,
      );
      const lh = String(
        px
          ? Math.max(0, fullH - 2 * bias) * GZ
          : Math.max(0, fullH - 2 * bias) / h,
      );
      for (const el of lensElsRef.current) {
        el.setAttribute("x", lx);
        el.setAttribute("y", ly);
        el.setAttribute("width", lw);
        el.setAttribute("height", lh);
      }
      if (scaleChanged) {
        // In pixelUnits the displacement scale is in px: convert the obb-fraction
        // scaleX/scaleY with the obb diagonal normalization so the look matches
        // (and matches LensFilterContents' dispScale; the map colorMatrix carries
        // X/Y anisotropy). In obb mode the scale stays a fraction.
        const dispBase = px ? maxScale * norm * GZ : maxScale;
        // SYMMETRIC chroma split about the base — must match LensFilterContents'
        // static scales (R: +½ spread, G: base, B: −½ spread). The mean displacement
        // is therefore the base regardless of dispersion, so raising `dispersion`
        // fringes the edges WITHOUT shifting/zooming the refracted field. (The old
        // asymmetric set — R/G above base, B at base — grew the mean with dispersion,
        // so the whole copy drifted up-left as dispersion was turned up.)
        const scales =
          dispersion > 0
            ? [
                dispBase * (1 + DISPERSION_SPREAD * 0.5 * dispersion),
                dispBase,
                dispBase * (1 - DISPERSION_SPREAD * 0.5 * dispersion),
              ]
            : [dispBase];
        const dispEls = dispElsRef.current;
        for (let i = 0; i < dispEls.length; i += 1) {
          dispEls[i].setAttribute("scale", String(scales[i] ?? 0));
        }
      }
      const filterEl = filterRef.current;
      if (filterEl) {
        if (px) {
          filterEl.setAttribute("x", "0");
          filterEl.setAttribute("y", "0");
          if (refractionRef.current) {
            // CLONE path: region pinned at the origin (Safari-safe), sized to reach
            // the lens + the displacement/feather margin, so the filter rasterizes
            // only up to the lens, not the whole surface — a small lens over a big
            // cloned surface stays cheap. (A full-surface region is slower here.)
            filterEl.setAttribute(
              "width",
              String((left + bld + fullW + m) * GZ),
            );
            filterEl.setAttribute(
              "height",
              String((top + bld + fullH + m) * GZ),
            );
          } else {
            // IN-PLACE (wrap mode): the filtered element IS the real content, so the
            // region must cover the WHOLE element or content outside the lens gets
            // clipped away. The lens stays a neutral-elsewhere sub-region (only it
            // bends); cost scales with the element area, so keep the wrapped region
            // content-sized, not a full-page scene.
            filterEl.setAttribute("width", String(w * GZ));
            filterEl.setAttribute("height", String(h * GZ));
          }
        }
        versionRef.current += 1;
        filterEl.id = `lg-${baseId}-v${versionRef.current}`;
        const url = mapUrlRef.current ? `url(#${filterEl.id})` : "";
        if (refractionRef.current) {
          if (refractionRef.current.style.filter !== url) {
            refractionRef.current.style.filter = url;
          }
          // clip the (bled) copy to the lens silhouette; insets are from the copy
          // edges, which sit `bld` px outside the surface on every side.
          refractionRef.current.style.clipPath = `inset(${Math.max(0, top + bld) * G}px ${Math.max(0, w + bld - (left + fullW)) * G}px ${Math.max(0, h + bld - (top + fullH)) * G}px ${Math.max(0, left + bld) * G}px round ${radius * G}px)`;
          if (sourceRef.current && !overlayClipRef.current) {
            sourceRef.current.style.filter = "";
          }
        } else if (
          sourceRef.current &&
          sourceRef.current.style.filter !== url
        ) {
          sourceRef.current.style.filter = url;
        }
      }
    }

    if (overlayClipRef.current) {
      overlayClipRef.current.style.clipPath = `inset(${Math.max(0, top) * G}px ${Math.max(0, w - (left + fullW)) * G}px ${Math.max(0, h - (top + fullH)) * G}px ${Math.max(0, left) * G}px round ${radius * G}px)`;
    }
    if (brightnessRef.current && !overlayClipRef.current) {
      brightnessRef.current.style.clipPath = `inset(${Math.max(0, top)}px ${Math.max(0, w - (left + fullW))}px ${Math.max(0, h - (top + fullH))}px ${Math.max(0, left)}px round ${radius}px)`;
    }

    const placeLensLayer = (el: HTMLElement, opacity?: number) => {
      el.style.transform = `translate(${left}px, ${top}px)`;
      el.style.width = `${fullW}px`;
      el.style.height = `${fullH}px`;
      el.style.borderRadius = `${radius}px`;
      if (opacity !== undefined) el.style.opacity = String(opacity);
    };
    if (shadowRef.current)
      placeLensLayer(shadowRef.current, shadowOpacityRef.current);
    if (restShadowRef.current) {
      placeLensLayer(restShadowRef.current, restShadowOpacityRef.current);
    }
    if (blurRef.current) {
      blurRef.current.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      blurRef.current.style.width = `${fullW}px`;
      blurRef.current.style.height = `${fullH}px`;
      blurRef.current.style.borderRadius = `${radius}px`;
      const { uri, key } = roundedRectMaskUri(fullW, fullH, radius);
      if (maskKeyRef.current !== key) {
        const mask = `url("${uri}")`;
        blurRef.current.style.maskImage = mask;
        blurRef.current.style.setProperty("-webkit-mask-image", mask);
        blurRef.current.style.maskSize = "100% 100%";
        blurRef.current.style.setProperty("-webkit-mask-size", "100% 100%");
        maskKeyRef.current = key;
      }
    }
    if (tintRef.current) {
      placeLensLayer(tintRef.current);
      const color = tintColorRef.current ?? "white";
      tintRef.current.style.background = `color-mix(in srgb, ${color} ${100 * tintOpacityRef.current}%, transparent)`;
      tintRef.current.style.opacity = "1";
      const blur =
        tintBlurRef.current > 0 ? `blur(${tintBlurRef.current}px)` : "none";
      tintRef.current.style.backdropFilter = blur;
      tintRef.current.style.setProperty("-webkit-backdrop-filter", blur);
    }
    if (mapMatrixRef.current) {
      const mx = maxScale > 0 ? sx / maxScale : 0;
      const my = maxScale > 0 ? sy / maxScale : 0;
      mapMatrixRef.current.setAttribute("values", matrixForAxisScale(mx, my));
    }
  }, [baseId]);

  const scheduleUpdate = useCallback(() => {
    if (updateQueuedRef.current) return;
    updateQueuedRef.current = true;
    queueMicrotask(() => {
      updateQueuedRef.current = false;
      updateGeometry();
    });
  }, [updateGeometry]);

  const forceGeometry = useCallback(() => {
    lastLeftRef.current = NaN;
    lastScaleRef.current = NaN;
    updateGeometry();
  }, [updateGeometry]);

  // Track browser page zoom (cmd-+). Safari keeps window.outerWidth constant and
  // halves innerWidth at 2×, so the ratio is the zoom factor; page zoom also fires
  // `resize`. The container's measured size is CSS px (zoom-invariant), so nothing
  // else re-runs geometry on a pure zoom — without this the GZ comp never updates.
  useEffect(() => {
    const readZoom = () => {
      const iw = window.innerWidth;
      const z = iw > 0 ? window.outerWidth / iw : 1;
      if (!(z > 0.2 && z < 12)) return 1;
      // Snap near-1 to exactly 1 so scrollbar / window-chrome noise can't perturb
      // the (RMSE-sacred) un-zoomed look — the smallest real zoom step is ~10%.
      return Math.abs(z - 1) < 0.04 ? 1 : z;
    };
    const onResize = () => {
      const z = readZoom();
      if (Math.abs(z - zoomRef.current) > 0.002) {
        zoomRef.current = z;
        forceGeometry();
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [forceGeometry]);

  const regenerate = useCallback(() => {
    const mapSize = mergedRef.current.mapSize;
    if (!generatorRef.current || generatorRef.current.size !== mapSize) {
      generatorRef.current?.gen.dispose();
      generatorRef.current = {
        gen: createLensMapGenerator(mapSize),
        size: mapSize,
      };
    }
    const lensParams = mergedRef.current;
    const halfW = hasWRef.current ? halfWRef.current : sizeRef.current.w / 2;
    const halfH = hasHRef.current ? halfHRef.current : sizeRef.current.h / 2;
    const radius = hasRRef.current ? radiusRef.current : autoRadiusRef.current;
    const url = generatorRef.current.gen.generate({
      lensHalfWidth: halfW,
      lensHalfHeight: halfH,
      borderRadius: radius,
      depth: depthRef.current,
      clipToShape: lensParams.clipToShape,
      softEdge: lensParams.softEdge,
      sheenAngle: lensParams.sheenAngle,
      glow: lensParams.glow,
      glowSpread: lensParams.glowSpread,
      glowFalloff: lensParams.glowFalloff,
      sheen: lensParams.sheen,
      sheenWidth: lensParams.sheenWidth,
      sheenFalloff: lensParams.sheenFalloff,
      curvature: lensParams.curvature,
      splay: lensParams.splay,
      bend: lensParams.bend,
      bendWidth: lensParams.bendWidth,
    });
    mapUrlRef.current = url;
    feImageRef.current?.setAttribute("href", url);
    if (
      lensParams.frost > 0 ||
      (brightnessInFilterRef.current && lensParams.brightness !== 0)
    ) {
      const shape = lensShapeMaskUri(2 * halfW, 2 * halfH, radius);
      shapeUrlRef.current = shape.uri;
      shapeImageRef.current?.setAttribute("href", shape.uri);
    }
    onMapChangeRef.current?.(url);
    forceGeometry();
  }, [forceGeometry]);
  const regenerateRef = useRef(regenerate);
  regenerateRef.current = regenerate;

  // Stale-proofing key for everything that shapes the displacement map.
  const shapeKey = JSON.stringify([
    merged.mapSize,
    merged.clipToShape,
    merged.softEdge,
    merged.sheenAngle,
    merged.glow,
    merged.glowSpread,
    merged.glowFalloff,
    merged.sheen,
    merged.sheenWidth,
    merged.sheenFalloff,
    merged.curvature,
    merged.splay,
    merged.bend,
    merged.bendWidth,
    // Auto-fit: when a geometry prop is omitted the effective extent is the
    // measured box, so fold the measured size into the shape key (regen on resize).
    isGlassMotionValue(lensW) ? "mv" : (lensW ?? (size.w / 2 || merged.lensW)),
    isGlassMotionValue(lensH) ? "mv" : (lensH ?? (size.h / 2 || merged.lensH)),
    isGlassMotionValue(borderRadius)
      ? "mv"
      : (borderRadius ?? autoRadiusRef.current),
    isGlassMotionValue(depth) ? "mv" : (depth ?? merged.depth),
    brightnessInFilter && merged.brightness !== 0,
  ]);

  // 1) Bind props/motion values to the live numeric refs.
  useLayoutEffect(() => {
    const subs: Array<() => void> = [];
    const bind = (
      value: GlassValue | undefined,
      target: React.MutableRefObject<number>,
      fallback: number,
      // In `live` mode the rAF loop drives geometry every frame, so a motion
      // value only writes its ref here — no extra per-change schedule.
      onChange: () => void = () => {
        if (!liveRef.current) scheduleUpdate();
      },
    ) => {
      if (value === undefined) {
        target.current = fallback;
        return;
      }
      if (isGlassMotionValue(value)) {
        target.current = value.get();
        subs.push(
          value.on("change", (next) => {
            target.current = next;
            onChange();
          }),
        );
      } else {
        target.current = value;
      }
    };
    bind(x, xRef, 0.5);
    bind(y, yRef, 0.5);
    bind(lensW ?? merged.lensW, halfWRef, merged.lensW);
    bind(lensH ?? merged.lensH, halfHRef, merged.lensH);
    bind(borderRadius ?? merged.borderRadius, radiusRef, merged.borderRadius);
    bind(depth ?? merged.depth, depthRef, merged.depth);
    bind(
      scale ?? merged.scaleX ?? merged.strength,
      scaleXRef,
      merged.scaleX ?? merged.strength,
    );
    bind(
      scale ?? merged.scaleY ?? merged.strength,
      scaleYRef,
      merged.scaleY ?? merged.strength,
    );
    bind(tintOpacity, tintOpacityRef, 1);
    bind(tintBlur, tintBlurRef, 0);
    bind(shadowOpacity, shadowOpacityRef, 1);
    bind(restShadowOpacity, restShadowOpacityRef, 0);
    bind(edgeBias, edgeBiasRef, 0.5);
    updateGeometry();
    return () => subs.forEach((unsub) => unsub());
  }, [
    x,
    y,
    lensW,
    lensH,
    borderRadius,
    depth,
    scale,
    tintOpacity,
    tintBlur,
    shadowOpacity,
    restShadowOpacity,
    edgeBias,
    merged,
    scheduleUpdate,
    updateGeometry,
  ]);

  // 2) Re-query filter primitives after structural re-renders, restore the map
  //    href React just reset, and force a geometry pass.
  const hasDispersion = merged.dispersion > 0;
  const hasBlur = merged.frost > 0;
  const hasSpecular = merged.glow > 0 || merged.sheen > 0;
  useLayoutEffect(() => {
    const filterEl = filterRef.current;
    lensElsRef.current = filterEl
      ? Array.from(filterEl.querySelectorAll("[data-lens]"))
      : [];
    dispElsRef.current = filterEl
      ? Array.from(filterEl.querySelectorAll("feDisplacementMap"))
      : [];
    if (feImageRef.current && mapUrlRef.current) {
      feImageRef.current.setAttribute("href", mapUrlRef.current);
    }
    if (shapeImageRef.current && shapeUrlRef.current) {
      shapeImageRef.current.setAttribute("href", shapeUrlRef.current);
    }
    forceGeometry();
  }, [
    sized,
    hasDispersion,
    hasBlur,
    hasSpecular,
    merged.sheenDark,
    merged.scaleX,
    merged.scaleY,
    merged.strength,
    merged.brightness,
    brightnessInFilter,
    pixelUnits,
    isWebKit,
    refractionTarget != null,
    overlay != null,
    forceGeometry,
  ]);

  // 2b) Recompute geometry synchronously whenever the container RESIZES or the
  //     `bleed` margin changes. The subregion/region/clip-path all derive from
  //     the container size AND from `bleed` (which grows with `dispersion` +
  //     `strength`). On a STATIC lens, updateGeometry's main block only runs when
  //     the lens MOVES or `strength` changes — so a live `dispersion` change moved
  //     the refracted copy's `inset:-bleed` (a React style) WITHOUT recomputing
  //     the compensating clip-path → the glass drifted until the next strength/
  //     shape tweak forced a recompute. Depending on `bleed` here forces that
  //     recompute the moment dispersion (hence bleed) changes, so the clip stays
  //     locked to the copy. (A moving/`live` lens never hit this — it recomputes
  //     every frame anyway; only static panels did.)
  useLayoutEffect(() => {
    if (sized) forceGeometry();
  }, [size.w, size.h, bleed, forceGeometry]);

  // 3) Generate the displacement map (sync, reusable canvas).
  useLayoutEffect(() => {
    if (!sized) return;
    regenerateRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sized, shapeKey]);

  // Regenerate the displacement map only once the lens shape SETTLES, never
  // mid-motion: the map is regenerated only when the glass changes SHAPE, never
  // when it simply moves. The wobble spring perturbs
  // lensW/lensH every frame during a drag; regenerating per frame swaps the
  // feImage href constantly, and Safari throttles the costly passes (specular
  // + dispersion) while that churns — so the shine/aberration only appear once you
  // hold still. Debouncing keeps the href stable through the gesture; the live
  // size/squash is carried every frame by the subregion stretch in
  // updateGeometry, so it still looks right. A trailing regen sharpens the map
  // when motion stops.
  useEffect(() => {
    const subs: Array<() => void> = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(() => regenerateRef.current(), 90);
    };
    for (const value of [lensW, lensH, borderRadius, depth]) {
      if (isGlassMotionValue(value)) subs.push(value.on("change", onChange));
    }
    return () => {
      subs.forEach((unsub) => unsub());
      clearTimeout(timer);
    };
  }, [lensW, lensH, borderRadius, depth]);

  useEffect(
    () => () => {
      generatorRef.current?.gen.dispose();
      generatorRef.current = null;
      onMapChangeRef.current?.(null);
    },
    [],
  );

  // `live`: the refracted content animates on its own, so re-rasterize the
  // filter every frame (Safari caches filter output by id — see `live` prop).
  // updateGeometry bumps the id every frame while liveRef is set; one pass per
  // frame, so a still lens over moving content stays live without flicker.
  useEffect(() => {
    if (!live || !sized) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      updateGeometry();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [live, sized, updateGeometry]);

  // feGaussianBlur stdDeviation: px (× G) under pixelUnits/userSpaceOnUse;
  // obb fraction of the element otherwise.
  const blurG = filterResolution !== 1 && !isWebKit ? filterResolution : 1;
  const blurStdDeviation =
    hasBlur && sized
      ? pixelUnits
        ? `${merged.frost * blurG}`
        : `${merged.frost / size.w} ${merged.frost / size.h}`
      : undefined;

  // Supersampling: render the filtered layer into a `size×G` raster scaled
  // down by 1/G so the SVG filter rasterizes at G× device pixels. The inner
  // div scales the content back up so it lands at its true size inside the
  // oversized raster. WebKit-gated to 1 — see `filterResolution`.
  const G = filterResolution !== 1 && !isWebKit ? filterResolution : 1;
  const superSource =
    G > 1 && overlay == null && refractionTarget == null && sized;
  // Wrap mode: the `children` ARE the refracted source (no `refract`/`overlay`).
  // Auto-fit width: wrap mode with no explicit `width`, and not supersampling.
  // The container shrinks to the wrapped element so the lens "fits the element"
  // (the documented promise) instead of stretching to the full parent row, and —
  // critically — the in-flow source below gives the container its intrinsic
  // height (an unsized `width:100%` container collapsed to 0 height → the filter
  // gated off → `<Glass><Card/></Glass>` rendered nothing).
  const wrapMode = overlay == null && refractionTarget == null;
  const autoFitWidth = wrapMode && !superSource && lensW === undefined;
  const superWrap = (
    ref: React.Ref<HTMLDivElement>,
    content: React.ReactNode,
    outerStyle: React.CSSProperties,
  ) => (
    <div
      ref={ref}
      style={{
        ...outerStyle,
        position: "absolute",
        top: 0,
        left: 0,
        width: size.w * G,
        height: size.h * G,
        transform: `scale(${1 / G})`,
        transformOrigin: "top left",
      }}
    >
      <div
        style={{
          transform: `scale(${G})`,
          transformOrigin: "top left",
          width: size.w,
          height: size.h,
        }}
      >
        {content}
      </div>
    </div>
  );

  const brightnessLayer =
    merged.brightness !== 0 && !brightnessInFilter ? (
      <div
        ref={brightnessRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background: merged.brightness > 0 ? "white" : "black",
          opacity: Math.abs(merged.brightness),
        }}
      />
    ) : null;

  const shadowLayer = (
    ref: React.RefObject<HTMLDivElement | null>,
    shadow?: string,
    insetShadow?: string,
  ) =>
    shadow || insetShadow ? (
      <div
        ref={ref}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
          willChange: "transform",
          boxSizing: "border-box",
          boxShadow: [shadow, insetShadow ? `inset ${insetShadow}` : null]
            .filter(Boolean)
            .join(", "),
        }}
      />
    ) : null;

  return (
    <div
      ref={containerRef}
      data-liquid-glass=""
      className={className}
      style={{
        contain: "layout",
        position: "relative",
        overflow: "visible",
        // Sizing: in auto-fit wrap mode the box shrinks to the wrapped element.
        // Otherwise impose NO width, so you can size <Glass> with CSS / className /
        // style (a block is 100% wide by default; the lens fits whatever size the
        // box ends up). `style` still wins over everything. Height is never forced,
        // so it's CSS-controllable too.
        ...(autoFitWidth ? { width: "fit-content" } : null),
        // children-mode supersampling makes the source absolute; reserve height
        ...(superSource ? { minHeight: size.h } : null),
        ...style,
      }}
      {...rest}
    >
      {/* Source content. Filtered only in children-only mode; in
          refractionTarget/overlay modes it's the interactive layer on top.
          In children-only mode the wrapper fills the container (absolute
          inset:0) so full-bleed children resolve against it — `filter`/
          `will-change:filter` makes it their containing block. In
          refractionTarget/overlay modes it stays in normal flow so the
          interactive content lays out naturally. */}
      {superSource ? (
        superWrap(sourceRef, children, { willChange: "filter" })
      ) : overlay == null && refractionTarget == null ? (
        // Wrap mode: the children ARE the refracted source. Two sizings:
        //
        // • AUTO-FIT (no explicit lens size): render in NORMAL FLOW so the
        //   wrapped element dictates the container's intrinsic size and the lens
        //   fits it. An absolute source would contribute no height → the
        //   container collapses and the filter never engages.
        //
        // • EXPLICIT lens size (a "scene"/stage the consumer sizes with CSS):
        //   FILL the container (absolute inset:0) and CLIP overflow. The obb bend
        //   is normalized to the SOURCE's box, while the disc geometry uses the
        //   measured CONTAINER box — if the source is left to size itself from the
        //   content, free-flowing content (an unsized <img>, reflowing text)
        //   makes those two boxes diverge, so the bend ovals and detaches from the
        //   disc. Filling+clipping pins source box === container box, so the lens
        //   stays round and locked to the disc no matter what content goes in.
        //
        // `will-change:filter` makes this the containing block for full-bleed
        // absolute children; the lens filter is applied imperatively (updateGeometry).
        <div
          ref={sourceRef}
          style={
            autoFitWidth
              ? { willChange: "filter" }
              : {
                  // Pin the source box to the MEASURED container size so the obb
                  // bend (normalized to the source) can't diverge from the disc
                  // (normalized to the container). If the source is left to size
                  // itself, free content — an unsized <img>, reflowing text —
                  // makes the two boxes diverge: the bend ovals and the veil
                  // detaches from the disc (this was the "breaks with custom
                  // content" bug). With the box pinned, oversized content simply
                  // OVERFLOWS and is CLIPPED to the stage (so a full-res <img>
                  // covers it instead of leaving a gap).
                  //
                  // Explicit PX height (not `100%`/`minHeight:100%`): WebKit won't
                  // resolve a percentage height against a container whose height
                  // comes from `inset`/abs-positioning rather than an explicit
                  // `height`, so the percentage no-op'd in Safari and the source
                  // stayed content-sized → oval+detached there (round in Blink).
                  // The measured px value is unambiguous in every engine; `auto`
                  // until measured so a content-sized container can't collapse.
                  // `overflow:hidden` + `contain:paint` hard-clip overflow to that
                  // box AND keep the filter's reference box at the stage size in
                  // WebKit (so a huge <img> rasterizes at stage size, not its own).
                  willChange: "filter",
                  position: "relative",
                  height: sized ? size.h : undefined,
                  overflow: "hidden",
                  contain: "paint",
                }
          }
        >
          {children}
        </div>
      ) : overlay == null && pixelUnits ? (
        // refractionTarget + pixelUnits (hero): the base layer is the crisp,
        // unfiltered content and must fill the container so full-bleed
        // absolute children resolve against it. (No will-change:filter — the
        // refraction copy carries the filter; an empty will-change:filter
        // wrapper would establish a 0-height containing block and collapse
        // absolute children.) `isolation:isolate` makes this a stacking
        // context so a positive `z-index` on the user's refracted content
        // can't leak out and paint OVER the refraction layer (which is the
        // next sibling, z-index:auto) — i.e. it guarantees the lens always
        // renders above the crisp content it refracts.
        <div
          ref={sourceRef}
          style={{ position: "absolute", inset: 0, isolation: "isolate" }}
        >
          {children}
        </div>
      ) : (
        <div
          ref={overlay != null ? undefined : sourceRef}
          style={overlay != null ? undefined : { willChange: "filter" }}
        >
          {children}
        </div>
      )}
      {refractionTarget != null &&
        // A normal, untransformed copy of the content (never transformed or
        // repositioned per frame — real Safari drops the filter on a transformed
        // element; the lens moves only via the filter subregion). The region is
        // pinned at the copy origin and clip-path trims it to the lens silhouette.
        (pixelUnits ? (
          // Bleed the copy `bleed` px beyond the surface, filled with the page
          // background, with the content offset back (inset:bleed) to stay aligned
          // with the base. So a lens near any edge still refracts solid source
          // instead of warping. Static offset — no per-frame transform.
          <div
            ref={refractionRef}
            style={{
              position: "absolute",
              inset: -bleed,
              pointerEvents: "none",
              willChange: "filter, clip-path",
              background: bleedFill,
            }}
          >
            <div style={{ position: "absolute", inset: bleed }}>
              {refractionTarget}
            </div>
          </div>
        ) : G > 1 ? (
          superWrap(refractionRef, refractionTarget, {
            pointerEvents: "none",
            willChange: "filter, clip-path",
            background: bleedFill,
          })
        ) : (
          <div
            ref={refractionRef}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              willChange: "filter, clip-path",
              background: bleedFill,
            }}
          >
            {refractionTarget}
          </div>
        ))}
      {overlay != null && (
        <div
          ref={overlayClipRef}
          style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
        >
          <div ref={sourceRef} style={{ willChange: "filter" }}>
            {overlay}
          </div>
          {brightnessLayer}
        </div>
      )}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <svg
          viewBox={`0 0 ${size.w} ${size.h}`}
          width="100%"
          height="100%"
          style={{ display: "block" }}
        >
          <defs>
            <filter
              ref={filterRef}
              id={`lg-${baseId}-v0`}
              filterUnits={pixelUnits ? "userSpaceOnUse" : "objectBoundingBox"}
              primitiveUnits={
                pixelUnits ? "userSpaceOnUse" : "objectBoundingBox"
              }
              colorInterpolationFilters="sRGB"
              x={0}
              y={0}
              width={pixelUnits ? size.w * G : 1}
              height={pixelUnits ? size.h * G : 1}
            >
              {sized && (
                <LensFilterContents
                  lens={{
                    ...merged,
                    scaleX:
                      scale !== undefined
                        ? readGlassValue(scale)
                        : (merged.scaleX ?? merged.strength),
                    scaleY:
                      scale !== undefined
                        ? readGlassValue(scale)
                        : (merged.scaleY ?? merged.strength),
                  }}
                  mapHref={BLANK_MAP}
                  feImageRef={feImageRef}
                  mapMatrixRef={mapMatrixRef}
                  blurStdDeviation={blurStdDeviation}
                  specularFromRawMap={isWebKit}
                  brightnessInFilter={brightnessInFilter}
                  filterW={pixelUnits ? size.w * G : undefined}
                  filterH={pixelUnits ? size.h * G : undefined}
                  clipShapeRef={shapeImageRef}
                />
              )}
            </filter>
          </defs>
        </svg>
        {overlay == null && brightnessLayer}
        {tintColor !== undefined && (
          <div
            ref={tintRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
              overflow: "hidden",
              willChange: "transform",
            }}
          />
        )}
      </div>
      {/* CSS backdrop-filter frost layer — ONLY for a content-less surface (no
          SourceGraphic to blur in-filter). When the lens refracts its own content
          (children / refractionTarget),
          the in-filter feGaussianBlur frosts the refraction while the specular
          sheen is composited AFTER it (so the sheen stays sharp); this layer would
          sit on top and re-blur that sheen, so we skip it. */}
      {hasBlur &&
        children == null &&
        refractionTarget == null &&
        overlay == null && (
          <div
            ref={blurRef}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
              willChange: "backdrop-filter, transform",
              backdropFilter: `blur(${merged.frost}px)`,
              WebkitBackdropFilter: `blur(${merged.frost}px)`,
            }}
          />
        )}
      {shadowLayer(shadowRef, merged.edgeShadow, merged.edgeInsetShadow)}
      {shadowLayer(
        restShadowRef,
        merged.restEdgeShadow,
        merged.restEdgeInsetShadow,
      )}
    </div>
  );
};

// Map a FULL-px width/height onto the engine's internal half-extent, preserving
// motion values (a stable derived value, so the bind subscribes once).
const useHalf = (v: GlassValue | undefined): GlassValue | undefined =>
  useMemo(
    () =>
      v == null
        ? undefined
        : isGlassMotionValue(v)
          ? deriveGlass([v], () => v.get() / 2)
          : (v as number) / 2,
    [v],
  );

/** The public {@link GlassProps} adapter over the internal DOM + WebGL impls. It
 *  translates the full-px / `optics` / `refract` vocabulary to the engine's, and
 *  routes to the WebGL surface when `src` or `draw` is given. See {@link GlassProps}. */
export const Glass: React.FC<GlassProps> = (props) => {
  const {
    children,
    width,
    height,
    size,
    radius,
    center,
    optics,
    refract,
    behind,
    src,
    draw,
    lenses,
    videoRef,
    paused,
    poster,
    loop,
    muted,
    autoPlay,
    crossOrigin,
    maxDpr,
    unstable_lens,
    ...restProps
  } = props;
  // The recipe-grade lens knobs live under one `unstable_lens` escape hatch on the
  // public API; merge them back into `rest` so the engine plumbing below is unchanged.
  const rest = { ...restProps, ...(unstable_lens ?? {}) };
  // Lens centre as 0..1 fractions, fed to the inner engine's x/y.
  const cx = center?.x;
  const cy = center?.y;
  const [sw, sh] = Array.isArray(size)
    ? size
    : size != null
      ? [size, size]
      : [undefined, undefined];
  const lensW = useHalf(width ?? sw);
  const lensH = useHalf(height ?? sh);

  // WebGL surface mode: a video `src` or a canvas `draw`. Geometry is passed
  // through as motion values (resolved live in the surface's draw loop, so a
  // motion-value centre animates at 60fps), and `children` render as the crisp
  // interactive overlay on top — the same role they play in DOM/panel mode. A
  // multi-lens `lenses` array drives a player.
  if (src != null || draw != null) {
    return (
      <GlassSurface
        src={src}
        draw={draw}
        lens={optics}
        lenses={lenses}
        videoRef={videoRef}
        paused={paused}
        poster={poster}
        loop={loop}
        muted={muted}
        autoPlay={autoPlay}
        crossOrigin={crossOrigin}
        maxDpr={maxDpr}
        lensW={lensW}
        lensH={lensH}
        borderRadius={radius}
        x={cx}
        y={cy}
        className={props.className}
        style={props.style}
      >
        {children}
      </GlassSurface>
    );
  }

  // Material mode (the friendly default): a plain wrap with no explicit refraction
  // source becomes a glass MATERIAL — the styled box frosts + refracts the LIVE
  // page behind it (Chrome/Edge), with frost + tint + a bright edge cross-browser,
  // and the children crisp on top. This replaces the old wrap-mode-refracts-its-
  // own-flat-pixels behaviour (which didn't read as glass). The copy-based engine
  // below still serves refract / src / draw / lenses and the advanced wrap
  // props (overlay / pixelUnits / tintColor / live / depth / scale / …), so an
  // explicit refraction source or any of those opt back into it.
  const {
    overlay,
    tintColor,
    tintOpacity,
    tintBlur,
    shadowOpacity,
    restShadowOpacity,
    edgeBias,
    brightnessInFilter,
    depth,
    scale,
    filterResolution,
    pixelUnits,
    live,
    onLensMapChange,
    ...htmlRest
  } = rest;
  // Material is for a STATIC, CSS-sized wrap. Any explicit refraction source, any
  // copy-engine-only knob, a positioned `center`, or a motion-valued geometry
  // (which material can't animate) opts back into the proven GlassDOM engine — so
  // those keep working and never leak onto the material div.
  const animatedGeometry =
    isGlassMotionValue(width) ||
    isGlassMotionValue(height) ||
    isGlassMotionValue(radius) ||
    isGlassMotionValue(sw) ||
    isGlassMotionValue(sh) ||
    isGlassMotionValue(cx) ||
    isGlassMotionValue(cy);
  const isMaterial =
    children != null &&
    refract == null &&
    src == null &&
    draw == null &&
    lenses == null &&
    overlay == null &&
    !pixelUnits &&
    tintColor == null &&
    tintOpacity == null &&
    tintBlur == null &&
    shadowOpacity == null &&
    restShadowOpacity == null &&
    edgeBias == null &&
    !brightnessInFilter &&
    filterResolution == null &&
    !live &&
    depth == null &&
    scale == null &&
    onLensMapChange == null &&
    cx == null &&
    cy == null &&
    !animatedGeometry;
  if (isMaterial) {
    // The zero-copy material (bends the live page in Chrome/Edge, frost + tint +
    // bright edge cross-browser). For a cross-browser BEND, wrap content in-place
    // (`<Glass center size>{x}</Glass>`) or float a `refract` copy over it.
    return (
      <GlassMaterial
        {...htmlRest}
        optics={optics}
        radius={radius}
        width={width ?? sw}
        height={height ?? sh}
      >
        {children}
      </GlassMaterial>
    );
  }

  // DOM mode (standalone): the full-px / `optics` / `refract` vocabulary mapped onto
  // the internal half-extent lens. `refract` bends a copy (float over content you
  // don't own); omit it and `children` are bent in-place (cross-browser).
  return (
    <GlassDOM
      {...rest}
      lensW={lensW}
      lensH={lensH}
      borderRadius={radius}
      x={cx}
      y={cy}
      lens={optics}
      refractionTarget={refract}
      refractionBackground={behind}
    >
      {children}
    </GlassDOM>
  );
};
