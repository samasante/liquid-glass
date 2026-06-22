import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  GlassLensParams,
  type GlassOptics,
  DEFAULT_LENS_PARAMS,
  createLensMapGenerator,
  LensMapGenerator,
} from "./displacement";
import { type GlassValue, isGlassMotionValue, readGlassValue } from "./signal";
import { GlassWebGLRenderer, GlassLensDescriptor } from "./glassWebGL";

/**
 * WebGL glass over a `<video>` or `<canvas>` — the surfaces Safari refuses to
 * apply an SVG filter to. Same lens vocabulary as `<Glass>`; the same generated
 * displacement map drives a GPU shader instead of `feDisplacementMap`.
 */

interface CommonProps {
  lens?: Partial<GlassLensParams>;
  /** Lens half-extents in px (default 90). A motion value animates live in the
   *  draw loop; the (normalised) map is not re-baked mid-animation, so a uniform
   *  size tween rides the descriptor cleanly but an ASPECT change (one axis only)
   *  isn't re-sharpened until the next React render. */
  lensW?: GlassValue;
  lensH?: GlassValue;
  borderRadius?: GlassValue;
  /** Lens centre as a 0..1 fraction of the surface (default 0.5, 0.5). A motion
   *  value animates the lens across the surface without a React re-render (the
   *  draw loop keeps ticking even over a paused video when geometry is live). */
  x?: GlassValue;
  y?: GlassValue;
  /** Crisp interactive layer rendered on top of the refracted surface (e.g. a
   *  video player's controls). The same role children play in DOM/panel mode. */
  children?: React.ReactNode;
  /** Cap the device-pixel-ratio of the GL buffers (perf vs. crispness; a higher
   *  cap supersamples the refraction so the magnified content reads smoother).
   *  @default 1.5 */
  maxDpr?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * One lens's GEOMETRY over the shared surface — FULL px, the same units as
 * `<Glass>`'s `width`/`height`/`radius`. Every lens in a surface shares ONE
 * displacement map + one look (the surface's `optics`); per lens you set only the
 * position, size, and the enter/exit `scale`/`opacity`. (The map's SHAPE —
 * depth/curvature/sheen/corner — is driven by `optics` + the first lens's aspect.)
 */
export interface GlassSurfaceLens {
  /** Lens size in px (full). */
  w: number;
  h: number;
  /** Corner radius in px. @default min(w, h) / 2 (a pill / circle). */
  radius?: number;
  /** Centre as a 0..1 fraction of the surface. */
  x: number;
  y: number;
  /** Uniform scale about the centre for enter/exit motion. @default 1 */
  scale?: number;
  /** 0..1 fade for enter/exit motion. @default 1 */
  opacity?: number;
  /** Per-lens optics overriding the surface's shared `optics`. The displacement
   *  MAP (dome/edge SHAPE) is still shared from the first lens, but the runtime
   *  knobs — `strength`/`scaleX`/`scaleY`, `dispersion`, `specular`, `frost`,
   *  `brightness` — apply per lens. Use it to keep a gentle, flat look on a thin
   *  lens (e.g. a scrub track) while round controls keep a stronger dome. */
  optics?: Partial<GlassOptics>;
}

/** A {@link GlassSurfaceLens} with defaults resolved — what the loop consumes.
 *  Geometry is kept as {@link GlassValue} (raw) and read live in the draw loop so
 *  a motion-value centre/size animates at 60fps without a React re-render (the
 *  single-lens DOM path subscribes the same way). `radius` undefined → the loop
 *  falls back to `min(lensW, lensH)` once the extents are read. */
interface ResolvedLens {
  merged: GlassLensParams;
  lensW: GlassValue;
  lensH: GlassValue;
  radius?: GlassValue;
  x: GlassValue;
  y: GlassValue;
  scale: number;
  opacity: number;
}

const DPR = () =>
  typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

const resolveLens = (spec: {
  lens?: Partial<GlassLensParams>;
  lensW: GlassValue;
  lensH: GlassValue;
  borderRadius?: GlassValue;
  x: GlassValue;
  y: GlassValue;
  scale?: number;
  opacity?: number;
}): ResolvedLens => ({
  merged: { ...DEFAULT_LENS_PARAMS, ...spec.lens },
  lensW: spec.lensW,
  lensH: spec.lensH,
  radius: spec.borderRadius,
  x: spec.x,
  y: spec.y,
  scale: spec.scale ?? 1,
  opacity: spec.opacity ?? 1,
});

/**
 * Drive a {@link GlassWebGLRenderer} from a per-frame source. `getFrame` returns
 * the current frame as a texture source + its intrinsic size, or null to skip.
 * `specs[0]` owns the shared displacement map; every spec is drawn each frame.
 */
const useLensRenderer = (
  outRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLElement | null>,
  getFrame: () => { source: TexImageSource; w: number; h: number } | null,
  specs: ResolvedLens[],
  maxDpr: number,
  driveOnVideoFrames?: HTMLVideoElement | null,
) => {
  const [failed, setFailed] = useState(false);
  const rendererRef = useRef<GlassWebGLRenderer | null>(null);
  const generatorRef = useRef<LensMapGenerator | null>(null);
  // The first lens owns the shared map shape (all lenses sample one map).
  const shape = specs[0];
  // Live params for the rAF loop (avoid re-subscribing every render).
  const state = useRef(specs);
  state.current = specs;
  // Does any lens carry a motion-value geometry? If so the draw loop must keep
  // ticking even when the video presents no new frame (paused/buffered) — else
  // the requestVideoFrameCallback path would idle and freeze the live lens. A
  // boolean, so the loop effect only re-subscribes when it actually flips.
  const hasLiveGeometry = specs.some(
    (s) =>
      isGlassMotionValue(s.x) ||
      isGlassMotionValue(s.y) ||
      isGlassMotionValue(s.lensW) ||
      isGlassMotionValue(s.lensH) ||
      (s.radius != null && isGlassMotionValue(s.radius)),
  );

  // Renderer lifecycle + element sizing.
  useLayoutEffect(() => {
    const out = outRef.current;
    const container = containerRef.current;
    if (!out || !container) return;
    let renderer: GlassWebGLRenderer;
    try {
      renderer = new GlassWebGLRenderer(out);
    } catch (err) {
      // Surface the reason (e.g. a shader compile error on a strict WebGL2
      // backend) instead of silently falling back — otherwise the lens just
      // vanishes with no clue why.
      if (typeof console !== "undefined") {
        console.warn(
          "[liquid-glass] WebGL renderer unavailable, falling back:",
          err,
        );
      }
      setFailed(true);
      return;
    }
    rendererRef.current = renderer;
    const dpr = Math.min(DPR(), maxDpr);
    const sync = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      out.style.width = `${w}px`;
      out.style.height = `${h}px`;
      renderer.resize(Math.round(w * dpr), Math.round(h * dpr));
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(container);
    return () => {
      ro.disconnect();
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [outRef, containerRef, maxDpr]);

  // (Re)generate + upload the shared displacement map only when the SHAPE
  // changes. The map is NORMALISED, so per-lens size and the enter/exit
  // `scale`/`opacity` ride the descriptor — they must NOT key the map (else a
  // scale animation would regenerate it every frame). Only shape params + the
  // first lens's aspect/relative-radius matter.
  const m0 = shape.merged;
  // Snapshot the shape geometry to numbers for the regen key. The map is
  // NORMALISED, so a motion-value size rides the per-frame descriptor (below) and
  // need not regenerate the map mid-animation — only the aspect/relative-radius
  // matter, and those are re-keyed on the next render.
  const shapeW = readGlassValue(shape.lensW);
  const shapeH = readGlassValue(shape.lensH);
  const shapeR =
    shape.radius != null
      ? readGlassValue(shape.radius)
      : Math.min(shapeW, shapeH);
  const shapeKey = JSON.stringify([
    m0.mapSize,
    shapeW,
    shapeH,
    shapeR,
    m0.depth,
    m0.clipToShape,
    m0.softEdge,
    m0.curvature,
    m0.splay,
    m0.glow,
    m0.glowSpread,
    m0.glowFalloff,
    m0.sheen,
    m0.sheenWidth,
    m0.sheenFalloff,
    m0.sheenAngle,
    m0.bend,
    m0.bendWidth,
  ]);
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (!generatorRef.current)
      generatorRef.current = createLensMapGenerator(m0.mapSize);
    const url = generatorRef.current.generate({
      lensHalfWidth: shapeW,
      lensHalfHeight: shapeH,
      borderRadius: shapeR,
      depth: m0.depth,
      clipToShape: m0.clipToShape,
      softEdge: m0.softEdge,
      sheenAngle: m0.sheenAngle,
      glow: m0.glow,
      glowSpread: m0.glowSpread,
      glowFalloff: m0.glowFalloff,
      sheen: m0.sheen,
      sheenWidth: m0.sheenWidth,
      sheenFalloff: m0.sheenFalloff,
      curvature: m0.curvature,
      splay: m0.splay,
      bend: m0.bend,
      bendWidth: m0.bendWidth,
    });
    // Guard against out-of-order onload: a rapid shapeKey change can otherwise let
    // an earlier (stale) image overwrite the texture with the wrong shape.
    let stale = false;
    const img = new Image();
    img.onload = () => {
      if (!stale) rendererRef.current?.setDisplacementMap(img);
    };
    img.src = url;
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapeKey, failed]);

  // Per-lens displacement maps. A lens whose SHAPE differs from lens 0 (e.g. a
  // wide-thin scrub track vs a round button) gets its OWN map — otherwise it
  // samples lens 0's square map stretched to an ellipse (the refraction reads as
  // an oval). Keyed + generated like the shared map above, but per distinct shape;
  // the rAF loop binds the right map per lens via the descriptor's `dispMap`.
  const keyOf = (s: ResolvedLens): string => {
    const m = s.merged;
    const w = readGlassValue(s.lensW);
    const h = readGlassValue(s.lensH);
    const r = s.radius != null ? readGlassValue(s.radius) : Math.min(w, h);
    return JSON.stringify([
      m.mapSize, w, h, r, m.depth, m.clipToShape, m.softEdge, m.curvature,
      m.splay, m.glow, m.glowSpread, m.glowFalloff, m.sheen, m.sheenWidth,
      m.sheenFalloff, m.sheenAngle, m.bend, m.bendWidth,
    ]);
  };
  const lensKeys = specs.map(keyOf);
  const lensKeysRef = useRef(lensKeys);
  lensKeysRef.current = lensKeys;
  const perLensMaps = useRef(new Map<string, HTMLImageElement>());
  const perLensKey = lensKeys.join("|");
  useEffect(() => {
    const gen = generatorRef.current;
    if (!gen) return;
    // Prune maps (+ their GPU textures) for shapes no longer present, so a
    // responsive lens that re-keys on resize (e.g. the scrub track) can't grow
    // the cache without bound.
    const live = new Set(lensKeysRef.current);
    perLensMaps.current.forEach((img, key) => {
      if (!live.has(key)) {
        perLensMaps.current.delete(key);
        rendererRef.current?.releaseDispMap(img);
      }
    });
    const defaultKey = lensKeysRef.current[0];
    const cleanups: Array<() => void> = [];
    const want = new Set<string>();
    specs.forEach((s, i) => {
      const key = lensKeysRef.current[i];
      if (key === defaultKey || want.has(key) || perLensMaps.current.has(key))
        return;
      want.add(key);
      const m = s.merged;
      const w = readGlassValue(s.lensW);
      const h = readGlassValue(s.lensH);
      const r = s.radius != null ? readGlassValue(s.radius) : Math.min(w, h);
      const url = gen.generate({
        lensHalfWidth: w,
        lensHalfHeight: h,
        borderRadius: r,
        depth: m.depth,
        clipToShape: m.clipToShape,
        softEdge: m.softEdge,
        sheenAngle: m.sheenAngle,
        glow: m.glow,
        glowSpread: m.glowSpread,
        glowFalloff: m.glowFalloff,
        sheen: m.sheen,
        sheenWidth: m.sheenWidth,
        sheenFalloff: m.sheenFalloff,
        curvature: m.curvature,
        splay: m.splay,
        bend: m.bend,
        bendWidth: m.bendWidth,
      });
      let stale = false;
      const img = new Image();
      img.onload = () => {
        if (!stale) perLensMaps.current.set(key, img);
      };
      img.src = url;
      cleanups.push(() => {
        stale = true;
      });
    });
    return () => cleanups.forEach((c) => c());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perLensKey, failed]);

  useEffect(
    () => () => {
      generatorRef.current?.dispose();
      generatorRef.current = null;
    },
    [],
  );

  // The frame loop: upload the source, draw the lens. Uses
  // requestVideoFrameCallback for video (exact decoded frames) where available.
  useEffect(() => {
    if (failed) return;
    let raf = 0;
    let vfc = 0;
    const v = driveOnVideoFrames;
    // Prefer requestVideoFrameCallback for video (exact decoded frames, and it
    // idles while paused — the efficient default for a static-geometry player).
    // But a motion-value lens must keep animating even over a paused video, so
    // fall back to rAF when geometry is live (rAF still samples the video frame).
    const useVfc =
      !!v &&
      !hasLiveGeometry &&
      typeof v.requestVideoFrameCallback === "function";

    const draw = () => {
      const renderer = rendererRef.current;
      const container = containerRef.current;
      if (!renderer || !container) return;
      const frame = getFrame();
      if (frame && frame.w > 0 && frame.h > 0) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        // Displacement scale — MUST match the DOM `<Glass>` path for parity. The
        // SVG path scales the obb-fraction scaleX/scaleY by the SURFACE (filter
        // region) diagonal, NOT the lens, applying each axis separately (via the
        // map colour-matrix). So divide by cw/ch to land the same per-axis PIXEL
        // displacement — `surfNorm/cw` cancels to surface-relative, and using the
        // per-axis scaleX/scaleY (not their max) keeps anisotropic lenses correct.
        const surfNorm = Math.sqrt((cw * cw + ch * ch) / 2);
        const keys = lensKeysRef.current;
        const descs: GlassLensDescriptor[] = state.current.map((s, i) => {
          // Read geometry live each frame, so a motion-value centre/size animates
          // at 60fps (the same reactivity the DOM path gives geometry props).
          const lw = readGlassValue(s.lensW);
          const lh = readGlassValue(s.lensH);
          const rad =
            s.radius != null ? readGlassValue(s.radius) : Math.min(lw, lh);
          const sx = readGlassValue(s.x);
          const sy = readGlassValue(s.y);
          const ehw = lw * s.scale;
          const ehh = lh * s.scale;
          // Lens 0 uses the shared map; a different-shaped lens uses its OWN map.
          // Until that map has loaded, refract NOTHING (scale 0 → a flat glass
          // shape) rather than fall back to lens 0's wrong-shaped map, which would
          // flash the stretched-ellipse artifact this feature exists to avoid.
          const ownsShape = i > 0 && keys[i] !== keys[0];
          const ownMap = ownsShape ? perLensMaps.current.get(keys[i]) : undefined;
          const flat = ownsShape && !ownMap;
          return {
            originX: (sx * cw - ehw) / cw,
            originY: 1 - (sy * ch + ehh) / ch,
            sizeX: (2 * ehw) / cw,
            sizeY: (2 * ehh) / ch,
            scaleX: flat
              ? 0
              : ((s.merged.scaleX ?? s.merged.strength) * surfNorm) / cw,
            scaleY: flat
              ? 0
              : ((s.merged.scaleY ?? s.merged.strength) * surfNorm) / ch,
            dispersion: s.merged.dispersion,
            specular: s.merged.specular,
            blur: s.merged.frost,
            cornerRadius: (rad * s.scale) / cw,
            opacity: s.opacity,
            brightness: s.merged.brightness,
            dispMap: ownMap,
          };
        });
        renderer.render(frame.source, frame.w, frame.h, descs);
      }
      if (useVfc) vfc = v!.requestVideoFrameCallback(draw);
      else raf = requestAnimationFrame(draw);
    };

    if (useVfc) vfc = v!.requestVideoFrameCallback(draw);
    else raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      if (useVfc && vfc) v!.cancelVideoFrameCallback?.(vfc);
    };
  }, [failed, getFrame, containerRef, driveOnVideoFrames, hasLiveGeometry]);

  return failed;
};

export interface GlassSurfaceProps extends CommonProps {
  /** A video URL to refract. Pass this OR `draw`. */
  src?: string;
  /** A per-frame canvas painter to refract (a generative scene). Pass this OR
   *  `src`. `t` is milliseconds since mount. */
  draw?: (ctx: CanvasRenderingContext2D, t: number) => void;

  // ── Video options (ignored when you pass `draw`) ──
  poster?: string;
  loop?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
  /** Required for cross-origin video (the frame texture taints otherwise). */
  crossOrigin?: "anonymous" | "use-credentials";
  /** Controlled play/pause. Omit for the default autoplay-loop; set it to drive
   *  playback from your own UI (a play/pause control). */
  paused?: boolean;
  /** Ref to the underlying `<video>`. Read `currentTime`/`duration`, listen for
   *  `timeupdate`, or seek, to build your own transport (a scrub bar). */
  videoRef?: React.Ref<HTMLVideoElement>;
  /** Draw MANY lenses over one video from one renderer (a player whose every
   *  control is its own glass lens). FULL-px geometry per lens; all lenses share
   *  one look (the surface's `lens`/`optics`) and one displacement map, so you
   *  vary only position, size, `scale`, and `opacity`. Overrides the single-lens
   *  geometry props. */
  lenses?: GlassSurfaceLens[];

  // ── Canvas options (ignored when you pass `src`) ──
  /** Source canvas resolution (defaults to the surface size). */
  width?: number;
  height?: number;
}

/**
 * One liquid-glass lens over a `<video>` or a `<canvas>`, drawn with WebGL (the
 * surfaces Safari refuses to apply an SVG filter to). It's the same lens
 * vocabulary as `<Glass>`; the same generated displacement map drives a GPU
 * shader instead of `feDisplacementMap`.
 *
 * Pass `src` for a video, or `draw` for a per-frame canvas scene — one component,
 * either source, so you don't pick a different element per medium:
 *
 * ```tsx
 * <GlassSurface src="/clip.mp4" lensW={60} lensH={60} />
 * <GlassSurface draw={(ctx, t) => { …paint a frame… }} />
 * ```
 */
export const GlassSurface: React.FC<GlassSurfaceProps> = ({
  src,
  draw,
  poster,
  loop = true,
  muted = true,
  autoPlay = true,
  crossOrigin,
  paused,
  videoRef: externalVideoRef,
  lenses,
  width,
  height,
  lens,
  lensW = 90,
  lensH = 90,
  borderRadius,
  x = 0.5,
  y = 0.5,
  maxDpr = 1.5,
  className,
  style,
  children,
}) => {
  const isVideo = src != null;
  const containerRef = useRef<HTMLDivElement>(null);
  const outRef = useRef<HTMLCanvasElement>(null);

  // Video source state.
  const videoRef = useRef<HTMLVideoElement>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  // Callback ref: keep our internal ref AND forward the element to the caller.
  const setVideoEl = React.useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      if (typeof externalVideoRef === "function") externalVideoRef(el);
      else if (externalVideoRef)
        (
          externalVideoRef as React.MutableRefObject<HTMLVideoElement | null>
        ).current = el;
    },
    [externalVideoRef],
  );

  // Canvas source state (an offscreen canvas the `draw` callback paints into).
  const srcRef = useRef<HTMLCanvasElement | null>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const startRef = useRef(0);
  if (!isVideo && !srcRef.current && typeof document !== "undefined") {
    srcRef.current = document.createElement("canvas");
  }

  // Multi-lens (video player): each `lenses` entry is FULL-px geometry sharing
  // the surface's one `optics` look; map full→half-extent for the internal loop
  // (`radius` is already a full-px corner). Single lens: the adapter already
  // halved width→lensW, so pass straight through.
  const specs = (
    lenses && lenses.length
      ? lenses.map((l) => ({
          // Per-lens optics override the shared look (runtime knobs only — the
          // shared MAP shape comes from lens 0; see GlassSurfaceLens.optics).
          lens: l.optics ? { ...lens, ...l.optics } : lens,
          lensW: l.w / 2,
          lensH: l.h / 2,
          borderRadius: l.radius,
          x: l.x,
          y: l.y,
          scale: l.scale,
          opacity: l.opacity,
        }))
      : [{ lens, lensW, lensH, borderRadius, x, y }]
  ).map(resolveLens);

  useEffect(() => {
    if (isVideo) setVideo(videoRef.current);
  }, [isVideo]);

  // Controlled playback (video only, and only when `paused` is supplied).
  useEffect(() => {
    const v = videoRef.current;
    if (!isVideo || !v || paused === undefined) return;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [isVideo, paused]);

  const getFrame = React.useCallback(() => {
    if (isVideo) {
      const v = videoRef.current;
      if (!v || v.readyState < 2) return null;
      return { source: v, w: v.videoWidth, h: v.videoHeight };
    }
    const c = srcRef.current;
    const container = containerRef.current;
    if (!c || !container || !drawRef.current) return null;
    const w = width ?? Math.round(container.clientWidth);
    const h = height ?? Math.round(container.clientHeight);
    if (w === 0 || h === 0) return null;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    if (startRef.current === 0) startRef.current = performance.now();
    drawRef.current(ctx, performance.now() - startRef.current);
    return { source: c, w, h };
  }, [isVideo, width, height]);

  const failed = useLensRenderer(
    outRef,
    containerRef,
    getFrame,
    specs,
    maxDpr,
    isVideo ? video : null,
  );

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", overflow: "hidden", ...style }}
    >
      {isVideo && (
        <video
          ref={setVideoEl}
          src={src}
          poster={poster}
          loop={loop}
          muted={muted}
          autoPlay={autoPlay}
          playsInline
          crossOrigin={crossOrigin}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            // Hidden behind the (opaque) output canvas when WebGL works; shown as
            // the graceful fallback when it doesn't.
            visibility: failed ? "visible" : "hidden",
          }}
        />
      )}
      <canvas
        ref={outRef}
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          display: failed ? "none" : "block",
        }}
      />
      {!isVideo && failed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            color: "#888",
            font: "13px system-ui",
          }}
        >
          WebGL unavailable
        </div>
      )}
      {/* Crisp interactive overlay on top of the refracted surface (the canvas is
          pointerEvents:none, so children here are clickable). This is the same
          role children play in DOM/panel mode: `<Glass src><Controls/></Glass>`. */}
      {children != null && (
        <div style={{ position: "absolute", inset: 0 }}>{children}</div>
      )}
    </div>
  );
};
