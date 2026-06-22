import React, { useEffect, useState } from "react";
import { GlassDemo } from "../components/GlassDemo";
import {
  GlassControlPanel,
  shuffleParams,
  LENS_KEYS,
  type GlassConfig,
} from "../components/GlassControlPanel";
import { SiteHeader } from "../components/SiteHeader";
import { useTheme, type Theme } from "../theme";
import { useIsMobile } from "../useMedia";

const VERSION = "v0.1.0";
const mono = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";
const sans =
  "-apple-system, 'SF Pro Text', ui-sans-serif, system-ui, sans-serif";

// The refraction + brightness veil + sheen all live INSIDE the SVG filter, so there's
// one rasterized unit. strength is a fraction of the element; this <Glass>
// is the full viewport, so ~0.06 gives a clean, strong bend.
export const DEFAULT_LENS: GlassConfig = {
  // Sam-tuned in real Safari on the playground (2026-06-22). A ~300px loupe; a
  // light frost keeps the copy-path fast and crisp.
  lensW: 150,
  lensH: 150,
  borderRadius: 150,
  mapSize: 512,
  clipToShape: true,
  softEdge: true,
  splay: 0,
  sheenAngle: 0,
  sheenDark: false,
  bend: 0.4,
  bendWidth: 0.07,
  depth: 0.95,
  curvature: 0.5,
  dispersion: 0.2,
  strength: 0.14,
  frost: 1,
  brightness: 0,
  specular: 1.55,
  sheen: 1.2,
  sheenWidth: 3.5,
  sheenFalloff: 1.7,
  glow: 0.1,
  glowSpread: 1,
  glowFalloff: 0.6,
};

const INSTALL = "pnpm add @samasante/liquid-glass";

const PRESS_TRANSITION = "transform 0.5s cubic-bezier(0.34, 1.55, 0.5, 1)";
const PRESS_GROW = "transform 0.16s cubic-bezier(0.2, 0, 0.2, 1)";
const pressDown = (e: React.PointerEvent) => {
  const el = e.currentTarget as HTMLElement;
  el.style.transition = `${PRESS_GROW}`;
  el.style.transform = "scale(1.05)";
};
const pressUp = (e: React.PointerEvent) => {
  const el = e.currentTarget as HTMLElement;
  el.style.transition = `${PRESS_TRANSITION}`;
  el.style.transform = "scale(1)";
};
const pressHandlers = {
  onPointerDown: pressDown,
  onPointerUp: pressUp,
  onPointerLeave: pressUp,
};

// Single install box (pnpm — the sane default in 2026), click to copy.
const InstallChip: React.FC<{ t: Theme; mobile?: boolean }> = ({
  t,
  mobile = false,
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <button
      data-no-cannon
      title="Click to copy"
      {...pressHandlers}
      onClick={() =>
        navigator.clipboard?.writeText(INSTALL).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        })
      }
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: mobile ? 8 : 12,
        boxSizing: "border-box",
        padding: mobile ? "10px 15px" : "17px 24px",
        borderRadius: mobile ? 12 : 15,
        border: `1px solid ${copied ? "rgba(95,211,141,0.5)" : t.chipBorder}`,
        background: t.chipBg,
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)",
        fontFamily: mono,
        fontSize: mobile ? 13 : 17,
        cursor: "pointer",
        color: copied ? "#3fae6a" : t.text,
        textAlign: "left",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: copied ? "#3fae6a" : t.faint }}>$</span>
      {/* Both labels share one grid cell so the box hugs the wider (install) text
          and keeps that width when the shorter "copied" label swaps in. */}
      <span style={{ display: "grid" }}>
        <span
          style={{
            gridArea: "1 / 1",
            visibility: copied ? "hidden" : "visible",
          }}
        >
          {INSTALL}
        </span>
        <span
          style={{
            gridArea: "1 / 1",
            visibility: copied ? "visible" : "hidden",
          }}
          aria-hidden={!copied}
        >
          copied to clipboard
        </span>
      </span>
    </button>
  );
};

// Mobile control UX: a floating "Tune" button opens a frosted bottom sheet with
// the same Lens + Settings controls (the fixed desktop windows would overlap the
// hero on a phone). The sheet stays mounted so it can slide in/out.
const TuneIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5" />
    <circle cx="16" cy="6" r="2" fill="currentColor" stroke="none" />
    <circle cx="8" cy="12" r="2" fill="currentColor" stroke="none" />
    <circle cx="13" cy="18" r="2" fill="currentColor" stroke="none" />
  </svg>
);

const MobileControls: React.FC<{
  params: GlassConfig;
  setParams: React.Dispatch<React.SetStateAction<GlassConfig>>;
  onShuffle: () => void;
  onReset: () => void;
  dirty: boolean;
  dark: boolean;
  t: Theme;
}> = ({ params, setParams, onShuffle, onReset, dirty, dark, t }) => {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 402,
  );
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const sliderW = Math.min(380, w - 56);
  const sheetBg = dark ? "rgba(24,24,28,0.72)" : "rgba(250,250,253,0.8)";

  return (
    <>
      {/* Floating "Tune" button — hidden while the sheet is open. */}
      <button
        {...pressHandlers}
        onClick={() => setOpen(true)}
        aria-label="Tune the glass"
        style={{
          position: "fixed",
          right: 16,
          bottom: 18,
          zIndex: 75,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 46,
          padding: "0 18px",
          borderRadius: 999,
          border: `1px solid ${t.chipBorder}`,
          background: t.chipBg,
          backdropFilter: "blur(18px)",
          WebkitBackdropFilter: "blur(18px)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
          color: t.text,
          fontFamily: sans,
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
          opacity: open ? 0 : 1,
          pointerEvents: open ? "none" : "auto",
          transition: "opacity 0.2s ease, transform 0.16s",
        }}
      >
        <TuneIcon /> Tune
      </button>

      {/* Dim backdrop — tap to dismiss. */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 78,
          background: "rgba(0,0,0,0.4)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* The sheet itself. */}
      <div
        role="dialog"
        aria-label="Glass controls"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 80,
          maxHeight: "84vh",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: "8px 20px calc(28px + env(safe-area-inset-bottom))",
          background: sheetBg,
          backdropFilter: "blur(34px) saturate(180%)",
          WebkitBackdropFilter: "blur(34px) saturate(180%)",
          borderTop: `0.5px solid ${t.chipBorder}`,
          borderRadius: "20px 20px 0 0",
          boxShadow: "0 -20px 60px rgba(0,0,0,0.4)",
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)",
          fontFamily: sans,
        }}
      >
        {/* grab handle + Done */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            padding: "6px 0 12px",
          }}
        >
          <span
            style={{
              width: 38,
              height: 5,
              borderRadius: 3,
              background: dark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.2)",
            }}
          />
          <button
            onClick={() => setOpen(false)}
            style={{
              position: "absolute",
              right: 0,
              top: 2,
              border: "none",
              background: "none",
              cursor: "pointer",
              fontFamily: sans,
              fontSize: 15,
              fontWeight: 600,
              color: t.text,
            }}
          >
            Done
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <GlassControlPanel
            embedded
            sliderWidth={sliderW}
            section="lens"
            value={params}
            dark={dark}
            onChange={setParams}
            onShuffle={() => {}}
            onReset={() => {}}
          />
          <GlassControlPanel
            embedded
            sliderWidth={sliderW}
            value={params}
            dark={dark}
            onChange={setParams}
            onShuffle={onShuffle}
            onReset={onReset}
            dirty={dirty}
          />
        </div>
      </div>
    </>
  );
};

export const Playground: React.FC = () => {
  const { dark, t, toggle } = useTheme();
  const mobile = useIsMobile();
  const [params, setParams] = useState<GlassConfig>(DEFAULT_LENS);

  const handleShuffle = () => setParams((p) => shuffleParams(p));
  // Reset/dirty cover the glass MATERIAL only — the Lens (size) is a separate
  // menu, so the Settings buttons leave it untouched.
  const handleReset = () =>
    setParams((p) => ({
      ...DEFAULT_LENS,
      lensW: p.lensW,
      lensH: p.lensH,
      borderRadius: p.borderRadius,
    }));
  const dirty = (Object.keys(DEFAULT_LENS) as (keyof GlassConfig)[]).some(
    (k) =>
      !LENS_KEYS.includes(k as (typeof LENS_KEYS)[number]) &&
      params[k] !== DEFAULT_LENS[k],
  );

  return (
    <div
      style={{
        position: "relative",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: t.pageBg,
        color: t.text,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Whole-page dot grid, anchored to the viewport (0,0) so the glass canvas's
          offset-aligned copy lines up with it seamlessly. The canvas is frameless +
          transparent, so this grid shows straight through it; the loupe bends a
          grid-aligned copy of it. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          backgroundImage: t.dots,
          backgroundSize: "23px 23px",
          backgroundPosition: "0 0",
          pointerEvents: "none",
        }}
      />
      <SiteHeader active="playground" t={t} onToggleTheme={toggle} />

      <div
        role="main"
        style={{ position: "relative", zIndex: 1, flex: 1, overflow: "hidden" }}
      >
        {/* centred group: the frameless glass canvas (the page grid shows through
            it; a loupe bends a grid-aligned copy), install below */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: mobile ? 2 : 4,
            padding: mobile ? "0 16px 40px" : "0 24px 200px",
            pointerEvents: "none",
          }}
        >
          <div style={{ pointerEvents: "auto" }}>
            <GlassDemo lens={params} dark={dark} mobile={mobile} />
          </div>
          <div style={{ pointerEvents: "auto" }}>
            <InstallChip t={t} mobile={mobile} />
          </div>
        </div>

        {/* Desktop: two floating control windows. Mobile: a "Tune" button opens a
            bottom sheet with the same controls (the windows would overlap the hero). */}
        {mobile ? (
          <MobileControls
            params={params}
            setParams={setParams}
            onShuffle={handleShuffle}
            onReset={handleReset}
            dirty={dirty}
            dark={dark}
            t={t}
          />
        ) : (
          <>
            <GlassControlPanel
              value={params}
              dark={dark}
              onChange={setParams}
              onShuffle={handleShuffle}
              onReset={handleReset}
              dirty={dirty}
            />
            {/* Lens GEOMETRY in its own small menu — not part of the glass material. */}
            <GlassControlPanel
              section="lens"
              align="left"
              value={params}
              dark={dark}
              onChange={setParams}
              onShuffle={() => {}}
              onReset={() => {}}
            />
          </>
        )}

        <div
          style={{
            position: "absolute",
            left: 24,
            bottom: 18,
            fontFamily: mono,
            fontSize: 12.5,
            fontWeight: 500,
            color: t.footer,
            pointerEvents: "none",
            letterSpacing: 0.2,
            textShadow: dark
              ? "0 1px 14px rgba(0,0,0,0.7)"
              : "0 1px 10px rgba(255,255,255,0.8)",
          }}
        >
          {VERSION} · MIT
        </div>
      </div>
    </div>
  );
};
