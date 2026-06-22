import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Glass, glassValue, type GlassOptics } from "@samasante/liquid-glass";
import { DARK, LIGHT } from "../theme";

/**
 * A bounded "glass viewport" that refracts a mini-scene of LIVE HTML — a row of
 * photos on top, the headline + description below. The selling point is refracting
 * real DOM, so everything here is plain painted HTML.
 *
 * IN-PLACE (no clone): `<Glass>` bends the stage's own pixels, so dispersion never
 * shifts the content. The stage is SEE-THROUGH — no background — so the page's
 * dot-grid (painted once behind) shows through but is NEVER refracted; refracting a
 * dense pattern in-place is what tanked perf + exposed the obb bend. The lens bends
 * only the smooth content (photos + headline), and the page mask fades the dots out
 * of the lens's region so they don't read as un-refracted.
 *
 * Light content + a near-still lens = fast in Safari: the orbit writes only tiny
 * eases, so WebKit re-filters a cheap frame; idle is effectively free.
 *
 * Photo tiles' rotation + rounded corners + white border are baked into the PNGs
 * (a CSS transform on refracted content is dropped by WebKit). The tiles carry NO
 * z-index: a positive z-index leaks past the source wrapper and paints them over
 * the lens. Same `<StageContent>` is both crisp children and refraction target.
 */

const sans =
  "-apple-system, 'SF Pro Display', ui-sans-serif, system-ui, sans-serif";

// Photo tiles fanned across the banner (all layout, never transform). Images are
// a cheap texture for the in-place filter (unlike the old repeating dot-grid that
// tanked perf), and their smooth content hides the obb bend's residual anisotropy.
const STACK = [
  { src: "/frames/tile-1.png", h: 196, ml: 0, mb: 8 },
  { src: "/frames/tile-2.png", h: 216, ml: -52, mb: 30 },
  { src: "/frames/tile-3.png", h: 204, ml: -52, mb: 0 },
  { src: "/frames/tile-4.png", h: 216, ml: -52, mb: 26 },
  { src: "/frames/tile-5.png", h: 196, ml: -52, mb: 10 },
];

const StageContent: React.FC<{
  dark: boolean;
  // Layout multiplier (NOT a CSS transform — WebKit drops transforms on refracted
  // content). Shrinks photos + type together so the hero fits a phone; the crisp
  // layer and the refraction copy take the SAME scale so the bend stays aligned.
  scale?: number;
}> = ({ dark, scale = 1 }) => {
  const text = dark ? "#fff" : "#0a0b0d";
  const sub = dark ? "rgba(255,255,255,0.72)" : "rgba(0,0,0,0.6)";
  // FULLY SEE-THROUGH: no background, so the page (its dot-grid, painted once
  // behind the hero) shows through — the dots are NEVER refracted (refracting a
  // dense pattern in-place is what tanks perf + exposes the bend). The lens only
  // bends the smooth content (photos + headline).
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18 * scale,
          padding: `${40 * scale}px ${32 * scale}px`,
          textAlign: "center",
        }}
      >
        {/* photo banner */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
          }}
        >
          {STACK.map((t) => (
            <img
              key={t.src}
              src={t.src}
              alt=""
              draggable={false}
              style={{
                height: t.h * scale,
                marginLeft: t.ml * scale,
                marginBottom: t.mb * scale,
                display: "block",
              }}
            />
          ))}
        </div>
        {/* real, selectable headline + copy */}
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: sans,
              fontSize: 88 * scale,
              fontWeight: 600,
              letterSpacing: "-0.05em",
              lineHeight: 1,
              color: text,
            }}
          >
            Liquid glass<span style={{ color: sub }}>.</span>
          </h1>
          <div
            style={{
              margin: `${18 * scale}px auto 0`,
              maxWidth: 520 * scale,
              fontFamily: sans,
              fontSize: 22 * scale,
              fontWeight: 450,
              color: sub,
              lineHeight: 1.5,
            }}
          >
            Real glass refraction for the web. Works in Safari, Firefox and
            Chrome. Zero dependencies.
          </div>
        </div>
      </div>
    </div>
  );
};

export const DOT_TILE = 23; // px — the page grid + the scene copy share this tile

// The refraction SOURCE handed to the lens (`refract`). It REPLICATES the page —
// same dot grid + page background — plus the photos/headline, so the loupe bends
// the exact thing the flat page shows. `grid` offsets the dots by the canvas's
// on-screen position so they LINE UP with the whole-page grid behind (no seam
// between the bent dots in the loupe and the flat ones around it). The copy path
// filters only the bounded lens region, so a dense dot pattern is cheap here and
// never ovals (the in-place trap); symmetric chroma keeps Safari shift-free.
const Scene: React.FC<{ dark: boolean; grid: string; scale?: number }> = ({
  dark,
  grid,
  scale = 1,
}) => {
  const t = dark ? DARK : LIGHT;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        backgroundColor: t.pageBg,
        backgroundImage: t.dots,
        backgroundSize: `${DOT_TILE}px ${DOT_TILE}px`,
        backgroundPosition: grid,
      }}
    >
      <StageContent dark={dark} scale={scale} />
    </div>
  );
};

// Stage height — used by the outer frame AND the inner wrap; they MUST match so
// the in-place filter region covers the whole stage. Single source of truth.
const STAGE_H = "min(500px, 66vh)";
const REST = { x: 0.5, y: 0.46 };
// The lens auto-drifts in this clamped oval when the cursor's away — the original
// wide/quick sweep. Centred at cy 0.46 (not the original 0.31): in-place has no
// source bleed, so the orbit has to stay inside the clamp.
const ORBIT = { cx: 0.5, cy: 0.46, rx: 0.31, ry: 0.16, speed: 0.45 };
// Press-to-grow: holding the pointer swells the lens by this factor.
const GROW_SCALE = 1.22;

export const GlassDemo: React.FC<{
  // The panel config: the public optics bag + the demo's editable geometry.
  lens: Partial<GlassOptics> & {
    lensW?: number;
    lensH?: number;
    borderRadius?: number;
  };
  dark: boolean;
  mobile?: boolean;
}> = ({ lens, dark, mobile = false }) => {
  // On phones, shrink the hero content + loupe together so the banner + headline
  // fit a ~390px viewport (the floating controls are hidden there).
  const scale = mobile ? 0.52 : 1;
  const stageRef = useRef<HTMLDivElement>(null);
  const x = useMemo(() => glassValue(REST.x), []); // eslint-disable-line react-hooks/exhaustive-deps
  const y = useMemo(() => glassValue(REST.y), []); // eslint-disable-line react-hooks/exhaustive-deps
  const target = useRef<{ x: number; y: number } | null>(null);
  // Cached stage rect so onMove doesn't force a reflow on every pointer move —
  // the stage only moves on resize, which refreshes this in the measure effect.
  const rectRef = useRef<DOMRect | null>(null);

  // Honour prefers-reduced-motion: park the auto-drift (cursor-follow still works).
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Base lens size from the panel (full-px; the panel carries half-extents, so
  // double them). Re-derived only when you drag the Lens sliders.
  const baseW = (lens.lensW ?? 150) * 2 * scale;
  const baseH = (lens.lensH ?? 150) * 2 * scale;
  const baseR = (lens.borderRadius ?? (lens.lensW ?? 150)) * scale;
  const baseRef = useRef({ w: baseW, h: baseH, r: baseR });
  baseRef.current = { w: baseW, h: baseH, r: baseR };

  // Press-to-grow rides on the SVG filter via motion values: holding the pointer
  // swells the lens (a critically-damped spring 1 → GROW_SCALE and back) WITHOUT
  // re-rasterizing the map every frame — it re-sharpens when the spring settles.
  // (The dot-grid, not motion-valued size, was what mis-sized the lens before.)
  const lw = useMemo(() => glassValue(baseW), []); // eslint-disable-line react-hooks/exhaustive-deps
  const lh = useMemo(() => glassValue(baseH), []); // eslint-disable-line react-hooks/exhaustive-deps
  const lr = useMemo(() => glassValue(baseR), []); // eslint-disable-line react-hooks/exhaustive-deps
  const press = useRef({ c: 1, t: 1, raf: 0 });
  const applySize = () => {
    const { w, h, r } = baseRef.current;
    const k = press.current.c;
    lw.set(w * k);
    lh.set(h * k);
    lr.set(r * k);
  };
  // Keep the rendered size in sync when the Lens sliders change.
  useEffect(applySize, [baseW, baseH, baseR]); // eslint-disable-line react-hooks/exhaustive-deps
  const springPress = () => {
    const p = press.current;
    cancelAnimationFrame(p.raf);
    const step = () => {
      p.c += (p.t - p.c) * 0.2;
      if (Math.abs(p.t - p.c) < 0.002) p.c = p.t;
      applySize();
      if (p.c !== p.t) p.raf = requestAnimationFrame(step);
    };
    p.raf = requestAnimationFrame(step);
  };
  const onDown = () => {
    press.current.t = GROW_SCALE;
    springPress();
  };
  const releasePress = () => {
    press.current.t = 1;
    springPress();
  };

  const [stage, setStage] = useState({ w: 0, h: 0 });
  // Background-position that aligns the scene-copy's dots with the whole-page grid
  // (anchored to the viewport): shift by the canvas's on-screen offset, mod tile.
  const [gridPos, setGridPos] = useState("0px 0px");

  // COPY LOUPE: the lens refracts a COPY of the scene (pixelUnits / userSpaceOnUse).
  // That path has source bleed and normalizes aspect internally via the diagonal,
  // so the per-axis scaleX/scaleY correction the in-place path needs is unnecessary
  // here — the optics pass straight through. Glass also clamps the lens to the
  // surface in pixelUnits mode, so the cursor/orbit only needs a gentle box.
  const clampBox = useMemo(() => {
    const { w, h } = stage;
    if (!(w > 0 && h > 0))
      return { xlo: 0.18, xhi: 0.82, ylo: 0.28, yhi: 0.72 };
    const px = baseW / 2 / w;
    const py = baseH / 2 / h;
    return { xlo: px, xhi: 1 - px, ylo: py, yhi: 1 - py };
  }, [stage, baseW, baseH]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const er = el.getBoundingClientRect();
      rectRef.current = er;
      setStage((prev) =>
        prev.w === er.width && prev.h === er.height
          ? prev
          : { w: er.width, h: er.height },
      );
      const ox = -(((er.left % DOT_TILE) + DOT_TILE) % DOT_TILE);
      const oy = -(((er.top % DOT_TILE) + DOT_TILE) % DOT_TILE);
      setGridPos(`${ox}px ${oy}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // The lens FOLLOWS THE CURSOR, and gently auto-drifts in a clamped orbit when
  // idle. Affordable now the refracted content is light (no dot-grid): the orbit
  // keeps moving but the writes are tiny eases, so WebKit re-filters a cheap
  // still-ish frame. On hover the cursor takes over (snappier ease). The target
  // is clamped so the bleed-less lens never runs off the frame.
  const clampRef = useRef(clampBox);
  clampRef.current = clampBox;
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;
  useEffect(() => {
    let raf = 0;
    const start = typeof performance !== "undefined" ? performance.now() : 0;
    const clamp = (v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, v));
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const t = target.current;
      const c = clampRef.current;
      let tx: number;
      let ty: number;
      if (t) {
        tx = clamp(t.x, c.xlo, c.xhi);
        ty = clamp(t.y, c.ylo, c.yhi);
      } else if (reduceRef.current) {
        // reduced motion: hold at rest, no drift
        tx = REST.x;
        ty = REST.y;
      } else {
        // gentle auto-drift, clamped to stay in the bleed-less frame
        const a = ((now - start) / 1000) * ORBIT.speed;
        // sin negated → orbit runs the opposite way round the oval.
        tx = clamp(ORBIT.cx + ORBIT.rx * Math.cos(a), c.xlo, c.xhi);
        ty = clamp(ORBIT.cy - ORBIT.ry * Math.sin(a), c.ylo, c.yhi);
      }
      const cx = x.get();
      const cy = y.get();
      // snappier chasing the cursor, gentler for the idle drift
      const ease = t ? 0.3 : 0.14;
      const nx = cx + (tx - cx) * ease;
      const ny = cy + (ty - cy) * ease;
      if (Math.abs(nx - cx) > 0.0003 || Math.abs(ny - cy) > 0.0003) {
        x.set(nx);
        y.set(ny);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [x, y]);

  const onMove = (e: React.PointerEvent) => {
    const r = rectRef.current ?? stageRef.current?.getBoundingClientRect();
    if (!r) return;
    target.current = {
      x: (e.clientX - r.left) / r.width,
      y: (e.clientY - r.top) / r.height,
    };
  };

  return (
    // SEAMLESS: the stage is frameless — the whole-page dot grid shows straight
    // through it (the content sits on it crisp), and a loupe roams over the top.
    // COPY method — the loupe refracts a COPY of the page (grid-aligned dots +
    // content), so it bends EVERYTHING under it, dots included, with no seam to the
    // flat grid around it. The Glass overlay shows only inside the lens shape.
    <div
      ref={stageRef}
      onPointerMove={onMove}
      onPointerDown={onDown}
      onPointerUp={releasePress}
      onPointerCancel={releasePress}
      onPointerLeave={() => {
        target.current = null;
        releasePress();
      }}
      style={{
        position: "relative",
        flexShrink: 0,
        width: "min(1100px, 94vw)",
        height: mobile ? "min(330px, 42vh)" : STAGE_H,
        touchAction: "none",
        cursor: "crosshair",
      }}
    >
      {/* crisp content — transparent, so the whole-page grid shows through */}
      <StageContent dark={dark} scale={scale} />
      {/* the loupe — refracts a grid-aligned COPY of the page, bounded to the lens */}
      <Glass
        refract={<Scene dark={dark} grid={gridPos} scale={scale} />}
        pixelUnits
        behind={(dark ? DARK : LIGHT).pageBg}
        optics={lens}
        center={{ x, y }}
        width={lw}
        height={lh}
        radius={lr}
        style={{ position: "absolute", inset: 0 }}
      />
    </div>
  );
};
