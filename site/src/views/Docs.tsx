import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Glass, glassValue } from "@samasante/liquid-glass";
import { SiteHeader } from "../components/SiteHeader";
import { useTheme, type Theme } from "../theme";
import { navigate } from "../router";
import { useIsMobile } from "../useMedia";

const REPO = "https://github.com/samasante/liquid-glass";
const sans =
  "-apple-system, 'SF Pro Text', ui-sans-serif, system-ui, sans-serif";
const mono = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

// Tiny zero-dependency highlighter: comments, strings, keywords, JSX tags. The
// code block stays dark in both themes, so the token colours are fixed.
const KW = new Set([
  "import",
  "from",
  "export",
  "default",
  "const",
  "let",
  "var",
  "return",
  "function",
  "new",
]);
const tokenize = (code: string) =>
  code
    .split(/(\/\/[^\n]*|"[^"]*"|'[^']*'|`[^`]*`|<\/?[A-Za-z][\w.]*|\b\w+\b)/g)
    .map((tok, i) => {
      if (!tok) return null;
      let color: string | undefined;
      if (tok.startsWith("//")) color = "#6b7585";
      else if (/^["'`]/.test(tok)) color = "#9ecbff";
      else if (tok.startsWith("<")) color = "#7ee787";
      else if (KW.has(tok)) color = "#ff8197";
      return color ? (
        <span key={i} style={{ color }}>
          {tok}
        </span>
      ) : (
        <React.Fragment key={i}>{tok}</React.Fragment>
      );
    });

const PMS = [
  { id: "pnpm", cmd: "pnpm add @samasante/liquid-glass" },
  { id: "npm", cmd: "npm i @samasante/liquid-glass" },
  { id: "yarn", cmd: "yarn add @samasante/liquid-glass" },
  { id: "bun", cmd: "bun add @samasante/liquid-glass" },
] as const;

const InstallBlock: React.FC<{ t: Theme }> = ({ t }) => {
  const [pm, setPm] = useState<string>("pnpm");
  const [copied, setCopied] = useState(false);
  const cmd = PMS.find((x) => x.id === pm)!.cmd;
  return (
    <div
      style={{
        borderRadius: 14,
        border: `1px solid ${t.border}`,
        background: t.panelBg,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          padding: 5,
          gap: 2,
          borderBottom: `1px solid ${t.border}`,
        }}
      >
        {PMS.map((x) => (
          <button
            key={x.id}
            onClick={() => setPm(x.id)}
            style={{
              flex: 1,
              padding: "7px 0",
              border: "none",
              background: pm === x.id ? t.chipBg : "transparent",
              color: pm === x.id ? t.text : t.faint,
              fontFamily: mono,
              fontSize: 12.5,
              fontWeight: 600,
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            {x.id}
          </button>
        ))}
      </div>
      <button
        title="Click to copy"
        onClick={() =>
          navigator.clipboard?.writeText(cmd).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          })
        }
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          boxSizing: "border-box",
          padding: "13px 18px",
          border: "none",
          background: "transparent",
          fontFamily: mono,
          fontSize: 14.5,
          cursor: "pointer",
          color: copied ? "#3fae6a" : t.text,
          textAlign: "left",
        }}
      >
        <span style={{ color: copied ? "#3fae6a" : t.faint }}>$</span>
        <span>{copied ? "copied to clipboard" : cmd}</span>
      </button>
    </div>
  );
};

const Table: React.FC<{ t: Theme; rows: Array<[string, string, string]> }> = ({
  t,
  rows,
}) => (
  <div
    style={{
      overflowX: "auto",
      border: `1px solid ${t.border}`,
      borderRadius: 12,
    }}
  >
    <table
      style={{
        borderCollapse: "collapse",
        width: "100%",
        fontFamily: sans,
        fontSize: 13.5,
      }}
    >
      <tbody>
        {rows.map(([name, type, note], i) => (
          <tr
            key={name}
            style={{
              background:
                i % 2
                  ? t.name === "dark"
                    ? "rgba(255,255,255,0.02)"
                    : "rgba(0,0,0,0.02)"
                  : "transparent",
            }}
          >
            <td
              style={{
                padding: "10px 16px",
                verticalAlign: "top",
                whiteSpace: "nowrap",
              }}
            >
              <code style={{ fontFamily: mono, color: t.text }}>{name}</code>
            </td>
            <td
              style={{
                padding: "10px 16px",
                verticalAlign: "top",
                whiteSpace: "nowrap",
              }}
            >
              <code
                style={{ fontFamily: mono, color: t.faint, fontSize: 12.5 }}
              >
                {type}
              </code>
            </td>
            <td
              style={{
                padding: "10px 16px",
                verticalAlign: "top",
                color: t.sub,
                minWidth: 230,
              }}
            >
              {note}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

// ── Live, interactive hero: a real <Glass> lens follows the cursor and refracts
//    the headline + gradient underneath it. This is the page leading with the
//    product instead of a wall of text. ──
const HERO_LENS = {
  mapSize: 512,
  clipToShape: true,
  softEdge: true,
  strength: 0.06,
  depth: 0.7,
  curvature: 0.62,
  dispersion: 1,
  bend: 0,
  bendWidth: 0.16,
  splay: 0,
  frost: 0.5,
  brightness: 0.06,
  specular: 1.3,
  sheenAngle: 35,
  sheenDark: false,
  sheen: 1,
  sheenWidth: 4,
  sheenFalloff: 1.6,
  glow: 0.22,
  glowSpread: 1,
  glowFalloff: 0.6,
};

const LiveHero: React.FC<{ t: Theme }> = ({ t }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const x = useMemo(() => glassValue(0.4), []);
  const y = useMemo(() => glassValue(0.5), []);
  const target = useRef<{ x: number; y: number } | null>(null);

  // De-oval the in-place bend on this non-square box: objectBoundingBox displaces
  // PER-AXIS, so a wide box bends oval and the disc/veil drift off the refraction.
  // Shrink the long axis's scale to the short one (scaleX/scaleY = strength·min/w,h)
  // — the same correction the playground hero uses. Measured from the box, so it
  // tracks any resize.
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((prev) =>
        prev.w === r.width && prev.h === r.height
          ? prev
          : { w: r.width, h: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const optics = useMemo(() => {
    const { w, h } = box;
    if (!(w > 0 && h > 0)) return HERO_LENS;
    const m = Math.min(w, h);
    return {
      ...HERO_LENS,
      scaleX: (HERO_LENS.strength * m) / w,
      scaleY: (HERO_LENS.strength * m) / h,
    };
  }, [box]);

  useEffect(() => {
    let raf = 0;
    const start = typeof performance !== "undefined" ? performance.now() : 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      let tx: number, ty: number;
      if (target.current) {
        tx = target.current.x;
        ty = target.current.y;
      } else {
        const a = ((now - start) / 1000) * 0.5;
        tx = 0.5 + 0.26 * Math.cos(a);
        ty = 0.5 + 0.14 * Math.sin(a);
      }
      const cx = x.get(),
        cy = y.get();
      const e = target.current ? 0.28 : 0.12;
      x.set(cx + (tx - cx) * e);
      y.set(cy + (ty - cy) * e);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [x, y]);

  const onMove = (e: React.PointerEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (r)
      target.current = {
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
      };
  };

  // A rich abstract wallpaper as the hero backdrop (not a flat CSS gradient): the
  // lens refracts the wallpaper's crisp blades + the headline, so the page leads
  // with the product bending real, high-contrast pixels.
  const content = (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        background: "url(/frames/wallpaper-blue.jpg) center/cover",
      }}
    >
      <span
        style={{
          fontFamily: sans,
          fontWeight: 700,
          letterSpacing: "-0.04em",
          fontSize: "clamp(42px, 8vw, 104px)",
          color: "#fff",
          textShadow: "0 2px 40px rgba(0,0,0,0.45)",
        }}
      >
        Liquid Glass
      </span>
    </div>
  );

  return (
    <div
      ref={boxRef}
      onPointerMove={onMove}
      onPointerLeave={() => (target.current = null)}
      style={{
        position: "relative",
        marginTop: 28,
        height: "min(56vh, 460px)",
        borderRadius: 24,
        overflow: "hidden",
        cursor: "crosshair",
        touchAction: "none",
      }}
    >
      {/* IN-PLACE: the <Glass> WRAPS the wallpaper + headline and bends those very
          pixels — the lens is a moving sub-rect, the real text stays live, no clone.
          NO `pixelUnits`: in-place over a big element needs objectBoundingBox (the
          default) — a userSpaceOnUse region this large blows past Safari's filter-size
          ceiling and WebKit smears the whole element; obb is fraction-based and
          zoom-transparent. The inner sized box gives the (absolute) `content` a flow
          height so the source isn't 0-high. */}
      <Glass
        optics={optics}
        center={{ x, y }}
        size={200}
        radius={100}
        style={{ position: "absolute", inset: 0 }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "min(56vh, 460px)",
          }}
        >
          {content}
        </div>
      </Glass>
    </div>
  );
};

const PROPS: Array<[string, string, string]> = [
  [
    "children",
    "ReactNode",
    "The crisp layer on top (DOM mode: also the wrapped element the lens refracts).",
  ],
  [
    "src / draw",
    "string / fn",
    "A video URL, or a per-frame canvas painter. Either switches Glass to WebGL.",
  ],
  [
    "refract",
    "ReactNode",
    "Refract THIS node instead (a sibling img/video/component); children render crisp on top.",
  ],
  [
    "behind",
    "string",
    'Solid fill behind `refract` / the refraction copy at the bleed edge (default "transparent").',
  ],
  ["optics", "Partial<GlassOptics>", "The look. See Lens Parameters."],
  [
    "width, height",
    "number | motion",
    "Lens size in px (full). Omit to fit the wrapped element.",
  ],
  [
    "size",
    "number | [w, h]",
    "Shorthand for width + height (a number is square).",
  ],
  [
    "radius",
    "number | motion",
    "Corner radius in px. Omit to inherit the element's radius.",
  ],
  [
    "center",
    "{ x, y }",
    "Lens centre, a 0 to 1 fraction of the box. Defaults to centred.",
  ],
  [
    "lenses",
    "GlassSurfaceLens[]",
    "Many lenses over one src/draw surface from one WebGL renderer — e.g. each control of a video player.",
  ],
];

const LENS: Array<[string, string, string]> = [
  [
    "strength",
    "number",
    "Refraction strength. scaleX / scaleY override it per axis.",
  ],
  [
    "depth",
    "number",
    "How far the bend reaches in (0 to 1). It also gates curvature.",
  ],
  ["curvature", "number", "The convex dome (0 to 1). Gated by depth."],
  [
    "dispersion",
    "number",
    "Chromatic aberration, the colour split at the edges.",
  ],
  [
    "bend, bendWidth",
    "number",
    "Extra refraction concentrated at the rim (the 'liquid' lip), and its band width.",
  ],
  ["frost", "number", "Frosted blur inside the lens."],
  [
    "brightness",
    "number",
    "Veil over the glass (negative darkens, positive lightens).",
  ],
  [
    "sheen, sheenWidth, sheenFalloff, sheenAngle",
    "number",
    "The bright directional rim highlight (pools toward sheenAngle).",
  ],
  [
    "glow, glowSpread, glowFalloff",
    "number",
    "The soft inner glow, reaching in from the rim.",
  ],
  [
    "specular",
    "number",
    "Master highlight gain. Scales both sheen and glow at once.",
  ],
];

export const Docs: React.FC = () => {
  const { t, toggle } = useTheme();
  const mobile = useIsMobile();

  const h2: React.CSSProperties = {
    fontFamily: sans,
    fontSize: 23,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: t.text,
    margin: "0 0 16px",
  };
  // Prose keeps a readable measure even on the wide page; the hero, code blocks,
  // and tables span the full content column (more visual, less wall of text).
  const p: React.CSSProperties = {
    fontFamily: sans,
    fontSize: 15.5,
    lineHeight: 1.65,
    color: t.sub,
    margin: "0 0 12px",
    maxWidth: 740,
  };
  const anchor: React.CSSProperties = {
    color: t.text,
    textDecoration: "underline",
    textUnderlineOffset: 3,
    textDecorationColor: t.border,
  };
  const c = (s: string) => (
    <code style={{ fontFamily: mono, color: t.text, fontSize: "0.92em" }}>
      {s}
    </code>
  );
  const section: React.CSSProperties = {
    padding: "40px 0",
    borderTop: `1px solid ${t.border}`,
    scrollMarginTop: 84,
  };
  const Code: React.FC<{ children: string }> = ({ children }) => (
    <pre
      style={{
        margin: 0,
        padding: "18px 20px",
        borderRadius: 14,
        background: t.codeBg,
        border: `1px solid ${t.codeBorder}`,
        overflowX: "auto",
        fontFamily: mono,
        fontSize: 13,
        lineHeight: 1.6,
        color: t.codeText,
      }}
    >
      <code>{tokenize(children)}</code>
    </pre>
  );
  return (
    <div style={{ minHeight: "100vh", background: t.pageBg, color: t.text }}>
      <style>{`html { scroll-behavior: smooth; }`}</style>
      <SiteHeader active="docs" t={t} onToggleTheme={toggle} />
      <main
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: mobile ? "0 18px 80px" : "0 40px 120px",
        }}
      >
        {/* Hero: live demo, full width */}
        <section style={{ padding: "76px 0 0" }}>
          <h1
            style={{
              fontFamily: sans,
              fontSize: "clamp(32px, 5vw, 50px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              color: t.text,
              margin: "0 0 10px",
              lineHeight: 1.05,
            }}
          >
            Liquid Glass for the Web
          </h1>
          <p style={{ ...p, fontSize: 17, maxWidth: 600 }}>
            A headless React lens that refracts the live page. Move your cursor
            over it.
          </p>
          <LiveHero t={t} />
        </section>

        {/* Content (full width) */}
        <div style={{ marginTop: 8 }}>
            <section id="install" style={section}>
              <h2 style={h2}>Install</h2>
              <div style={{ maxWidth: 460 }}>
                <InstallBlock t={t} />
              </div>
              <p style={{ ...p, margin: "16px 0 0" }}>
                React 18+ is the only peer. No CSS to import, and no provider.
                One component to learn: {c("Glass")}.
              </p>
            </section>

            <section id="quick-start" style={section}>
              <h2 style={h2}>Quick start</h2>
              <p style={p}>
                Wrap anything. It refracts with a sensible default look.
              </p>
              <Code>{`import { Glass } from "@samasante/liquid-glass";

// Wrap an element — the lens fits it, no geometry needed.
<Glass><Card /></Glass>;

// Give it geometry to bend its own content in place (cursor can drive the centre).
<Glass size={160} center={{ x: mx, y: my }}>
  <YourContent />
</Glass>;

// Float a lens over content you don't own — refract a copy of it.
<Glass refract={<img src="/photo.jpg" />} width={420} height={84} radius={20}>
  <Notification />
</Glass>;

// A <video> or <canvas> on the GPU — many lenses over one surface.
<Glass src="/clip.mp4" lenses={lenses}>
  <Transport />
</Glass>;`}</Code>
              <p style={{ ...p, margin: "16px 0 0" }}>
                {c("children")} are always the crisp layer on top. A {c("<video>")}{" "}
                or {c("<canvas>")} is sampled on the GPU; everything else refracts
                a copy of pixels you own — which is what makes the bend work in
                Safari and Firefox.
              </p>
            </section>

            <section id="props" style={section}>
              <h2 style={h2}>Props</h2>
              <Table t={t} rows={PROPS} />
              <p style={{ ...p, margin: "14px 0 0" }}>
                Geometry is optional — size {c("<Glass>")} with CSS and the lens
                fits the box. Each geometry prop takes a number or a motion value,
                so you can animate it at 60fps. Video also accepts {c("poster")},{" "}
                {c("loop")}, {c("muted")}, {c("crossOrigin")}, and {c("maxDpr")}.
              </p>
            </section>

            <section id="lens-parameters" style={section}>
              <h2 style={h2}>Lens parameters</h2>
              <Table t={t} rows={LENS} />
              <p style={{ ...p, margin: "14px 0 0" }}>
                {c("depth")} and {c("curvature")} work together: high {c("depth")}{" "}
                magnifies the body, while low {c("depth")} with high{" "}
                {c("curvature")} gives a thin refractive rim.
              </p>
            </section>

            <section id="how-it-works" style={section}>
              <h2 style={h2}>How it works</h2>
              <p style={{ ...p, margin: "0 0 6px" }}>
                A rounded-rect signed-distance field becomes a displacement map.
                Red and green bend the pixels; blue is the highlight. An SVG{" "}
                {c("feDisplacementMap")} (or the WebGL shader) pushes the real
                pixels by that amount, and splits the channels for the edge
                colour.
              </p>
              <p style={{ ...p, margin: 0 }}>
                The WebKit-specific fixes are baked in, so it bends live pixels in
                Safari and Firefox as well as Chrome. See{" "}
                <a href="#acknowledgements" style={anchor}>
                  Acknowledgements
                </a>{" "}
                for the prior art it builds on.
              </p>
            </section>

            <section id="components" style={section}>
              <h2 style={h2}>Components</h2>
              <div
                style={{
                  display: "flex",
                  gap: 24,
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <p style={{ ...p, margin: 0, flex: "1 1 280px" }}>
                  Copy-paste components live in{" "}
                  <a
                    href={`${REPO}/tree/main/examples`}
                    target="_blank"
                    rel="noreferrer"
                    style={anchor}
                  >
                    examples/
                  </a>
                  : a video player, a switch, a slider, a notification, and a
                  context menu. See them on the{" "}
                  <a
                    href="?view=examples"
                    onClick={(e) => {
                      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
                        e.preventDefault();
                        navigate("examples");
                      }
                    }}
                    style={anchor}
                  >
                    Examples
                  </a>{" "}
                  page. MIT licensed.
                </p>
                <a
                  href={REPO}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 16px",
                    borderRadius: 999,
                    border: `1px solid ${t.chipBorder}`,
                    background: t.chipBg,
                    color: t.text,
                    textDecoration: "none",
                    fontFamily: sans,
                    fontSize: 13.5,
                    fontWeight: 600,
                  }}
                >
                  Source on GitHub
                </a>
              </div>
            </section>

            <section id="acknowledgements" style={section}>
              <h2 style={h2}>Acknowledgements</h2>
              <p style={p}>
                An implementation of the SDF displacement-map glass technique that
                Apple popularised as &ldquo;Liquid Glass&rdquo;, following the
                approach Aave&rsquo;s team documented in{" "}
                <a
                  href="https://aave.com/design/building-glass-for-the-web"
                  target="_blank"
                  rel="noreferrer"
                  style={anchor}
                >
                  Building glass for the web
                </a>
                . Thanks also to{" "}
                <a
                  href="https://github.com/AndrewPrifer/liquid-dom"
                  target="_blank"
                  rel="noreferrer"
                  style={anchor}
                >
                  liquid-dom
                </a>{" "}
                for another take on glass in the browser.
              </p>
              <p style={{ ...p, margin: 0 }}>
                Not affiliated with or endorsed by Apple or any project credited
                here.
              </p>
            </section>
          </div>
      </main>
    </div>
  );
};
