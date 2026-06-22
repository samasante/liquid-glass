import React, { useLayoutEffect, useRef, useState } from "react";
import { Glass, type GlassOptics } from "@samasante/liquid-glass";

/**
 * A macOS-style notification, built as a real liquid-glass panel: the frosted
 * card REFRACTS the wallpaper behind it via `<Glass>` (not a flat
 * `backdrop-filter` blur). The notification content sits crisp on top as a
 * sibling overlay whose drop-shadow floats the card.
 *
 * Copy it into your app and restyle it; it is not a package export.
 *
 * It fills its container and centres the card, so wrap it in any sized, rounded
 * box. `<Glass refract>` refracts a copy of the wallpaper clipped to the card rect
 * (the "lens"); everything outside shows the wallpaper untouched.
 */

const sans =
  "-apple-system, 'SF Pro Text', ui-sans-serif, system-ui, sans-serif";

// Apple-style frost: a milky veil + a backdrop blur + a gentle rim bend (the
// "liquid" lip), NO bevel. The crisp panel edge is a CSS double-border on the card
// overlay (see boxShadow below), not the lens edge — which keeps it clean.
export const PANEL_LENS: Partial<GlassOptics> = {
  mapSize: 256,
  clipToShape: true,
  softEdge: true,
  depth: 1,
  curvature: 0.5,
  dispersion: 0.6,
  strength: 0.17,
  bend: 0.7,
  bendWidth: 0.12,
  // Light frost so the bend + chroma stay visible (a heavy blur washes the
  // refraction out), with a soft veil + sheen for the glassy edge. Legibility comes
  // from the card overlay's top-lit white gradient, not a heavy lens veil.
  frost: 3,
  brightness: 0.22,
  specular: 1.3,
  sheenAngle: 50,
  glow: 0.32,
  glowSpread: 1,
  glowFalloff: 1,
  sheen: 1.3,
  sheenWidth: 3,
};

// Dark text — the bright frosted glass (lens brightness veil) is the material;
// no flat CSS fill, so you see the refracted wallpaper through it (glassy).
const TEXT = "#1c1c1e";
const TEXT_DIM = "rgba(0,0,0,0.5)";
const TEXT_BODY = "rgba(0,0,0,0.74)";

// A stand-in wallpaper as a layered CSS gradient so the example has zero asset
// dependencies — pass your own `wallpaper` (any CSS `background` value, e.g.
// `url(/wallpaper.jpg) center/cover`).
const DEFAULT_WALLPAPER =
  "radial-gradient(120% 120% at 12% 18%, #ff9d4d 0%, transparent 46%)," +
  "radial-gradient(120% 120% at 82% 14%, #4dc3ff 0%, transparent 44%)," +
  "radial-gradient(130% 130% at 78% 88%, #ff5d8f 0%, transparent 50%)," +
  "radial-gradient(140% 140% at 22% 86%, #7a5cff 0%, transparent 52%)," +
  "linear-gradient(135deg, #b24bd8, #f0793b)";

const Wallpaper: React.FC<{ bg: string }> = ({ bg }) => (
  <div
    aria-hidden
    style={{
      position: "absolute",
      inset: 0,
      background: bg,
      backgroundSize: "cover",
      backgroundPosition: "center",
    }}
  />
);

// Card geometry (px), centred in the container. The lens is the card rect.
const PANEL_MAX_W = 420;
const PANEL_MARGIN_X = 48; // total horizontal breathing room inside the container
const PANEL_H = 84;
const PANEL_RADIUS = 20;

const useSize = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
};

export interface GlassNotificationProps {
  title?: string;
  time?: string;
  body?: string;
  /** Avatar initials, rendered in a gradient circle. */
  avatar?: string;
  /** Any CSS `background` value the glass refracts. */
  wallpaper?: string;
  /** Override the glass optics (merged over the built-in look). */
  lens?: Partial<GlassOptics>;
}

export const GlassNotification: React.FC<GlassNotificationProps> = ({
  title = "Priya Raman",
  time = "now",
  body = "Just landed — grabbing a cab. Save me a seat and order the usual?",
  avatar = "PR",
  wallpaper = DEFAULT_WALLPAPER,
  lens,
}) => {
  const [ref, { w, h }] = useSize();

  // Only the width is responsive; height/radius are fixed (see PANEL_* above).
  const panelW = Math.round(Math.min(w - PANEL_MARGIN_X, PANEL_MAX_W));
  const ready = w > 0 && h > 0 && panelW > 0;
  // The card is centred; the glass is sized + positioned + bordered at this box.
  const cardLeft = Math.round((w - panelW) / 2);
  const cardTop = Math.round((h - PANEL_H) / 2);

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontFamily: sans,
        userSelect: "none",
      }}
    >
      <Wallpaper bg={wallpaper} />
      {ready && (
        <>
          {/* The glass card: a real lens refracting a position-matched copy of the
              wallpaper. Placed directly (no clip-path wrapper) so the SVG filter
              renders cleanly. */}
          <Glass
            optics={{ ...PANEL_LENS, ...lens }}
            brightnessInFilter
            width={panelW}
            height={PANEL_H}
            radius={PANEL_RADIUS}
            refract={
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: -cardLeft,
                  top: -cardTop,
                  width: w,
                  height: h,
                  background: wallpaper,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
            }
            behind="#c8569f"
            style={{
              position: "absolute",
              left: cardLeft,
              top: cardTop,
              width: panelW,
              height: PANEL_H,
              borderRadius: PANEL_RADIUS,
            }}
          />
          {/* Card content + the panel edge — crisp, on top of the glass. Same box
              as the <Glass> beneath it; the border traces the frosted edge. */}
          <div
            style={{
              position: "absolute",
              left: cardLeft,
              top: cardTop,
              width: panelW,
              height: PANEL_H,
              borderRadius: PANEL_RADIUS,
              // A top-lit white gradient brightens the frosted glass (so it reads
              // light, not dark over a dark wallpaper) and gives it dimension —
              // the refraction still shows through the lower-opacity lower half.
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.16) 100%)",
              // Edge stack: a bright top sheen, a 1px white inner highlight, a soft
              // inner glow blooming in from the rim, the dark hairline, + float shadow.
              boxShadow:
                "inset 0 1px 0 rgba(255,255,255,0.95), inset 0 0 0 1px rgba(255,255,255,0.5), inset 0 0 24px rgba(255,255,255,0.55), 0 0 0 0.5px rgba(0,0,0,0.18), 0 14px 36px rgba(0,0,0,0.22), 0 2px 5px rgba(0,0,0,0.14)",
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "0 18px",
              boxSizing: "border-box",
              color: TEXT,
            }}
          >
            <div
              aria-hidden
              style={{
                flexShrink: 0,
                width: 40,
                height: 40,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                background: "linear-gradient(160deg, #2e9bff 0%, #0a6cff 100%)",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: 0.3,
                boxShadow: "inset 0 1px 1px rgba(255,255,255,0.4)",
              }}
            >
              {avatar}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 12,
                    color: TEXT_DIM,
                    whiteSpace: "nowrap",
                  }}
                >
                  {time}
                </span>
              </div>
              <div
                style={{
                  marginTop: 3,
                  fontSize: 13.5,
                  lineHeight: 1.35,
                  color: TEXT_BODY,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {body}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
