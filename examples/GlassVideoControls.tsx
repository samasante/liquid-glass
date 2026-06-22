import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Glass,
  type GlassOptics,
  type GlassSurfaceLens,
} from "@samasante/liquid-glass";

/**
 * A glass video player: every transport control is its own glass lens bending the
 * live footage. Safari won't SVG-filter a live `<video>`, so `<Glass src>` runs ONE
 * WebGL renderer that reads the playing frame and draws every lens from it — pass
 * the lens geometry in `lenses`, and the crisp interactive controls as children.
 *
 * Copy it into your app and restyle it; it is not a package export.
 */

const sans = "-apple-system, 'SF Pro Text', system-ui, sans-serif";

// A refractive rim + soft sheen = the Apple "liquid glass" edge over moving
// footage. A gentle dome (low depth), a touch of frost and dispersion.
export const PLAYER_OPTICS: Partial<GlassOptics> = {
  mapSize: 512,
  clipToShape: true,
  softEdge: true,
  strength: 0.16,
  depth: 0.2,
  curvature: 0.55,
  bend: 0.25,
  bendWidth: 0.08,
  dispersion: 0.15,
  specular: 1,
  sheenAngle: 50,
  glow: 0.15,
  glowSpread: 1,
  glowFalloff: 1.5,
  sheen: 0.95,
  sheenWidth: 2,
  sheenFalloff: 1.5,
  frost: 3,
  brightness: 0,
};

// The scrub track is its OWN lens with its OWN look, separate from the round
// buttons above. A thin bar wants a GENTLE, flat refraction — the buttons'
// surface-relative strength + dome would over-bend a 26px bar into a warped oval
// (it also gets its own rect displacement map). Low strength, no dome/meniscus =
// a clean glass rounded-rect that just bends the footage a little.
export const SCRUB_OPTICS: Partial<GlassOptics> = {
  strength: 0.03,
  depth: 0.3,
  curvature: 0.25,
  dispersion: 0.2,
  bend: 0.05,
  bendWidth: 0.06,
  specular: 1,
  sheenAngle: 45,
  sheen: 0.35,
  sheenWidth: 3,
  sheenFalloff: 1.5,
  glow: 0.1,
  glowSpread: 1,
  glowFalloff: 1.5,
  frost: 6,
  brightness: 0,
};

// Control geometry (full px) + positions (0..1 of the surface). The play disc is
// 104px; the skips are 0.6× of it, offset to either side of centre.
const PLAY_DIA = 104;
const SKIP_DIA = 62;
const GAP = 0.23; // skip-button centre offset from the middle
const SKIP_BACK_X = 0.5 - GAP;
const SKIP_FWD_X = 0.5 + GAP;

// Scrub bar (the glass track): a wide thin lens, inset 6% on each side, sitting
// `SCRUB_BOTTOM` of the height up from the bottom. It refracts the footage like the
// buttons; the progress fill rides on top. Its width is responsive, so it's sized
// from the measured player box (see useSize below).
const SCRUB_INSET = 0.06; // left/right inset as a fraction of the width
const SCRUB_H = 26; // bar height (px)
const SCRUB_RADIUS = 7; // a gentle rounded RECT, not a pill (a half-height radius
// rounds the ends into a lozenge/oval — keep the corner small on a wide thin bar)
const SCRUB_BOTTOM = 0.08; // gap below the bar, as a fraction of the height

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

const ICON_SHADOW = "drop-shadow(0 1px 2px rgba(0,0,0,0.45))";

const ctrlStyle: React.CSSProperties = {
  position: "absolute",
  transform: "translate(-50%,-50%)",
  border: "none",
  background: "none",
  padding: 0,
  cursor: "pointer",
  color: "#fff",
  display: "grid",
  placeItems: "center",
};

/** A circular-arrow skip glyph (~300° ring + a triangular pointer) wrapping the
 *  skip seconds. Forward mirrors the rewind glyph (inner text un-mirrors). */
const SkipIcon: React.FC<{ dir: 1 | -1; size: number }> = ({ dir, size }) => {
  const mirror = dir > 0 ? "translate(24,0) scale(-1,1)" : undefined;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ filter: ICON_SHADOW, overflow: "visible" }}
    >
      <g transform={mirror}>
        <path
          d="M16.5 4.2 A9 9 0 1 1 7.5 4.2"
          fill="none"
          stroke="#fff"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <path d="M5.4 4.2 L9 2.5 L8.9 6.1 Z" fill="#fff" />
        <text
          x="12"
          y="12.6"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="9.2"
          fontWeight="600"
          fontFamily={sans}
          fill="#fff"
          transform={mirror}
        >
          10
        </text>
      </g>
    </svg>
  );
};

/** Bold pause bars or a play triangle. */
const PlayPauseIcon: React.FC<{ playing: boolean; size: number }> = ({
  playing,
  size,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    fill="#fff"
    style={{ filter: ICON_SHADOW }}
  >
    {playing ? (
      <>
        <rect x="36.2" y="30.8" width="9.2" height="38.4" rx="2.2" />
        <rect x="54.6" y="30.8" width="9.2" height="38.4" rx="2.2" />
      </>
    ) : (
      <path d="M39 29.5 Q39 27 41.3 28.2 L72 47.8 Q74 49 72 51 L41.3 71.8 Q39 73 39 70.5 Z" />
    )}
  </svg>
);

/** Timeline: a thin rounded track with an opaque-white progress fill (no handle).
 *  The fill width is driven imperatively (rAF) so it doesn't re-render each frame;
 *  the taller wrapper is the seek target. */
const ScrubBar: React.FC<{
  fillRef: React.RefObject<HTMLDivElement | null>;
  onSeek: (e: React.PointerEvent) => void;
}> = ({ fillRef, onSeek }) => (
  // No background — a glass lens behind this (see SCRUB_* lens) IS the bar, so the
  // track refracts the footage. This overlay is just the seek target + the progress
  // line on top: a faint full-width hint with an opaque-white played portion. The
  // inset / height / bottom MUST match the scrub lens geometry so they line up.
  <div
    onPointerDown={onSeek}
    style={{
      position: "absolute",
      left: `${SCRUB_INSET * 100}%`,
      right: `${SCRUB_INSET * 100}%`,
      bottom: `${SCRUB_BOTTOM * 100}%`,
      height: SCRUB_H,
      display: "flex",
      alignItems: "center",
      padding: "0 12px",
      borderRadius: SCRUB_RADIUS,
      cursor: "pointer",
      touchAction: "none",
    }}
  >
    <div
      style={{
        position: "relative",
        width: "100%",
        height: 4,
        borderRadius: 2,
        background: "rgba(255,255,255,0.32)",
        overflow: "hidden",
        boxShadow: "0 0 3px rgba(0,0,0,0.25)",
      }}
    >
      <div
        ref={fillRef}
        style={{ width: "0%", height: "100%", borderRadius: 2, background: "#fff" }}
      />
    </div>
  </div>
);

export const GlassVideoControls: React.FC<{
  src: string;
  /** Override the round-button optics (merged over the built-in look). */
  lens?: Partial<GlassOptics>;
  /** Override the scrub-track optics (merged over {@link SCRUB_OPTICS}) — the
   *  track is a separate lens, so it tunes independently of the buttons. */
  trackLens?: Partial<GlassOptics>;
}> = ({ src, lens, trackLens }) => {
  const [playing, setPlaying] = useState(true);
  const [ref, { w, h }] = useSize();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

  // Drive the timeline fill from the real playback position (imperative — no
  // per-frame re-render), and seek on pointer-down anywhere on the bar.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const v = videoRef.current,
        fill = fillRef.current;
      if (v && fill && v.duration > 0)
        fill.style.width = `${(v.currentTime / v.duration) * 100}%`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const seek = (e: React.PointerEvent) => {
    const v = videoRef.current;
    if (!v || !(v.duration > 0)) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    v.currentTime =
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * v.duration;
  };
  const skipBy = (d: number) => {
    const v = videoRef.current;
    if (v && v.duration > 0)
      v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + d));
  };

  // One shared look (`optics`) + one lens per control (FULL-px geometry, centre as
  // a 0..1 fraction). The crisp controls sit on top as `children`. The play disc is
  // lens 0 (it owns the shared displacement map, so keep a round lens first). The
  // scrub track is a wide thin lens sized from the measured box, added once measured.
  const lenses: GlassSurfaceLens[] = [
    { x: 0.5, y: 0.5, w: PLAY_DIA, h: PLAY_DIA, radius: PLAY_DIA / 2 },
    { x: SKIP_BACK_X, y: 0.5, w: SKIP_DIA, h: SKIP_DIA, radius: SKIP_DIA / 2 },
    { x: SKIP_FWD_X, y: 0.5, w: SKIP_DIA, h: SKIP_DIA, radius: SKIP_DIA / 2 },
  ];
  if (w > 0 && h > 0) {
    lenses.push({
      x: 0.5,
      y: 1 - SCRUB_BOTTOM - SCRUB_H / 2 / h,
      w: w * (1 - 2 * SCRUB_INSET),
      h: SCRUB_H,
      radius: SCRUB_RADIUS,
      // Per-lens optics: the displacement-map shape is shared from lens 0, but
      // these runtime knobs apply per lens. A thin bar wants a gentler, flatter
      // bend than the round buttons (see SCRUB_OPTICS above).
      optics: { ...SCRUB_OPTICS, ...trackLens },
    });
  }

  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        touchAction: "none",
      }}
    >
      <Glass
        src={src}
        optics={{ ...PLAYER_OPTICS, ...lens }}
        lenses={lenses}
        videoRef={videoRef}
        paused={!playing}
        maxDpr={2}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        <button
          type="button"
          aria-label="Rewind 10 seconds"
          onClick={() => skipBy(-10)}
          style={{ ...ctrlStyle, left: `${SKIP_BACK_X * 100}%`, top: "50%", width: SKIP_DIA, height: SKIP_DIA }}
        >
          <SkipIcon dir={-1} size={SKIP_DIA * 0.62} />
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((p) => !p)}
          style={{ ...ctrlStyle, left: "50%", top: "50%", width: PLAY_DIA, height: PLAY_DIA }}
        >
          <PlayPauseIcon playing={playing} size={PLAY_DIA * 0.92} />
        </button>
        <button
          type="button"
          aria-label="Forward 10 seconds"
          onClick={() => skipBy(10)}
          style={{ ...ctrlStyle, left: `${SKIP_FWD_X * 100}%`, top: "50%", width: SKIP_DIA, height: SKIP_DIA }}
        >
          <SkipIcon dir={1} size={SKIP_DIA * 0.62} />
        </button>
        <ScrubBar fillRef={fillRef} onSeek={seek} />
      </Glass>
    </div>
  );
};
