import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Glass,
  type GlassOptics,
  type GlassAnimation,
  animateGlassValue,
  cubicBezier,
  deriveGlass,
  glassValue,
  GlassDiv,
  rubberBand,
  useLensWobble,
} from "@samasante/liquid-glass";

/**
 * A macOS-style glass switch, built entirely on the headless `<Glass>`
 * primitive and its opt-in motion utilities. Copy it into your app and restyle
 * it; it is not a package export.
 *
 * At rest it's a clean white pill on a grey/accent track. Pressing or dragging
 * the thumb dissolves the pill into a glass lens that refracts the track
 * through the displacement map — chroma at the edges, a moving specular
 * highlight, a velocity squash-and-stretch wobble, and a rubber-band overdrag.
 * It wraps a real `<input type="checkbox" role="switch">` for accessibility.
 */

// Motion signature: a distinct overshoot curve for grow/toggle and a separate
// clean ease-out for the collapse.
const EASE = cubicBezier(0.34, 1.36, 0.42, 1);
const SETTLE = cubicBezier(0.36, 0, 0.18, 1);
const THUMB_ANIM = { ease: EASE, duration: 0.52 };
const EXPAND_ANIM = { ease: EASE, duration: 0.26 };
const COLLAPSE_ANIM = { ease: SETTLE, duration: 0.46 };

export const SWITCH_BASE: Partial<GlassOptics> = {
  mapSize: 256,
  // depth/curvature are 0..1 fractions of the thumb's expanded half-extent (~16.5px):
  // a gentle depth keeps a refractive rim, not a magnifying body dome; the glassy
  // character is the rim refraction + specular + bloom (raise depth toward 1 for a
  // true body dome).
  depth: 0.2,
  dispersion: 0.65,
  strength: 0.19,
  clipToShape: true,
  softEdge: true,
  curvature: 0.3,
  splay: 0.6,
  bend: 0.1,
  bendWidth: 0.06,
  frost: 0,
  brightness: 0.05,
  specular: 1.2,
  sheenAngle: 45,
  sheenDark: false,
  glow: 0.05,
  glowSpread: 0.5,
  glowFalloff: 1.5,
  sheen: 0.45,
  sheenWidth: 2,
  sheenFalloff: 1.5,
  edgeShadow: "0 2px 6px rgba(0, 0, 0, 0.16)",
  edgeInsetShadow: "0 -4px 10px rgba(0, 0, 0, 0.12)",
  // Resting puck drop-shadow (the floating white thumb sits ABOVE the track) —
  // a tight contact shadow + a soft ambient one. Fades out as it expands into
  // the lens (which has its own `edgeShadow`).
  restEdgeShadow:
    "0 1px 3px rgba(0, 0, 0, 0.24), 0 4px 10px rgba(0, 0, 0, 0.14)",
};

const SWITCH_DARK: Partial<GlassOptics> = {
  brightness: 0.12,
  glow: 0.4,
  sheen: 0.5,
};

const SWITCH_LIGHT: Partial<GlassOptics> = {
  brightness: -0.02,
  sheenAngle: 30,
  specular: 1.5,
  glow: 0.4,
  glowSpread: 0.5,
  glowFalloff: 2,
  sheen: 1,
  sheenWidth: 1.5,
  sheenFalloff: 1,
};

const TRACK_BACKGROUND =
  "color-mix(in srgb, var(--glass-track), var(--glass-active) calc(var(--switch-progress, 0) * 100%))";

export interface GlassSwitchProps {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  value?: string;
  ariaLabel?: string;
  width?: number;
  height?: number;
  lens?: Partial<GlassOptics>;
  tintBlur?: number;
  rubberOvershoot?: number;
  rubberDampening?: number;
  /** Supersample factor for the lens filter (2 = crisp edges; Chromium-only). */
  filterResolution?: number;
  forceExpanded?: boolean;
  onLensMapChange?: (url: string | null) => void;
  /** Resolved colour scheme — picks the light/dark lens preset. */
  scheme?: "light" | "dark";
  /** Track colour at rest. Must be opaque. */
  trackColor?: string;
  /** Track colour when on. */
  activeColor?: string;
  /** Background colour the lens refracts against. */
  surface?: string;
}

export const GlassSwitch: React.FC<GlassSwitchProps> = ({
  checked,
  onCheckedChange,
  disabled,
  name,
  value,
  ariaLabel,
  width: S = 74,
  height: R = 28,
  lens,
  tintBlur,
  rubberOvershoot = 0.15,
  rubberDampening = 10,
  filterResolution = 2,
  forceExpanded = false,
  onLensMapChange,
  scheme = "light",
  trackColor,
  activeColor,
  surface,
}) => {
  const isDark = scheme === "dark";

  // Geometry.
  const thumbW = Math.round(0.6 * S);
  const thumbH = R - 6;
  const travel = S - thumbW - 6;
  const rubberLimit = S * rubberOvershoot;
  const rubberRange = rubberLimit * rubberDampening;
  const rootRadius = R / 2;
  const restRadius = thumbH / 2;
  const restHalfW = thumbW / 2;
  const restHalfH = thumbH / 2;
  const refractionTrackH = Math.round(0.75 * R);
  const pad = Math.ceil(0.5 * Math.max(restHalfW, restHalfH) + rubberLimit) + 2;
  const fullW = S + 2 * pad;
  const fullH = R + 2 * pad;

  // Mirror live geometry into refs so the `mv` getters and motion callbacks
  // (created once) always read fresh values without re-subscribing.
  const travelRef = useRef(travel);
  const thumbWRef = useRef(thumbW);
  const fullWRef = useRef(fullW);
  const padRef = useRef(pad);
  const restHalfWRef = useRef(restHalfW);
  const restHalfHRef = useRef(restHalfH);
  const restRadiusRef = useRef(restRadius);
  const tintBlurRef = useRef(tintBlur ?? 0);
  useLayoutEffect(() => {
    travelRef.current = travel;
    thumbWRef.current = thumbW;
    fullWRef.current = fullW;
    padRef.current = pad;
    restHalfWRef.current = restHalfW;
    restHalfHRef.current = restHalfH;
    restRadiusRef.current = restRadius;
    tintBlurRef.current = tintBlur ?? 0;
  });

  // Live motion values.
  const mv = useMemo(() => {
    const thumbX = glassValue(checked ? travelRef.current : 0);
    const lensX = deriveGlass(
      [thumbX],
      () =>
        (padRef.current + 3 + thumbWRef.current / 2 + thumbX.get()) /
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
    // Resting puck shadow is the inverse of the expanded-lens shadow: visible at
    // rest, fades out as the thumb blooms into the lens.
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
    // edgeBias insets the lens subregion to hide edge-sampling fringe on the small
    // puck: 0.5px at rest, ramping to 0 as it blooms (tintOpacity 1→0) and the glass
    // takes over. The slider needs none of this — it rides the <Glass> default 0.5.
    const edgeBias = deriveGlass([tintOpacity], () => 0.5 * tintOpacity.get());
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
      edgeBias,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Tap-vs-drag interaction state machine (a press becomes a tap if released
  // quickly, or a hold/drag past the hold timeout).
  const stateRef = useRef<"idle" | "pending" | "hold" | "tap">("idle");
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const collapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const mountedRef = useRef(true);
  const [dragging, setDragging] = useState(false);
  const suppressRef = useRef(false);
  const wrapperRef = useRef<HTMLLabelElement>(null);
  const hitAreaRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startClientXRef = useRef(0);
  const startThumbXRef = useRef(0);
  const movedRef = useRef(false);
  const thumbAnimRef = useRef<GlassAnimation | null>(null);

  useEffect(
    () => () => {
      mountedRef.current = false;
      clearTimeout(holdTimeoutRef.current);
      clearTimeout(collapseTimeoutRef.current);
      if (pointerIdRef.current !== null && hitAreaRef.current) {
        try {
          hitAreaRef.current.releasePointerCapture(pointerIdRef.current);
        } catch {
          // already released
        }
        pointerIdRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (dragging || stateRef.current === "tap") return;
    thumbAnimRef.current = animateGlassValue(
      mv.thumbX,
      checked ? travel : 0,
      THUMB_ANIM,
    );
  }, [checked, dragging, mv.thumbX, travel]);

  // Authoritative writer for --switch-progress (track colour crossfade). The
  // inline style intentionally does NOT set it — a React re-render would
  // clobber the animated value mid-transition. useLayoutEffect sets it before
  // first paint; TRACK_BACKGROUND has a `, 0` fallback for the pre-mount frame.
  useLayoutEffect(() => {
    const apply = (x: number) => {
      const t = travelRef.current;
      wrapperRef.current?.style.setProperty(
        "--switch-progress",
        String(t > 0 ? Math.max(0, Math.min(1, x / t)) : 0),
      );
    };
    apply(mv.thumbX.get());
    return mv.thumbX.on("change", apply);
  }, [mv.thumbX]);

  const mergedLens = useMemo(
    () => ({
      ...SWITCH_BASE,
      ...(isDark ? SWITCH_DARK : SWITCH_LIGHT),
      ...lens,
      sheenDark: !isDark,
    }),
    [isDark, lens],
  );

  const handleChange = (next: boolean) => {
    if (suppressRef.current) return;
    onCheckedChange?.(next);
    if (stateRef.current === "idle") {
      stateRef.current = "tap";
      expand(EXPAND_ANIM);
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = setTimeout(() => {
        collapse(COLLAPSE_ANIM);
      }, 290);
      thumbAnimRef.current = animateGlassValue(mv.thumbX, next ? travel : 0, {
        ...THUMB_ANIM,
        onComplete: () => {
          if (mountedRef.current && stateRef.current === "tap") {
            stateRef.current = "idle";
          }
        },
      });
    }
  };

  const surfaceColor = surface ?? (isDark ? "#1f1f24" : "#ffffff");
  const track = trackColor ?? (isDark ? "#2a2828" : "#e1dfdf");
  const active = activeColor ?? "#0a84ff";

  return (
    <label
      ref={wrapperRef}
      className="mac-glass-control"
      style={
        {
          flexShrink: 0,
          width: S,
          height: R,
          overflow: "visible",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : undefined,
          borderRadius: 999,
          display: "block",
          position: "relative",
          "--glass-track": track,
          "--glass-active": active,
        } as React.CSSProperties
      }
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked ?? false}
        onChange={(e) => handleChange(e.target.checked)}
        onClick={(e) => {
          if (suppressRef.current) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleChange(!checked);
          }
        }}
        disabled={disabled}
        name={name}
        value={value}
        aria-label={ariaLabel}
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
          edgeBias: mv.edgeBias,
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
              height: R,
              display: "flex",
              alignItems: "center",
              boxSizing: "content-box",
            }}
          >
            <GlassDiv
              scaleX={mv.trackScaleX}
              scaleY={mv.trackScaleY}
              style={{
                width: S,
                height: refractionTrackH,
                borderRadius: refractionTrackH / 2,
                background: TRACK_BACKGROUND,
              }}
            />
          </div>
        }
      >
        <div style={{ padding: pad }}>
          <div
            aria-hidden
            style={{
              width: S,
              height: R,
              borderRadius: rootRadius,
              background: TRACK_BACKGROUND,
              display: "block",
              position: "relative",
              overflow: "visible",
            }}
          >
            <GlassDiv
              ref={hitAreaRef}
              x={mv.thumbX}
              style={{
                position: "absolute",
                willChange: "transform",
                userSelect: "none",
                WebkitUserSelect: "none",
                width: thumbW,
                height: thumbH,
                top: 3,
                left: 3,
                touchAction: "none",
              }}
              onPointerDown={(e) => {
                if (pointerIdRef.current !== null || disabled) return;
                pointerIdRef.current = e.pointerId;
                e.currentTarget.setPointerCapture(e.pointerId);
                startClientXRef.current = e.clientX;
                startThumbXRef.current = mv.thumbX.get();
                movedRef.current = false;
                setDragging(true);
                suppressRef.current = true;
                clearTimeout(holdTimeoutRef.current);
                clearTimeout(collapseTimeoutRef.current);
                stateRef.current = "pending";
                holdTimeoutRef.current = setTimeout(() => {
                  if (stateRef.current === "pending") {
                    stateRef.current = "hold";
                    thumbAnimRef.current?.stop();
                    expand(EXPAND_ANIM);
                    holdRef.current = 0.175;
                    kickWobbleRef.current();
                  }
                }, 170);
              }}
              onPointerMove={(e) => {
                if (e.pointerId !== pointerIdRef.current) return;
                const delta = e.clientX - startClientXRef.current;
                if (!movedRef.current) {
                  if (Math.abs(delta) < 3) return;
                  movedRef.current = true;
                  thumbAnimRef.current?.stop();
                  startThumbXRef.current = mv.thumbX.get();
                  startClientXRef.current = e.clientX;
                  clearTimeout(holdTimeoutRef.current);
                  holdRef.current = 0;
                  if (stateRef.current !== "hold") {
                    stateRef.current = "hold";
                    expand(EXPAND_ANIM);
                  }
                }
                let next =
                  startThumbXRef.current +
                  (e.clientX - startClientXRef.current);
                if (next < 0) {
                  next = -rubberBand(-next, rubberLimit, rubberRange);
                } else if (next > travel) {
                  next =
                    travel +
                    rubberBand(next - travel, rubberLimit, rubberRange);
                }
                mv.thumbX.set(next);
              }}
              onPointerUp={(e) => {
                if (e.pointerId !== pointerIdRef.current) return;
                pointerIdRef.current = null;
                clearTimeout(holdTimeoutRef.current);
                if (movedRef.current) {
                  setDragging(false);
                  stateRef.current = "idle";
                  collapse(COLLAPSE_ANIM);
                  const next =
                    Math.max(0, Math.min(travel, mv.thumbX.get())) > travel / 2;
                  thumbAnimRef.current = animateGlassValue(
                    mv.thumbX,
                    next ? travel : 0,
                    THUMB_ANIM,
                  );
                  if (next !== checked) onCheckedChange?.(next);
                  requestAnimationFrame(() => {
                    suppressRef.current = false;
                  });
                } else if (
                  stateRef.current === "pending" ||
                  stateRef.current === "tap"
                ) {
                  stateRef.current = "tap";
                  suppressRef.current = false;
                  setDragging(false);
                  expand(EXPAND_ANIM);
                  clearTimeout(collapseTimeoutRef.current);
                  collapseTimeoutRef.current = setTimeout(() => {
                    collapse(COLLAPSE_ANIM);
                  }, 290);
                  // The released click bubbles to the label and toggles the
                  // input — onCheckedChange fires through handleChange.
                  const target = checked ? 0 : travel;
                  thumbAnimRef.current = animateGlassValue(mv.thumbX, target, {
                    ...THUMB_ANIM,
                    onComplete: () => {
                      if (mountedRef.current && stateRef.current === "tap") {
                        stateRef.current = "idle";
                      }
                    },
                  });
                } else if (stateRef.current === "hold") {
                  stateRef.current = "idle";
                  setDragging(false);
                  holdRef.current = 0;
                  collapse(COLLAPSE_ANIM);
                  thumbAnimRef.current = animateGlassValue(
                    mv.thumbX,
                    checked ? travel : 0,
                    THUMB_ANIM,
                  );
                  requestAnimationFrame(() => {
                    suppressRef.current = false;
                  });
                } else {
                  setDragging(false);
                  suppressRef.current = false;
                }
              }}
              onPointerCancel={(e) => {
                if (e.pointerId !== pointerIdRef.current) return;
                pointerIdRef.current = null;
                clearTimeout(holdTimeoutRef.current);
                holdRef.current = 0;
                setDragging(false);
                stateRef.current = "idle";
                collapse(COLLAPSE_ANIM);
                thumbAnimRef.current = animateGlassValue(
                  mv.thumbX,
                  checked ? travel : 0,
                  THUMB_ANIM,
                );
                requestAnimationFrame(() => {
                  suppressRef.current = false;
                });
              }}
              onDragStart={(e) => e.preventDefault()}
            />
          </div>
        </div>
      </Glass>
    </label>
  );
};
