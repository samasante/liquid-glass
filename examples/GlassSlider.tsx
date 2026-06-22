import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Glass,
  type GlassOptics,
  animateGlassValue,
  cubicBezier,
  deriveGlass,
  glassValue,
  GlassDiv,
  rubberBand,
  useLensWobble,
} from "@samasante/liquid-glass";

/**
 * A macOS-style glass range slider, built entirely on the headless
 * `<Glass>` primitive and its opt-in motion utilities. Copy it into your app
 * and restyle it; it is not a package export.
 *
 * At rest the thumb is a white pill; dragging dissolves it into a glass lens
 * that bends the accent fill through it, with chroma, a specular highlight, and
 * the same squash-stretch wobble + rubber-band overdrag as the switch. It wraps
 * a real `<input type="range">` for accessibility.
 */

// Motion signature — distinct overshoot + ease-out timings (same as the switch).
const EXPAND_ANIM = { ease: cubicBezier(0.34, 1.36, 0.42, 1), duration: 0.27 };
const COLLAPSE_ANIM = { ease: cubicBezier(0.36, 0, 0.18, 1), duration: 0.46 };

export const SLIDER_BASE: Partial<GlassOptics> = {
  mapSize: 256,
  // depth/curvature are 0..1 fractions of the thumb's expanded half-extent (~16.5px):
  // depth ≈ 0.12 is a ~1.3–2px refractive rim; curvature ≈ 0.30 shapes the rim BEND
  // (strongest on the short vertical axis). At this depth the thumb body stays
  // near-neutral, so the bleed is the two-tone track (blue fill / grey track) showing
  // through a glassy-rimmed thumb — NOT a magnifying body dome. Per-axis scaleX/scaleY
  // (vs the switch's single `strength`): a wide thumb over a thin horizontal track
  // wants more vertical than horizontal bend (Safari more still — see SLIDER_SAFARI).
  depth: 0.2,
  dispersion: 0.5,
  scaleX: 0.06,
  scaleY: 0.06,
  clipToShape: true,
  softEdge: true,
  curvature: 0.55,
  splay: 0.5,
  bend: 0.1,
  bendWidth: 0.05,
  frost: 0,
  brightness: 0.06,
  specular: 1.5,
  sheenAngle: 45,
  sheenDark: false,
  glow: 0.4,
  glowSpread: 0.5,
  glowFalloff: 1.5,
  sheen: 0,
  sheenWidth: 3,
  sheenFalloff: 1.5,
  edgeShadow: "0 2px 6px rgba(0, 0, 0, 0.16)",
  edgeInsetShadow: "0 -4px 10px rgba(0, 0, 0, 0.12)",
  // restEdgeShadow (the floating resting-puck shadow, fades out as the thumb
  // blooms) is themed per scheme — see SLIDER_DARK / SLIDER_LIGHT below.
};

const SLIDER_DARK: Partial<GlassOptics> = {
  restEdgeShadow: "0 1.333px 5.333px rgba(0, 0, 0, 0.5)",
  scaleX: 0.133,
  scaleY: 0.135,
  brightness: 0.12,
  sheenAngle: 45,
  glowFalloff: 1.5,
  sheen: 0.5,
  sheenWidth: 1,
  sheenFalloff: 1.5,
};

const SLIDER_LIGHT: Partial<GlassOptics> = {
  restEdgeShadow: "0 1.333px 5.333px rgba(46, 15, 15, 0.12)",
  scaleX: 0.1,
  scaleY: 0.1,
  brightness: -0.02,
  sheenAngle: 30,
  glowFalloff: 2,
  sheen: 1,
  sheenWidth: 1,
  sheenFalloff: 1,
};

// Safari needs more vertical displacement than Chromium.
const SLIDER_SAFARI: Partial<GlassOptics> = { scaleY: 0.25 };

const useIsSafari = () => {
  const [safari, setSafari] = useState(false);
  useEffect(() => {
    setSafari(
      typeof navigator !== "undefined" &&
        /^((?!chrome|chromium|android).)*safari/i.test(navigator.userAgent),
    );
  }, []);
  return safari;
};

export interface GlassSliderProps {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Full control width. */
  width?: number;
  /** Thumb (lens) height; the control is this tall. */
  thumbHeight?: number;
  thumbWidth?: number;
  /** Visible track height. */
  height?: number;
  rubberOvershoot?: number;
  rubberDampening?: number;
  /** Height of the refraction copy of the track (default 0.75 × thumbHeight). */
  refractionTrackHeight?: number;
  lens?: Partial<GlassOptics>;
  tintBlur?: number;
  /** Supersample factor for the lens filter (2 = crisp edges; Chromium-only). */
  filterResolution?: number;
  name?: string;
  ariaLabel?: string;
  forceExpanded?: boolean;
  onLensMapChange?: (url: string | null) => void;
  /** Resolved colour scheme — picks the light/dark lens preset. */
  scheme?: "light" | "dark";
  /** Track colour. Must be opaque. */
  trackColor?: string;
  /** Fill colour. */
  activeColor?: string;
  /** Background colour the lens refracts against. */
  surface?: string;
}

export const GlassSlider: React.FC<GlassSliderProps> = ({
  value,
  defaultValue = 50,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  width: trackW = 240,
  thumbHeight: thumbH = 22,
  thumbWidth,
  height: trackH = 6,
  rubberOvershoot = 0.05,
  rubberDampening = 30,
  refractionTrackHeight,
  lens,
  tintBlur,
  filterResolution = 2,
  name,
  ariaLabel,
  forceExpanded = false,
  onLensMapChange,
  scheme = "light",
  trackColor,
  activeColor,
  surface,
}) => {
  const isDark = scheme === "dark";
  const isSafari = useIsSafari();
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const currentValue = isControlled ? value : internalValue;

  const commit = useCallback(
    (raw: number) => {
      const snapped =
        step > 0 ? Math.round((raw - min) / step) * step + min : raw;
      const clamped = Math.max(min, Math.min(max, snapped));
      if (!isControlled) setInternalValue(clamped);
      onValueChange?.(clamped);
    },
    [min, max, step, isControlled, onValueChange],
  );

  // Geometry.
  const thumbW = thumbWidth ?? Math.round(2 * thumbH);
  const travel = trackW - thumbW;
  const restHalfW = thumbW / 2;
  const restHalfH = thumbH / 2;
  const restRadius = thumbH / 2;
  const trackRadius = trackH / 2;
  const rubberLimit = trackW * rubberOvershoot;
  const rubberRange = rubberLimit * rubberDampening;
  // Refraction-band height: 0.75 × thumbH.
  const refractionTrackH = refractionTrackHeight ?? Math.round(0.75 * thumbH);
  const pad = Math.ceil(0.5 * Math.max(restHalfW, restHalfH) + rubberLimit) + 2;
  const fullW = trackW + 2 * pad;
  const fullH = thumbH + 2 * pad;

  const travelRef = useRef(travel);
  const thumbWRef = useRef(thumbW);
  const fullWRef = useRef(fullW);
  const padRef = useRef(pad);
  const restHalfWRef = useRef(restHalfW);
  const restHalfHRef = useRef(restHalfH);
  const restRadiusRef = useRef(restRadius);
  const draggingRef = useRef(false);
  const startClientXRef = useRef(0);
  const startThumbXRef = useRef(0);
  const rubberLimitRef = useRef(rubberLimit);
  const rubberRangeRef = useRef(rubberRange);
  const tintBlurRef = useRef(tintBlur ?? 0);
  useLayoutEffect(() => {
    travelRef.current = travel;
    thumbWRef.current = thumbW;
    fullWRef.current = fullW;
    padRef.current = pad;
    restHalfWRef.current = restHalfW;
    restHalfHRef.current = restHalfH;
    restRadiusRef.current = restRadius;
    rubberLimitRef.current = rubberLimit;
    rubberRangeRef.current = rubberRange;
    tintBlurRef.current = tintBlur ?? 0;
  });

  const valueToX = useCallback(
    (v: number) => (max > min ? ((v - min) / (max - min)) * travel : 0),
    [min, max, travel],
  );
  const xToValue = useCallback(
    (x: number) => {
      const clamped = Math.max(0, Math.min(travel, x));
      const raw = travel > 0 ? min + (clamped / travel) * (max - min) : min;
      return step > 0 ? Math.round((raw - min) / step) * step + min : raw;
    },
    [min, max, travel, step],
  );

  // Mount-only snapshots: `mv` initializes thumbX once from these, so they
  // capture the value/mapping at first render and are never re-read after.
  const valueToXRef = useRef(valueToX);
  const initialValueRef = useRef(currentValue);

  const mv = useMemo(() => {
    const thumbX = glassValue(valueToXRef.current(initialValueRef.current));
    const lensX = deriveGlass(
      [thumbX],
      () =>
        (padRef.current + thumbWRef.current / 2 + thumbX.get()) /
        fullWRef.current,
    );
    const halfW = glassValue(restHalfWRef.current);
    const halfH = glassValue(restHalfHRef.current);
    const radius = glassValue(restRadiusRef.current);
    const tintOpacity = glassValue(1);
    const trackScaleX = glassValue(0.85);
    const trackScaleY = glassValue(0.525);
    const blur = glassValue(tintBlurRef.current);
    const shadowOpacity = glassValue(0);
    const restShadowOpacity = deriveGlass(
      [shadowOpacity],
      () => 1 - shadowOpacity.get(),
    );
    const stretch = glassValue(0);
    // `* 2`: the public <Glass> takes FULL-px size, so emit the full extent here
    // (the internal half-math is unchanged; <Glass> halves it back).
    const lensW = deriveGlass(
      [halfW, stretch],
      () => halfW.get() * (1 - 0.2 * stretch.get()) * 2,
    );
    const lensH = deriveGlass(
      [halfH, stretch],
      () => halfH.get() * (1 + 0.4 * stretch.get()) * 2,
    );
    return {
      thumbX,
      lensX,
      halfW,
      halfH,
      radius,
      tintOpacity,
      trackScaleX,
      trackScaleY,
      blur,
      shadowOpacity,
      restShadowOpacity,
      stretch,
      lensW,
      lensH,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!draggingRef.current) {
      mv.halfW.set(restHalfW);
      mv.halfH.set(restHalfH);
      mv.radius.set(restRadius);
    }
  }, [restHalfW, restHalfH, restRadius, mv]);

  const holdRef = useRef(0);
  const kickWobbleRef = useRef<() => void>(() => {});
  useLensWobble(mv.thumbX, mv.stretch, holdRef, kickWobbleRef);

  const expand = (anim: typeof EXPAND_ANIM) => {
    animateGlassValue(mv.halfW, 1.5 * restHalfWRef.current, anim);
    animateGlassValue(mv.halfH, 1.5 * restHalfHRef.current, anim);
    animateGlassValue(mv.radius, 1.5 * restRadiusRef.current, anim);
    animateGlassValue(mv.tintOpacity, 0, anim);
    animateGlassValue(mv.blur, 0, anim);
    animateGlassValue(mv.trackScaleX, 0.95, anim);
    animateGlassValue(mv.trackScaleY, 0.975, anim);
    animateGlassValue(mv.shadowOpacity, 1, anim);
  };
  const collapse = (anim: typeof COLLAPSE_ANIM) => {
    animateGlassValue(mv.halfW, restHalfWRef.current, anim);
    animateGlassValue(mv.halfH, restHalfHRef.current, anim);
    animateGlassValue(mv.radius, restRadiusRef.current, anim);
    animateGlassValue(mv.tintOpacity, 1, anim);
    animateGlassValue(mv.blur, tintBlurRef.current, anim);
    animateGlassValue(mv.trackScaleX, 0.85, anim);
    animateGlassValue(mv.trackScaleY, 0.525, anim);
    animateGlassValue(mv.shadowOpacity, 0, anim);
  };

  // Init to `false` (not `forceExpanded`) so a mount with forceExpanded=true is
  // seen as a CHANGE and fires the expand animation, rather than starting silently
  // expanded.
  const forceExpandedRef = useRef(false);
  useEffect(() => {
    if (forceExpanded === forceExpandedRef.current) return;
    forceExpandedRef.current = forceExpanded;
    if (forceExpanded) {
      expand(EXPAND_ANIM);
      holdRef.current = 0.175;
      kickWobbleRef.current();
    } else {
      collapse(COLLAPSE_ANIM);
      holdRef.current = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceExpanded]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerIdRef = useRef<number | null>(null);

  // Release any captured pointer on unmount so a dragging teardown doesn't leak.
  useEffect(
    () => () => {
      if (pointerIdRef.current !== null && rootRef.current) {
        try {
          rootRef.current.releasePointerCapture(pointerIdRef.current);
        } catch {
          // already released
        }
        pointerIdRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!draggingRef.current) mv.thumbX.set(valueToX(currentValue));
  }, [currentValue, valueToX, mv.thumbX]);

  useEffect(() => {
    const apply = (x: number) => {
      const el = wrapperRef.current;
      if (!el) return;
      const fill = thumbWRef.current / 2 + x;
      const progress = travelRef.current > 0 ? x / travelRef.current : 0;
      el.style.setProperty("--slider-fill", `${fill}px`);
      el.style.setProperty(
        "--slider-progress",
        String(Math.max(0, Math.min(1, progress))),
      );
    };
    apply(mv.thumbX.get());
    return mv.thumbX.on("change", apply);
  }, [mv.thumbX]);

  const mergedLens = useMemo(() => {
    const themed = isDark ? SLIDER_DARK : SLIDER_LIGHT;
    return {
      ...SLIDER_BASE,
      ...themed,
      ...(isSafari ? SLIDER_SAFARI : null),
      ...lens,
      sheenDark: !isDark,
    };
  }, [isDark, isSafari, lens]);

  const surfaceColor = surface ?? (isDark ? "#1f1f24" : "#ffffff");
  const track = trackColor ?? (isDark ? "#2a2828" : "#e1dfdf");
  const active = activeColor ?? "#0a84ff";

  const endDrag = (e: React.PointerEvent) => {
    if (e.pointerId !== pointerIdRef.current) return;
    pointerIdRef.current = null;
    draggingRef.current = false;
    holdRef.current = 0;
    const settled = Math.max(0, Math.min(travelRef.current, mv.thumbX.get()));
    animateGlassValue(mv.thumbX, settled, COLLAPSE_ANIM);
    collapse(COLLAPSE_ANIM);
  };

  return (
    <div
      ref={wrapperRef}
      className="mac-glass-control"
      style={
        {
          flexShrink: 0,
          width: trackW,
          height: thumbH,
          overflow: "visible",
          borderRadius: 999,
          position: "relative",
          opacity: disabled ? 0.4 : undefined,
          cursor: disabled ? "not-allowed" : undefined,
          "--glass-track": track,
          "--glass-active": active,
        } as React.CSSProperties
      }
    >
      <Glass
        optics={mergedLens}
        center={{ x: mv.lensX, y: 0.5 }}
        size={[mv.lensW, mv.lensH]}
        radius={mv.radius}
        unstable_lens={{
          tintColor: "white",
          tintOpacity: mv.tintOpacity,
          tintBlur: mv.blur,
          shadowOpacity: mv.shadowOpacity,
          restShadowOpacity: mv.restShadowOpacity,
        }}
        filterResolution={filterResolution}
        onLensMapChange={onLensMapChange}
        behind={surfaceColor}
        style={{
          width: fullW,
          height: fullH,
          overflow: "visible",
          margin: -pad,
        }}
        refract={
          <div
            style={{
              padding: pad,
              height: thumbH,
              display: "flex",
              alignItems: "center",
              boxSizing: "content-box",
            }}
          >
            <GlassDiv
              scaleX={mv.trackScaleX}
              scaleY={mv.trackScaleY}
              style={{
                position: "relative",
                width: trackW,
                height: refractionTrackH,
                borderRadius: refractionTrackH / 2,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "var(--glass-track)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "var(--glass-active)",
                  borderRadius: "inherit",
                  transform:
                    "translateX(calc((var(--slider-progress, 0) - 1) * 100%))",
                }}
              />
            </GlassDiv>
          </div>
        }
      >
        <div style={{ padding: pad }}>
          <input
            ref={inputRef}
            type="range"
            min={min}
            max={max}
            step={step}
            value={currentValue}
            disabled={disabled}
            name={name}
            aria-label={ariaLabel}
            onChange={(e) => commit(Number(e.target.value))}
            style={{
              whiteSpace: "nowrap",
              clip: "rect(0 0 0 0)",
              clipPath: "inset(50%)",
              pointerEvents: "none",
              border: 0,
              width: 1,
              height: 1,
              margin: -1,
              padding: 0,
              position: "absolute",
              overflow: "hidden",
            }}
          />
          <div
            ref={rootRef}
            aria-hidden
            style={{
              width: trackW,
              height: thumbH,
              cursor: disabled ? "not-allowed" : "pointer",
              touchAction: "none",
              userSelect: "none",
              WebkitUserSelect: "none",
              alignItems: "center",
              display: "flex",
              position: "relative",
              overflow: "visible",
            }}
            onPointerDown={(e) => {
              if (disabled || pointerIdRef.current !== null) return;
              pointerIdRef.current = e.pointerId;
              e.currentTarget.setPointerCapture(e.pointerId);
              draggingRef.current = true;
              inputRef.current?.focus({ preventScroll: true });
              const rect = rootRef.current?.getBoundingClientRect();
              const raw = rect
                ? e.clientX - rect.left - thumbWRef.current / 2
                : 0;
              const x = Math.max(0, Math.min(travelRef.current, raw));
              mv.thumbX.set(x);
              commit(xToValue(x));
              startClientXRef.current = e.clientX;
              startThumbXRef.current = x;
              expand(EXPAND_ANIM);
              holdRef.current = 0.175;
              kickWobbleRef.current();
            }}
            onPointerMove={(e) => {
              if (e.pointerId !== pointerIdRef.current) return;
              let x =
                startThumbXRef.current + (e.clientX - startClientXRef.current);
              if (x < 0) {
                x = -rubberBand(
                  -x,
                  rubberLimitRef.current,
                  rubberRangeRef.current,
                );
              } else if (x > travelRef.current) {
                x =
                  travelRef.current +
                  rubberBand(
                    x - travelRef.current,
                    rubberLimitRef.current,
                    rubberRangeRef.current,
                  );
              }
              mv.thumbX.set(x);
              commit(xToValue(Math.max(0, Math.min(travelRef.current, x))));
            }}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDragStart={(e) => e.preventDefault()}
          >
            <div
              style={{
                width: "100%",
                position: "relative",
                overflow: "hidden",
                height: trackH,
                borderRadius: trackRadius,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "var(--glass-track)",
                  borderRadius: "inherit",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: "var(--slider-fill)",
                  background: "var(--glass-active)",
                  borderRadius: trackRadius,
                }}
              />
            </div>
            <GlassDiv
              x={mv.thumbX}
              style={{
                willChange: "transform",
                position: "absolute",
                top: 0,
                left: 0,
                width: thumbW,
                height: thumbH,
              }}
            />
          </div>
        </div>
      </Glass>
    </div>
  );
};
