import React, { useRef, useState } from "react";
import { GlassSlider } from "../../../examples/GlassSlider";
import type { GlassOptics } from "@samasante/liquid-glass";

/** A full lens config: the public optics look bag plus the demo's editable
 *  geometry. The public API keeps look (optics) and geometry separate; this
 *  panel happens to edit both, so it composes them here. */
export type GlassConfig = Partial<GlassOptics> & {
  lensW: number;
  lensH: number;
  borderRadius: number;
};

/**
 * The lens controls, built from the library's own glass slider and presented as
 * a draggable, frosted macOS "Settings" window. Dogfoods the package: the thing
 * tuning the glass is glass.
 */

const sans =
  "-apple-system, 'SF Pro Text', ui-sans-serif, system-ui, sans-serif";
const mono = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";
const ACCENT = "#0a84ff";

type F = {
  key: keyof GlassConfig;
  label: string;
  min: number;
  // `max` may scale with the current config (px quantities track the lens size).
  max: number | ((c: GlassConfig) => number);
  step: number;
  // Optional fan-out: one slider can drive several GRANULAR engine params (the
  // API stays granular; the demo panel just presents a simpler view). e.g. the
  // single "Width" knob sets both the meniscus band and the highlight band.
  derive?: (v: number) => Partial<GlassConfig>;
};
type Group = { title: string; fields: F[] };

// Lens GEOMETRY (the element's size) — its OWN menu, since it isn't part of the
// glass material: you set it to match your element, you don't "tune" it.
const LENS_GROUPS: Group[] = [
  {
    title: "Lens",
    fields: [
      { key: "lensW", label: "Width", min: 50, max: 200, step: 1 },
      { key: "lensH", label: "Height", min: 50, max: 200, step: 1 },
      // Radius is INDEPENDENT of Width/Height — a fixed range (the lensW/lensH
      // ceiling, enough for a full-round lens at any size) so dragging W/H never
      // moves the radius value. CSS/the SDF self-clamp the corner to half the
      // smaller side, so an over-large radius just reads as fully round, no artifact.
      { key: "borderRadius", label: "Radius", min: 0, max: 200, step: 1 },
    ],
  },
];

// The glass MATERIAL — the look, independent of size.
const GLASS_GROUPS: Group[] = [
  {
    // The bend through the BODY of the glass + the chromatic fringe it produces.
    title: "Refraction",
    fields: [
      { key: "strength", label: "Strength", min: 0, max: 0.3, step: 0.01 },
      // depth is a 0..1 fraction — how far the bend reaches in. Low = a thin rim;
      // near 1 = the refraction fills the whole shape (un-gates the dome).
      { key: "depth", label: "Depth", min: 0, max: 1, step: 0.05 },
      // curvature is a 0..1 fraction — the convex dome (centre magnification).
      { key: "curvature", label: "Curvature", min: 0, max: 1, step: 0.05 },
      { key: "dispersion", label: "Dispersion", min: 0, max: 2, step: 0.05 },
    ],
  },
  {
    // The extra refraction concentrated at the rim (the "liquid" lip) + its reach.
    // "Bend" rather than "Refraction" so it doesn't echo the Refraction group.
    title: "Edge",
    fields: [
      { key: "bend", label: "Bend", min: 0, max: 1, step: 0.05 },
      { key: "bendWidth", label: "Width", min: 0.04, max: 0.3, step: 0.01 },
    ],
  },
  {
    // The bright rim highlight (specular), steered by Angle.
    title: "Sheen",
    fields: [
      { key: "sheen", label: "Intensity", min: 0, max: 2, step: 0.05 },
      { key: "sheenWidth", label: "Thickness", min: 1, max: 10, step: 0.5 },
      { key: "specular", label: "Specular", min: 0, max: 2.5, step: 0.05 },
      { key: "sheenAngle", label: "Angle", min: 0, max: 180, step: 5 },
    ],
  },
  {
    // The soft, full-surface treatment: inner glow, backdrop frost, brightness veil.
    title: "Background",
    fields: [
      { key: "glow", label: "Glow", min: 0, max: 1, step: 0.05 },
      // Frost is a gaussian-blur pass over the whole in-place stage every frame
      // the lens moves; a very high value gets heavy, so it's eased back from 25.
      { key: "frost", label: "Frost", min: 0, max: 12, step: 0.5 },
      // Brightness caps at 0.7 — a full white veil (1) blows the glass out and
      // reads flat/milky rather than like bright glass.
      { key: "brightness", label: "Brightness", min: 0, max: 0.7, step: 0.05 },
    ],
  },
];

const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 3 : 1);
const rand = (min: number, max: number, step: number) => {
  const n = Math.round((min + Math.random() * (max - min)) / step) * step;
  return Number(n.toFixed(4));
};
const pressDown = (e: React.PointerEvent) => {
  (e.currentTarget as HTMLElement).style.transform = "scale(0.95)";
};
const pressUp = (e: React.PointerEvent) => {
  (e.currentTarget as HTMLElement).style.transform = "scale(1)";
};
const press = {
  onPointerDown: pressDown,
  onPointerUp: pressUp,
  onPointerLeave: pressUp,
};

export const GlassControlPanel: React.FC<{
  value: GlassConfig;
  onChange: (next: GlassConfig) => void;
  onShuffle: () => void;
  onReset: () => void;
  dirty?: boolean;
  dark?: boolean;
  /** Which menu to render. `"glass"` (default) = the glass MATERIAL (Refraction /
   *  Edge / Sheen / Background) + Shuffle/Reset. `"lens"` = just the lens GEOMETRY
   *  (Width/Height/Radius) — its own small window, since size isn't part of the
   *  glass material. */
  section?: "glass" | "lens";
  /** Which side to dock the window on initially. @default "right" */
  align?: "left" | "right";
  /** Render as plain in-flow content (no fixed window / drag bar / own frost) so
   *  it can sit inside another container — the mobile bottom sheet. @default false */
  embedded?: boolean;
  /** Slider track width in px. @default 264 (the 300px window's inner width) */
  sliderWidth?: number;
}> = ({
  value,
  onChange,
  onShuffle,
  onReset,
  dirty,
  dark = true,
  section = "glass",
  align = "right",
  embedded = false,
  sliderWidth = 264,
}) => {
  const isLens = section === "lens";
  const groups = isLens ? LENS_GROUPS : GLASS_GROUPS;
  const [pos, setPos] = useState(() => ({
    x:
      typeof window !== "undefined"
        ? align === "left"
          ? 24
          : window.innerWidth - 324
        : 600,
    y: 84,
  }));
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  // A proper frosted-window palette for each scheme (light gets a lighter,
  // softer-shadow treatment — the dark drop-shadow looked heavy on a light page).
  const p = dark
    ? {
        bg: "rgba(26,26,30,0.55)",
        border: "rgba(255,255,255,0.16)",
        shadow:
          "0 40px 90px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.2)",
        titleBorder: "rgba(255,255,255,0.08)",
        title: "rgba(255,255,255,0.62)",
        groupTitle: "rgba(255,255,255,0.36)",
        label: "rgba(255,255,255,0.72)",
        value: "#fff",
        btnBorder: "rgba(255,255,255,0.16)",
        btnBg: "rgba(255,255,255,0.08)",
        btnText: "#fff",
        resetOn: "rgba(255,255,255,0.82)",
        resetOff: "rgba(255,255,255,0.34)",
        surface: "#15151a",
        track: "#48484e",
        scheme: "dark" as const,
      }
    : {
        bg: "rgba(252,252,254,0.72)",
        border: "rgba(0,0,0,0.1)",
        shadow:
          "0 18px 44px rgba(20,22,40,0.16), inset 0 1px 0 rgba(255,255,255,0.8)",
        titleBorder: "rgba(0,0,0,0.08)",
        title: "rgba(0,0,0,0.6)",
        groupTitle: "rgba(0,0,0,0.42)",
        label: "rgba(0,0,0,0.7)",
        value: "#0a0b0d",
        btnBorder: "rgba(0,0,0,0.12)",
        btnBg: "rgba(0,0,0,0.05)",
        btnText: "#0a0b0d",
        resetOn: "rgba(0,0,0,0.72)",
        resetOff: "rgba(0,0,0,0.3)",
        surface: "#f1f1f5",
        track: "#cdced6",
        scheme: "light" as const,
      };

  // Apply a slider, fanning out to the granular engine params it drives
  // (e.g. some sliders fan out to several granular engine params).
  const set = (f: F, v: number) => {
    // Each knob is independent — notably, Radius is NOT coupled to Width/Height
    // (dragging W/H used to clamp the radius value, which read as the radius
    // "jumping" on its own). The radius slider has its own fixed range instead.
    const next = { ...value, [f.key]: v, ...(f.derive ? f.derive(v) : null) };
    onChange(next);
  };

  return (
    <aside
      data-no-cannon
      data-park
      style={
        embedded
          ? {
              // In-flow inside the mobile sheet — the sheet supplies the frost.
              display: "flex",
              flexDirection: "column",
              fontFamily: sans,
            }
          : {
              position: "fixed",
              left: pos.x,
              top: pos.y,
              width: 300,
              maxHeight: "calc(100vh - 120px)",
              zIndex: 60,
              display: "flex",
              flexDirection: "column",
              borderRadius: 16,
              overflow: "hidden",
              fontFamily: sans,
              background: p.bg,
              backdropFilter: "blur(34px) saturate(180%)",
              WebkitBackdropFilter: "blur(34px) saturate(180%)",
              border: `0.5px solid ${p.border}`,
              boxShadow: p.shadow,
            }
      }
    >
      {/* draggable title bar — traffic lights + title (window mode only) */}
      {!embedded && (
      <div
        onPointerDown={(e) => {
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos({
            x: Math.max(8, e.clientX - drag.current.dx),
            y: Math.max(8, e.clientY - drag.current.dy),
          });
        }}
        onPointerUp={(e) => {
          drag.current = null;
          (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "12px 14px",
          borderBottom: `0.5px solid ${p.titleBorder}`,
          cursor: "grab",
          touchAction: "none",
        }}
      >
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            background: "#ff5f57",
          }}
        />
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            background: "#febc2e",
          }}
        />
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            background: "#28c840",
          }}
        />
        <span
          style={{
            marginLeft: 8,
            fontSize: 13,
            fontWeight: 600,
            color: p.title,
          }}
        >
          {isLens ? "Lens" : "Settings"}
        </span>
      </div>
      )}

      <div
        style={{
          overflowY: embedded ? "visible" : "auto",
          padding: embedded ? "2px 2px 4px" : "14px 18px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {groups.map((group) => (
          <div
            key={group.title}
            style={{ display: "flex", flexDirection: "column", gap: 13 }}
          >
            <div
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: p.groupTitle,
              }}
            >
              {group.title}
            </div>
            {group.fields.map((f) => {
              const v = (value[f.key] as number) ?? 0;
              return (
                <div
                  key={String(f.key)}
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12.5,
                    }}
                  >
                    <span style={{ color: p.label }}>{f.label}</span>
                    <span
                      style={{
                        fontFamily: mono,
                        color: p.value,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {fmt(v)}
                    </span>
                  </div>
                  <GlassSlider
                    value={v}
                    onValueChange={(nv) => set(f, nv)}
                    min={f.min}
                    max={typeof f.max === "function" ? f.max(value) : f.max}
                    step={f.step}
                    width={sliderWidth}
                    thumbHeight={20}
                    thumbWidth={30}
                    height={4}
                    tintBlur={3}
                    filterResolution={1}
                    scheme={p.scheme}
                    trackColor={p.track}
                    activeColor={ACCENT}
                    surface={p.surface}
                    ariaLabel={f.label}
                  />
                </div>
              );
            })}
          </div>
        ))}

        {/* Shuffle + Reset live in the menu body as rounded buttons (glass menu only). */}
        {!isLens && (
          <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
            <button
              onClick={onShuffle}
              {...press}
              style={{
                flex: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 11,
                border: `0.5px solid ${p.btnBorder}`,
                background: p.btnBg,
                cursor: "pointer",
                fontFamily: sans,
                fontSize: 13,
                fontWeight: 600,
                color: p.btnText,
                transition:
                  "transform 0.18s cubic-bezier(0.34,1.5,0.5,1), background 0.15s, opacity 0.15s",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
              </svg>
              Shuffle
            </button>
            <button
              onClick={onReset}
              disabled={!dirty}
              {...press}
              title="Reset to defaults"
              style={{
                flex: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                padding: "10px 14px",
                borderRadius: 11,
                border: `0.5px solid ${p.btnBorder}`,
                background: "transparent",
                cursor: dirty ? "pointer" : "default",
                fontFamily: sans,
                fontSize: 13,
                fontWeight: 600,
                color: dirty ? p.resetOn : p.resetOff,
                opacity: dirty ? 1 : 0.6,
                transition:
                  "transform 0.18s cubic-bezier(0.34,1.5,0.5,1), color 0.15s, opacity 0.15s",
              }}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              Reset
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};

/** Lens GEOMETRY keys — the element's size, set in the separate "Lens" menu.
 *  Shuffle/Reset (in the glass "Settings" panel) deliberately leave these alone. */
export const LENS_KEYS = ["lensW", "lensH", "borderRadius"] as const;

/** Randomise the glass MATERIAL knobs only — refraction (strength, depth,
 *  curvature, dispersion), the edge (bend + width), the specular (intensity, angle,
 *  thickness) and the surface (glow, frost, brightness). The lens SIZE is left
 *  untouched (it lives in its own menu, not the glass material). */
export const shuffleParams = (base: GlassConfig): GlassConfig => {
  const s = rand(0.04, 0.13, 0.01);
  return {
    ...base,
    strength: s,
    depth: rand(0.35, 1, 0.05),
    curvature: rand(0, 0.7, 0.05),
    dispersion: rand(0.3, 1.6, 0.05),
    bend: rand(0, 0.9, 0.05),
    bendWidth: rand(0.1, 0.24, 0.01),
    sheen: rand(0.4, 1.4, 0.05),
    sheenWidth: rand(2, 8, 0.5),
    sheenAngle: rand(0, 180, 5),
    glow: rand(0, 0.5, 0.05),
    frost: rand(0, 4, 0.5),
    brightness: rand(0, 0.2, 0.05),
  };
};
