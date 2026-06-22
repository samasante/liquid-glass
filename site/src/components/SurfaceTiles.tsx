import React, { useRef, useState } from "react";
import { Glass, type GlassOptics } from "@samasante/liquid-glass";

/**
 * The generative-`<canvas>` WebGL demo tile for the Examples page. Safari refuses
 * to SVG-filter live media, so `<Glass draw>` runs one WebGL renderer that reads
 * the painted frame and refracts the lens from it (the `<video>` player tile is
 * the copy-paste example `GlassVideoControls`). It dogfoods the one `<Glass>`.
 */

type LensConfig = Partial<GlassOptics> & {
  lensW: number;
  lensH: number;
  borderRadius: number;
};

// ── Canvas (generative) tile ─────────────────────────────────────────────────

export const CANVAS_LENS: LensConfig = {
  lensW: 110,
  lensH: 110,
  borderRadius: 110,
  mapSize: 512,
  clipToShape: true,
  softEdge: true,
  strength: 0.17,
  depth: 1,
  curvature: 0.5,
  splay: 0,
  bend: 0.6,
  bendWidth: 0.16,
  dispersion: 0.8,
  specular: 1,
  sheenAngle: 55,
  glow: 0.2,
  glowSpread: 1,
  glowFalloff: 1.5,
  sheen: 1,
  sheenWidth: 4,
  sheenFalloff: 1.5,
  frost: 3.5,
  brightness: 0.05,
};
// A flowing field of fine lines (a contour / topographic look) on a deep base.
// Crisp lines are what a lens shows off best: the magnified band bends and the
// colour splits visibly along each line, which a smooth gradient can't show. The
// lines themselves are a cool near-white, so the colour you see comes from the
// lens's own chromatic dispersion at the rim, not a rainbow gradient.
// Deterministic from `t`, cheap, no per-frame state.
const LINE_COUNT = 24;

const drawScene = (ctx: CanvasRenderingContext2D, t: number) => {
  const { width: w, height: h } = ctx.canvas;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#070812";
  ctx.fillRect(0, 0, w, h);
  const s = t / 1000;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineWidth = 1.4;
  for (let i = 0; i < LINE_COUNT; i += 1) {
    const f = i / (LINE_COUNT - 1); // 0..1 down the surface
    const yBase = (0.06 + f * 0.88) * h;
    // Cool near-white; brighter through the middle band for depth. The lens adds
    // the colour via its chromatic dispersion at the rim.
    ctx.strokeStyle = `rgba(208, 222, 247, ${0.24 + 0.18 * Math.sin(f * Math.PI)})`;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 5) {
      const u = x / w;
      const y =
        yBase +
        Math.sin(u * 5.5 + s * 0.55 + i * 0.26) * 0.055 * h +
        Math.sin(u * 2.2 - s * 0.4 + i * 0.13) * 0.035 * h;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
};

/** A glass lens over a per-frame generative `<canvas>`. Move the pointer to steer
 *  the lens over the flowing field. */
export const GlassCanvasTile: React.FC<{ lens?: Partial<LensConfig> }> = ({
  lens,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [p, setP] = useState({ x: 0.5, y: 0.5 });
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setP({
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    });
  };
  const onLeave = () => setP({ x: 0.5, y: 0.5 });

  const { lensW, lensH, borderRadius, ...optical } = {
    ...CANVAS_LENS,
    ...lens,
  };

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        cursor: "crosshair",
        touchAction: "none",
      }}
    >
      <Glass
        draw={drawScene}
        optics={optical}
        size={[lensW * 2, lensH * 2]}
        radius={borderRadius}
        center={{ x: p.x, y: p.y }}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
};
