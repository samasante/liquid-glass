import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type GlassOptics,
  DEFAULT_LENS_PARAMS,
  DISPERSION_SPREAD,
  LensMapGenerator,
  createLensMapGenerator,
  matrixForAxisScale,
} from "./displacement";
import { GlassValue, isGlassMotionValue, readGlassValue } from "./signal";

/**
 * Material mode — the friendly default for `<Glass>children</Glass>`.
 *
 * You style the wrapper however you like (a translucent `background` = the tint,
 * a `border-radius`, padding, a size — via `className` / `style` / Tailwind) and
 * this turns that box into glass: it frosts and refracts the LIVE page behind it,
 * the translucent colour reads as a tint over the refraction, a soft bright edge
 * rims it, and the children render crisp on top.
 *
 * The mechanism is one CSS property: `backdrop-filter`. It filters whatever is
 * painted BEHIND the element (never the element's own content), so:
 *   • `blur()` + `saturate()` frost the backdrop — cross-browser.
 *   • ` url(#…)` runs an SVG displacement filter on the backdrop — the liquid
 *     refraction — which ships in Blink (Chrome/Edge) only. Safari and Firefox
 *     get the frost + tint + edge; the bend needs a copyable backdrop (an in-place
 *     `<Glass>` over its own content, or `refract`), so material mode is honest about it.
 *
 * Because the colour you set is the glass tint, it must be TRANSLUCENT — a solid
 * `background` is opaque and hides the refraction (not glass). We dev-warn when
 * the computed background is fully opaque.
 */

/**
 * Does this engine support `backdrop-filter: url(#…)` (a custom SVG filter on the
 * backdrop)? Blink (Chrome/Edge/Opera) does; WebKit (Safari) and Gecko (Firefox)
 * support `backdrop-filter: blur()` but NOT `url()`. `@supports`/probe-element
 * tests are unreliable here (engines parse the `url()` syntax without rendering
 * it), so sniff the engine — the same approach `useIsWebKit` uses.
 *
 * We bias toward a false NEGATIVE: if we're unsure, we leave `url()` OFF. A
 * wrongly-disabled Blink just loses the bend (still frosts); a wrongly-ENABLED
 * Safari would get `url()` in the value, which is invalid there and drops the
 * WHOLE `backdrop-filter` — no frost at all. So only enable when confident.
 *
 * SSR-safe: `false` on the server + first client render (so hydration matches),
 * then settles on mount.
 */
const useSupportsBackdropUrl = () => {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    const ua = navigator.userAgent;
    // Chromium exposes `navigator.userAgentData`; Safari and Firefox do not.
    // On iOS every browser is really WebKit (CriOS / EdgiOS / FxiOS) with no
    // userAgentData and no `url()` support, so this rules them out too. The UA
    // fallback covers Chromium builds with userAgentData disabled.
    const hasUAData =
      (navigator as Navigator & { userAgentData?: unknown }).userAgentData !=
      null;
    const isBlink =
      hasUAData ||
      (/\b(?:Chrome|Chromium|Edg)\//.test(ua) &&
        !/\b(?:CriOS|EdgiOS|FxiOS|OPiOS)\b/.test(ua) &&
        !/iPhone|iPad|iPod/.test(ua));
    setOk(isBlink);
  }, []);
  return ok;
};

/**
 * The material default look — a subtle glass SURFACE (not a magnifying loupe).
 * Gentle body, a soft rim meniscus, light chromatic edge, a directional sheen.
 * `frost` here is the backdrop blur in PX (the CSS `blur()` radius), unlike the
 * tiny obb/px frost the copy-based engine uses. Override any field via `optics`.
 */
export const MATERIAL_OPTICS: Partial<GlassOptics> = {
  strength: 0.05,
  depth: 0.5,
  curvature: 0.3,
  bend: 0.45,
  bendWidth: 0.16,
  dispersion: 0.32,
  frost: 6,
  saturate: 1.15,
  sheen: 0.32,
  sheenWidth: 3,
  sheenFalloff: 1.5,
  glow: 0.1,
  glowSpread: 1,
  glowFalloff: 0.5,
  specular: 1,
  sheenAngle: 45,
  brightness: 0,
};

/**
 * The displacement + dispersion + specular primitive chain for the BACKDROP-filter
 * context. `SourceGraphic` here IS the backdrop (the live page behind the
 * element), so this refracts it directly — no copy. Simpler than the copy-based
 * `LensFilterContents`: the element's own border-box (+ radius) clips the result,
 * so there's no shape-cutout, and the frost lives in the CSS `blur()` ahead of
 * this filter, so there's no in-filter blur. userSpaceOnUse throughout (px).
 */
const MaterialFilterContents: React.FC<{
  /** Displacement scale in px (already obb-normalized: strength × diagonal). */
  dispScale: number;
  dispersion: number;
  /** B-channel specular gain (sheen + glow); 0 → skip the specular pass. */
  specular: number;
  hasSpecular: boolean;
  /** Per-axis map rescale around 0.5 (anisotropic lenses); null → none. */
  mapMatrix: string | null;
  width: number;
  height: number;
  mapUrl: string;
  feImageRef: React.Ref<SVGFEImageElement>;
}> = ({
  dispScale,
  dispersion,
  specular,
  hasSpecular,
  mapMatrix,
  width,
  height,
  mapUrl,
  feImageRef,
}) => {
  const mapInput = mapMatrix ? "scaledMap" : "map";
  return (
    <>
      {/* Back the map with neutral grey (displacement 0) across the whole, margin-
          extended region: the feImage only covers the box, so without this the map
          is transparent-black outside it and the displacement resampling biases the
          box edge toward a dark/contorted fringe. Mirrors LensFilterContents. */}
      <feFlood floodColor="rgb(128,128,128)" floodOpacity="1" result="mapBg" />
      <feImage
        ref={feImageRef}
        href={mapUrl || undefined}
        x={0}
        y={0}
        width={width}
        height={height}
        preserveAspectRatio="none"
        result="rawMap"
      />
      <feComposite in="rawMap" in2="mapBg" operator="over" result="map" />
      {mapMatrix && (
        <feColorMatrix
          in="map"
          type="matrix"
          values={mapMatrix}
          result="scaledMap"
        />
      )}
      {dispersion > 0 ? (
        <>
          <feDisplacementMap
            in="SourceGraphic"
            in2={mapInput}
            scale={dispScale * (1 + DISPERSION_SPREAD * dispersion)}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="refractR"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2={mapInput}
            scale={dispScale * (1 + DISPERSION_SPREAD * 0.5 * dispersion)}
            xChannelSelector="R"
            yChannelSelector="G"
          />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="refractG"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2={mapInput}
            scale={dispScale}
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
          in="SourceGraphic"
          in2={mapInput}
          scale={dispScale}
          xChannelSelector="R"
          yChannelSelector="G"
          result="lensOut"
        />
      )}
      {hasSpecular && (
        <>
          {/* Lift the map's B channel into a bright sheen mask (128→0, 255→1),
              then add it over the refracted backdrop — the directional rim shine
              + soft inner glow, the same specular the rest of the library uses. */}
          <feColorMatrix
            in="map"
            type="matrix"
            values={`0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 1 0 ${-128 / 255}`}
            result="sheenMask"
          />
          <feComposite
            in="sheenMask"
            in2="lensOut"
            operator="arithmetic"
            k1="0"
            k2={specular}
            k3="1"
            k4="0"
          />
        </>
      )}
    </>
  );
};

export interface GlassMaterialProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  children?: React.ReactNode;
  optics?: Partial<GlassOptics>;
  /** Corner radius in px. Omit → inherit the wrapper's computed border-radius. */
  radius?: GlassValue;
  /** Explicit box size in px (usually you size it with CSS/className instead). */
  width?: GlassValue;
  height?: GlassValue;
}

const num = (v: GlassValue | undefined): number | undefined =>
  v == null ? undefined : isGlassMotionValue(v) ? readGlassValue(v) : v;

export const GlassMaterial: React.FC<GlassMaterialProps> = ({
  children,
  optics,
  radius,
  width,
  height,
  className,
  style,
  ...rest
}) => {
  const supportsUrl = useSupportsBackdropUrl();
  const merged = useMemo(
    () => ({ ...DEFAULT_LENS_PARAMS, ...MATERIAL_OPTICS, ...optics }),
    [optics],
  );
  const baseId = useId().replace(/:/g, "");

  const wrapRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<SVGFilterElement>(null);
  const feImageRef = useRef<SVGFEImageElement>(null);
  const generatorRef = useRef<{ gen: LensMapGenerator; size: number } | null>(
    null,
  );
  const mapUrlRef = useRef<string>("");
  const versionRef = useRef(0);

  // Measured box + the radius to round the lens map / edge to. Precedence:
  // explicit `radius` prop → the wrapper's own border-radius (className/style) →
  // the wrapped child's radius (so `<Glass><button/></Glass>` rounds the glass to
  // a rounded button). `appliedR` is the radius we set on the WRAPPER itself, set
  // only when it comes from the prop or the child (the user gave the box none) —
  // so the backdrop-filter + edge round to the same shape without clobbering a
  // radius the user set in their className/style. `adoptedRef` latches the child
  // adoption so the radius we inject doesn't read back as the wrapper's "own"
  // radius next measure (which would flip-flop it back to square).
  const [box, setBox] = useState({
    w: 0,
    h: 0,
    r: 0,
    appliedR: undefined as number | undefined,
  });
  // Whether we must inject `position: relative` to make the wrapper a containing
  // block for the inset:0 edge/filter layers. Default false so the FIRST render
  // injects no position and the measure effect (pre-paint) can read the element's
  // REAL computed position — a className like `absolute`/`fixed` would otherwise be
  // masked by our own inline relative and silently lost.
  const [needsRelative, setNeedsRelative] = useState(false);
  const sized = box.w > 0 && box.h > 0;
  const explicitR = num(radius);
  const explicitW = num(width);
  const explicitH = num(height);
  const styleHasRadius = style?.borderRadius != null;
  const adoptedRef = useRef(false);

  useLayoutEffect(() => {
    adoptedRef.current = false;
  }, [explicitR, styleHasRadius, className]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const hasCS = typeof getComputedStyle !== "undefined";
      const cs = hasCS ? getComputedStyle(el) : null;
      const own = cs ? parseFloat(cs.borderTopLeftRadius) || 0 : 0;
      // Force `relative` only when the element is otherwise STATIC; if a className /
      // CSS already positions it (absolute / fixed / sticky), leave it alone. We
      // treat a computed `relative` as "keep current" — it's either our own injected
      // relative or the user's, both correct — so re-measures never flip-flop it.
      if (cs) {
        const pos = cs.position;
        setNeedsRelative((prev) =>
          pos === "static" ? true : pos === "relative" ? prev : false,
        );
      }
      let r: number;
      let appliedR: number | undefined;
      if (explicitR != null) {
        r = explicitR;
        appliedR = explicitR;
      } else if (styleHasRadius || (own > 0 && !adoptedRef.current)) {
        // The user rounds the wrapper themselves (style/className) — read it for
        // the map, but leave the radius to their CSS (don't inject one).
        r = own;
        appliedR = undefined;
      } else {
        // No radius on the wrapper → adopt the wrapped child's, and latch it so
        // the injected value doesn't masquerade as the wrapper's own next pass.
        // Skip our own injected layers (brightness/edge/svg) so we read the first
        // real content child, not an internal node.
        let child: Element | null = el.firstElementChild;
        while (child && child.hasAttribute("data-lg-layer")) {
          child = child.nextElementSibling;
        }
        const childR =
          child && hasCS
            ? parseFloat(getComputedStyle(child).borderTopLeftRadius) || 0
            : 0;
        r = childR;
        appliedR = childR;
        adoptedRef.current = true;
      }
      setBox((prev) =>
        prev.w === rect.width &&
        prev.h === rect.height &&
        prev.r === r &&
        prev.appliedR === appliedR
          ? prev
          : { w: rect.width, h: rect.height, r, appliedR },
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
  }, [explicitR, styleHasRadius, className]);

  // Stale-proofing key: regenerate the displacement map when the box size, the
  // radius, or any map-shaping optic changes.
  const shapeKey = JSON.stringify([
    box.w,
    box.h,
    box.r,
    merged.mapSize,
    merged.clipToShape,
    merged.softEdge,
    merged.depth,
    merged.curvature,
    merged.splay,
    merged.bend,
    merged.bendWidth,
    merged.sheen,
    merged.sheenWidth,
    merged.sheenFalloff,
    merged.sheenAngle,
    merged.glow,
    merged.glowSpread,
    merged.glowFalloff,
  ]);

  // Refraction reach in px (max displacement + feather), shared by the map and
  // the filter-region margin so the displacement near the box edge samples real
  // page just outside the box (no black/contorted rim). Mirrors GlassDOM's `m`.
  const sx = merged.scaleX ?? merged.strength;
  const sy = merged.scaleY ?? merged.strength;
  const maxScale = Math.max(sx, sy);
  const norm = sized ? Math.sqrt((box.w * box.w + box.h * box.h) / 2) : 0;
  const dispScale = maxScale * norm;
  const margin = sized
    ? Math.ceil(dispScale * (merged.dispersion > 0 ? 1.2 : 1) * 0.5 + 28)
    : 0;

  const mapScaleX = maxScale > 0 ? sx / maxScale : 1;
  const mapScaleY = maxScale > 0 ? sy / maxScale : 1;
  const mapMatrix =
    mapScaleX === 1 && mapScaleY === 1
      ? null
      : matrixForAxisScale(mapScaleX, mapScaleY);

  const hasSpecular = merged.glow > 0 || merged.sheen > 0;

  // Generate the displacement map + bump the filter id + (re)write the
  // backdrop-filter so the browser picks up the new map. Blink gets the url()
  // refraction; everyone else gets frost + saturate only.
  useLayoutEffect(() => {
    if (!sized) return;
    const mapSize = merged.mapSize;
    if (!generatorRef.current || generatorRef.current.size !== mapSize) {
      generatorRef.current?.gen.dispose();
      generatorRef.current = {
        gen: createLensMapGenerator(mapSize),
        size: mapSize,
      };
    }
    const url = generatorRef.current.gen.generate({
      lensHalfWidth: box.w / 2,
      lensHalfHeight: box.h / 2,
      borderRadius: box.r,
      depth: merged.depth,
      clipToShape: merged.clipToShape,
      softEdge: merged.softEdge,
      sheenAngle: merged.sheenAngle,
      glow: merged.glow,
      glowSpread: merged.glowSpread,
      glowFalloff: merged.glowFalloff,
      sheen: merged.sheen,
      sheenWidth: merged.sheenWidth,
      sheenFalloff: merged.sheenFalloff,
      curvature: merged.curvature,
      splay: merged.splay,
      bend: merged.bend,
      bendWidth: merged.bendWidth,
    });
    mapUrlRef.current = url;
    feImageRef.current?.setAttribute("href", url);
    applyBackdropFilter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sized, shapeKey]);

  // Compose + apply the backdrop-filter string (and bump the filter id so the
  // browser re-rasterizes against the fresh map).
  const applyBackdropFilter = useMemo(
    () => () => {
      const el = wrapRef.current;
      const filterEl = filterRef.current;
      if (!el) return;
      const frost = Math.max(0, merged.frost);
      const sat = merged.saturate ?? 1;
      const fns = [
        frost > 0 ? `blur(${frost}px)` : "",
        sat !== 1 ? `saturate(${sat})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      let value = fns || "none";
      if (supportsUrl && filterEl && mapUrlRef.current) {
        versionRef.current += 1;
        filterEl.id = `lg-mat-${baseId}-v${versionRef.current}`;
        value = `${fns ? fns + " " : ""}url(#${filterEl.id})`;
      }
      el.style.backdropFilter = value;
      el.style.setProperty("-webkit-backdrop-filter", value);
    },
    [merged.frost, merged.saturate, supportsUrl, baseId],
  );

  // Re-apply (which BUMPS the filter id) when anything that shapes the filter
  // changes without re-running the map regen: the frost/saturate/url-support
  // (via applyBackdropFilter's identity) and the displacement/specular optics that
  // feed the filter primitives but aren't in shapeKey (dispersion / strength /
  // scaleX / scaleY / specular). Blink caches backdrop-filter output by filter id,
  // so without the bump those optic changes would mutate the SVG attrs but the
  // page would keep showing the old refraction — same rule the copy engine follows.
  useEffect(() => {
    if (sized) applyBackdropFilter();
  }, [
    sized,
    applyBackdropFilter,
    merged.dispersion,
    merged.strength,
    merged.scaleX,
    merged.scaleY,
    merged.specular,
  ]);

  useEffect(
    () => () => {
      generatorRef.current?.gen.dispose();
      generatorRef.current = null;
    },
    [],
  );

  // Dev-warn once if the wrapper's background is fully opaque — it hides the
  // refraction, so the glass can't read as glass (the colour needs alpha). Resolve
  // the opacity by painting the computed colour into a 1×1 canvas and reading the
  // alpha byte, so it works for any CSS colour syntax (rgb / oklch / color(...) /
  // Tailwind v4 palettes), not just rgb(a).
  const warnedRef = useRef(false);
  useEffect(() => {
    if (
      warnedRef.current ||
      !sized ||
      typeof getComputedStyle === "undefined" ||
      typeof document === "undefined"
    )
      return;
    const el = wrapRef.current;
    if (!el) return;
    const bg = getComputedStyle(el).backgroundColor;
    let opaque = false;
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, 1, 1);
        // Fully opaque (alpha 255) hides the backdrop. A transparent/absent
        // background resolves to alpha 0 → not flagged.
        opaque = ctx.getImageData(0, 0, 1, 1).data[3] === 255;
      }
    } catch {
      opaque = false;
    }
    if (opaque && typeof console !== "undefined") {
      console.warn(
        "[liquid-glass] <Glass>: the wrapper's background is fully opaque, so it hides the refraction (no glass shows through). Give it an alpha (e.g. `bg-red-400/40` / `rgba(...,0.4)`). (An opaque `background-image` — a solid gradient or photo — hides it the same way.)",
      );
      warnedRef.current = true;
    }
  }, [sized]);

  // The soft bright edge — cross-browser, additive over whatever's behind it.
  // A top inset highlight + a hairline rim + an outer drop shadow (the Apple
  // look: frost + a soft bright edge + a milky veil, no bevel). Built from the
  // specular gain so it tracks the optics. Rendered as its own inset layer so it
  // never fights a `box-shadow` the user set in their className/style.
  const edgeShadow = useMemo(() => {
    const g = Math.max(0, Math.min(1.5, merged.specular));
    // A soft bright top highlight + a faint all-round hairline. No dark line
    // anywhere — a dark edge reads as a bevel, which Sam rejects.
    return [
      `inset 0 1px 0 rgba(255,255,255,${(0.55 * g).toFixed(3)})`,
      `inset 0 0 0 1px rgba(255,255,255,${(0.12 * g).toFixed(3)})`,
    ].join(", ");
  }, [merged.specular]);

  // The wrapper must be a positioned containing block (the edge + filter layers are
  // inset:0 absolute). An explicit positioned inline `style.position` wins; a
  // className that positions it (absolute / fixed / sticky) is honoured via the
  // measured `needsRelative` (we then inject nothing); a static element gets
  // `relative`. We never inject an inline position that would clobber a Tailwind
  // `absolute` / `fixed` — the bug this `needsRelative` measurement avoids.
  const userPos = style?.position;
  const userPositioned =
    userPos != null &&
    userPos !== "static" &&
    userPos !== "unset" &&
    userPos !== "initial";
  const position: React.CSSProperties["position"] | undefined = userPositioned
    ? userPos
    : needsRelative
      ? "relative"
      : undefined;

  // Optional brightness veil (white >0 / black <0) — a cross-browser layer over
  // the refraction, under the children. Default 0 = nothing rendered.
  const brightnessLayer =
    merged.brightness !== 0 ? (
      <div
        aria-hidden
        data-lg-layer=""
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          borderRadius: "inherit",
          background: merged.brightness > 0 ? "#fff" : "#000",
          opacity: Math.min(1, Math.abs(merged.brightness)),
        }}
      />
    ) : null;

  return (
    <div
      ref={wrapRef}
      data-liquid-glass="material"
      className={className}
      style={{
        // Shrink-wrap the content by default (a button-sized pill, matching the
        // acceptance examples) yet still honour a className/style/Tailwind width:
        // an inline-block box sizes to its content but obeys an explicit width
        // (unlike `width: fit-content`, which an inline style would pin past a
        // className). `style` / the `width`/`height` props win over all of it.
        display: "inline-block",
        ...style,
        // Conditional so an `undefined` (className positions it) never strips the
        // user's own `style.position`.
        ...(position != null ? { position } : null),
        ...(explicitW != null ? { width: explicitW } : null),
        ...(explicitH != null ? { height: explicitH } : null),
        // Round the wrapper from the prop / adopted child radius (when the user
        // gave the box none); a className/style radius is left to the user's CSS.
        ...(box.appliedR != null ? { borderRadius: box.appliedR } : null),
      }}
      {...rest}
    >
      {brightnessLayer}
      {children}
      {/* Soft bright edge — its own inset layer, rounded to the wrapper. */}
      <div
        aria-hidden
        data-lg-layer=""
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          borderRadius: "inherit",
          boxShadow: edgeShadow,
        }}
      />
      {/* The displacement filter (Blink refraction). 0-size; defs only. */}
      <svg
        aria-hidden
        data-lg-layer=""
        width={0}
        height={0}
        style={{ position: "absolute", width: 0, height: 0 }}
      >
        <defs>
          <filter
            ref={filterRef}
            id={`lg-mat-${baseId}-v0`}
            filterUnits="userSpaceOnUse"
            primitiveUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
            x={-margin}
            y={-margin}
            width={box.w + 2 * margin}
            height={box.h + 2 * margin}
          >
            {sized && (
              <MaterialFilterContents
                dispScale={dispScale}
                dispersion={merged.dispersion}
                specular={merged.specular}
                hasSpecular={hasSpecular}
                mapMatrix={mapMatrix}
                width={box.w}
                height={box.h}
                mapUrl={mapUrlRef.current || ""}
                feImageRef={feImageRef}
              />
            )}
          </filter>
        </defs>
      </svg>
    </div>
  );
};
