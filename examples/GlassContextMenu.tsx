import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Glass, type GlassOptics } from "@samasante/liquid-glass";

/**
 * A macOS-style context menu, built as a floating liquid-glass panel: the frosted
 * menu REFRACTS the wallpaper behind it via `<Glass>` (not a flat
 * `backdrop-filter` blur). The menu rows sit crisp on top. It fills its container
 * (centred by default); right-click anywhere to reposition it.
 *
 * Copy it into your app and restyle it; it is not a package export.
 */

const sans =
  "-apple-system, 'SF Pro Text', ui-sans-serif, system-ui, sans-serif";

// Apple-style frost: a milky veil + a backdrop blur + a gentle rim bend (the
// "liquid" lip), NO bevel. The crisp panel edge is a CSS double-border on the rows
// overlay (see boxShadow below), not the lens edge — which keeps it clean.
export const MENU_LENS: Partial<GlassOptics> = {
  mapSize: 256,
  clipToShape: true,
  softEdge: true,
  depth: 0.65,
  curvature: 0.26,
  dispersion: 0.16,
  strength: 0.22,
  bend: 0.65,
  bendWidth: 0.07,
  // A white veil + light frost for legibility, with a real rim bend + faint sheen
  // for the glassy edge. The crisp panel edge is still a CSS double-border on the
  // rows overlay (white inner + black outer), independent of the lens sheen.
  frost: 3.5,
  brightness: 0.55,
  specular: 0.8,
  sheenAngle: 45,
  glow: 0.06,
  glowSpread: 1,
  glowFalloff: 0.8,
  sheen: 0.4,
  sheenWidth: 1,
};

// No flat CSS fill — the bright frosted glass (lens brightness veil) is the
// material, so the refracted wallpaper shows through (glassy). Dark text on top.
const DEFAULT_WALLPAPER =
  "radial-gradient(120% 120% at 14% 16%, #ffb347 0%, transparent 46%)," +
  "radial-gradient(120% 120% at 86% 12%, #4dc3ff 0%, transparent 44%)," +
  "radial-gradient(130% 130% at 80% 90%, #ff5d8f 0%, transparent 50%)," +
  "radial-gradient(140% 140% at 18% 88%, #7a5cff 0%, transparent 52%)," +
  "linear-gradient(135deg, #9b4bd8, #f0793b)";

export type GlassMenuItem =
  | { label: string; shortcut?: string; danger?: boolean }
  | "separator";

// A realistic macOS Finder context menu — native menus aren't red, and the
// right-click menu doesn't show ⌘ shortcuts (those live in the menu-bar menus).
const DEFAULT_ITEMS: GlassMenuItem[] = [
  { label: "Open" },
  { label: "Quick Look" },
  "separator",
  { label: "Get Info" },
  { label: "Rename" },
  "separator",
  { label: "Copy" },
  { label: "Share" },
];

// Tight Finder-menu metrics: short rows, small radius, snug padding.
const ROW_H = 24;
const SEP_H = 11;
const PAD_Y = 5;
const MENU_W = 210;
const MENU_RADIUS = 9;

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

export interface GlassContextMenuProps {
  items?: GlassMenuItem[];
  /** Any CSS `background` value the glass refracts. */
  wallpaper?: string;
  /** Called with the clicked item's label. */
  onSelect?: (label: string) => void;
  /** Override the glass optics (merged over the built-in look). */
  lens?: Partial<GlassOptics>;
}

export const GlassContextMenu: React.FC<GlassContextMenuProps> = ({
  items = DEFAULT_ITEMS,
  wallpaper = DEFAULT_WALLPAPER,
  onSelect,
  lens,
}) => {
  const [ref, { w, h }] = useSize();
  // Snap geometry to whole pixels: the glass lens rounds its filter region to
  // integer px, so a fractional CSS box (from `w-16`, `(w-menuW)/2`) would make
  // the card's border land ~1px off the frosted edge (the "border doesn't fit").
  const menuW = Math.round(Math.min(MENU_W, w - 16));
  const menuH = useMemo(
    () =>
      PAD_Y * 2 +
      items.reduce((acc, it) => acc + (it === "separator" ? SEP_H : ROW_H), 0),
    [items],
  );
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  // Centre the menu once measured (and whenever the box resizes before it's placed).
  const cx = Math.round(pos ? pos.x : Math.max(8, (w - menuW) / 2));
  const cy = Math.round(pos ? pos.y : Math.max(8, (h - menuH) / 2));
  const ready = w > 0 && h > 0 && menuW > 0;

  const onContext = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    // Clamp the menu inside the container. `Math.max(8, …)` on the upper bound
    // guards a container too small for the menu (right-click in a tight box would
    // otherwise make the upper bound < 8 and place the panel off-screen / negative).
    setPos({
      x: Math.min(Math.max(8, e.clientX - r.left), Math.max(8, w - menuW - 8)),
      y: Math.min(Math.max(8, e.clientY - r.top), Math.max(8, h - menuH - 8)),
    });
  };

  // The wallpaper sits BEHIND the panel (it shows around the menu); the glass
  // refracts a copy of it, offset so the bent image lines up under the panel.
  const refractCopy = (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: -cx,
        top: -cy,
        width: w,
        height: h,
        background: wallpaper,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    />
  );

  return (
    <div
      ref={ref}
      onContextMenu={onContext}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontFamily: sans,
        userSelect: "none",
        cursor: "default",
      }}
    >
      {/* The wallpaper, shown around the panel. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: wallpaper,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      {ready && (
        <>
          {/* The glass panel: a real lens refracting a position-matched copy of
              the wallpaper. Placed directly (no clip-path wrapper) so the SVG
              filter renders cleanly. */}
          <Glass
            optics={{ ...MENU_LENS, ...lens }}
            brightnessInFilter
            width={menuW}
            height={menuH}
            radius={MENU_RADIUS}
            refract={refractCopy}
            behind="#b8569f"
            style={{
              position: "absolute",
              left: cx,
              top: cy,
              width: menuW,
              height: menuH,
              borderRadius: MENU_RADIUS,
            }}
          />
          {/* Rows + the panel edge — crisp, on top of the glass. Same box as the
              <Glass> beneath it; the border traces the frosted edge. */}
          <div
            role="menu"
            style={{
              position: "absolute",
              left: cx,
              top: cy,
              width: menuW,
              height: menuH,
              borderRadius: MENU_RADIUS,
              padding: `${PAD_Y}px 6px`,
              boxSizing: "border-box",
              // 1px white INNER highlight + crisp dark OUTER hairline + float shadow.
              boxShadow:
                "inset 0 0 0 1px rgba(255,255,255,0.5), 0 0 0 0.5px rgba(0,0,0,0.18), 0 16px 40px rgba(0,0,0,0.26), 0 2px 6px rgba(0,0,0,0.18)",
            }}
          >
            {items.map((it, i) => {
              if (it === "separator") {
                return (
                  <div
                    key={i}
                    style={{
                      height: SEP_H,
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        height: 1,
                        width: "100%",
                        background: "rgba(0,0,0,0.12)",
                      }}
                    />
                  </div>
                );
              }
              const active = hover === i;
              return (
                <div
                  key={i}
                  role="menuitem"
                  tabIndex={-1}
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() =>
                    setHover((cur) => (cur === i ? null : cur))
                  }
                  onClick={() => onSelect?.(it.label)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    height: ROW_H,
                    padding: "0 11px",
                    borderRadius: 6,
                    fontSize: 13,
                    cursor: "default",
                    color: active
                      ? "#fff"
                      : it.danger
                        ? "#ff3b30"
                        : "rgba(0,0,0,0.85)",
                    background: active
                      ? it.danger
                        ? "rgba(255,59,48,0.95)"
                        : "rgba(10,132,255,0.95)"
                      : "transparent",
                  }}
                >
                  <span style={{ flex: 1 }}>{it.label}</span>
                  {it.shortcut && (
                    <span
                      style={{
                        fontSize: 12,
                        color: active
                          ? "rgba(255,255,255,0.85)"
                          : "rgba(0,0,0,0.45)",
                      }}
                    >
                      {it.shortcut}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
