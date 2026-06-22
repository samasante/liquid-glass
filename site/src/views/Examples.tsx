import React, { useState } from "react";
import { SiteHeader } from "../components/SiteHeader";
import { useTheme, type Theme } from "../theme";
import { GlassSwitch } from "../../../examples/GlassSwitch";
import { GlassSlider } from "../../../examples/GlassSlider";
import { GlassNotification } from "../../../examples/GlassNotification";
import { GlassContextMenu } from "../../../examples/GlassContextMenu";
import { GlassVideoControls } from "../../../examples/GlassVideoControls";
import { GlassCanvasTile } from "../components/SurfaceTiles";

const REPO = "https://github.com/samasante/liquid-glass";
const EXAMPLES = `${REPO}/tree/main/examples`;
const sans =
  "-apple-system, 'SF Pro Display', ui-sans-serif, system-ui, sans-serif";
const mono = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace";

/** Inline code/tag chip — a subtle pill so `<Glass>` / `<video>` read as code. */
const Code: React.FC<{ t: Theme; children: React.ReactNode }> = ({
  t,
  children,
}) => (
  <code
    style={{
      fontFamily: mono,
      fontSize: "0.84em",
      padding: "1.5px 6px",
      borderRadius: 6,
      background:
        t.name === "dark" ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)",
      border: `1px solid ${t.border}`,
      color: t.text,
      whiteSpace: "nowrap",
    }}
  >
    {children}
  </code>
);

const CodeIcon: React.FC = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m8 6-6 6 6 6M16 6l6 6-6 6" />
  </svg>
);

/** One tile: a framed demo area + a caption with a "view source" link. The demo
 *  area either bleeds (child fills it edge-to-edge — surfaces & panels) or pads &
 *  centres the child on a subtle surface (the small controls). */
const Tile: React.FC<{
  t: Theme;
  title: string;
  sub: string;
  href: string;
  /** aspect for a full-bleed demo (surfaces / panels). */
  aspect?: string;
  /** centre the child on a padded surface instead of bleeding (controls). */
  center?: boolean;
  children: React.ReactNode;
}> = ({ t, title, sub, href, aspect = "16 / 9", center, children }) => (
  <div
    style={{
      border: `1px solid ${t.border}`,
      borderRadius: 18,
      overflow: "hidden",
      background: t.panelBg,
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
    }}
  >
    {center ? (
      <div
        style={{
          minHeight: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          background:
            t.name === "dark" ? "rgba(0,0,0,0.25)" : "rgba(0,0,0,0.03)",
        }}
      >
        {children}
      </div>
    ) : (
      <div style={{ width: "100%", aspectRatio: aspect, overflow: "hidden" }}>
        {children}
      </div>
    )}
    <div
      style={{
        padding: "16px 20px",
        borderTop: `1px solid ${t.border}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
      }}
    >
      <div>
        <div
          style={{
            fontFamily: sans,
            fontSize: 15.5,
            fontWeight: 600,
            color: t.text,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: sans,
            fontSize: 13.5,
            color: t.sub,
            marginTop: 3,
          }}
        >
          {sub}
        </div>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title="View the source on GitHub"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          fontFamily: sans,
          fontSize: 13.5,
          fontWeight: 600,
          color: t.text,
          textDecoration: "none",
          whiteSpace: "nowrap",
          padding: "9px 16px",
          borderRadius: 999,
          border: `1px solid ${t.border}`,
          background: t.chipBg,
        }}
      >
        <CodeIcon /> Source
      </a>
    </div>
  </div>
);

const Section: React.FC<{
  t: Theme;
  title: string;
  note: string;
  children: React.ReactNode;
  cols: string;
}> = ({ t, title, note, children, cols }) => (
  <section style={{ marginTop: 60 }}>
    <h2
      style={{
        fontFamily: sans,
        fontSize: 23,
        fontWeight: 650,
        letterSpacing: "-0.02em",
        color: t.text,
        margin: 0,
      }}
    >
      {title}
    </h2>
    <p
      style={{
        fontFamily: sans,
        fontSize: 14.5,
        lineHeight: 1.5,
        color: t.sub,
        margin: "7px 0 0",
        maxWidth: 540,
      }}
    >
      {note}
    </p>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: cols,
        gap: 22,
        marginTop: 22,
      }}
    >
      {children}
    </div>
  </section>
);

export const Examples: React.FC = () => {
  const { t, toggle } = useTheme();
  const [on, setOn] = useState(true);
  const [v, setV] = useState(62);
  const controlSurface = t.name === "dark" ? "#0a0a0c" : "#e9ebf0";

  return (
    <div style={{ minHeight: "100vh", background: t.pageBg, color: t.text }}>
      <SiteHeader active="examples" t={t} onToggleTheme={toggle} />
      <main
        style={{ maxWidth: 1060, margin: "0 auto", padding: "64px 24px 110px" }}
      >
        <h1
          style={{
            fontFamily: sans,
            fontSize: "clamp(32px, 5vw, 50px)",
            fontWeight: 700,
            letterSpacing: "-0.035em",
            color: t.text,
            margin: 0,
          }}
        >
          Examples
        </h1>
        <p
          style={{
            fontFamily: sans,
            fontSize: 18,
            lineHeight: 1.55,
            color: t.sub,
            margin: "14px 0 0",
            maxWidth: 730,
          }}
        >
          Real, restylable UI built on <Code t={t}>&lt;Glass&gt;</Code>. Frosted
          panels, interactive controls and a video player, each refracting live
          content. Every one is a full, accessible component; copy it and own it.
        </p>

        <Section
          t={t}
          cols="repeat(auto-fit, minmax(min(100%, 460px), 1fr))"
          title="Video & Canvas"
          note="Safari won't SVG-filter a live video or canvas, so each runs on one WebGL renderer that samples the source and draws its lenses. Move the pointer over the canvas to steer it."
        >
          <Tile
            t={t}
            title="Video player"
            sub="Each transport control is a lens bending the live video"
            href={`${EXAMPLES}/GlassVideoControls.tsx`}
          >
            <GlassVideoControls src="/frames/clip.mp4" />
          </Tile>
          <Tile
            t={t}
            title="Canvas"
            sub="A lens roaming over a generative canvas scene"
            href={`${REPO}/blob/main/site/src/components/SurfaceTiles.tsx`}
          >
            <GlassCanvasTile />
          </Tile>
        </Section>

        <Section
          t={t}
          cols="repeat(auto-fit, minmax(min(100%, 460px), 1fr))"
          title="Components"
          note="Frosted glass panels that truly refract the wallpaper behind them, not a flat backdrop blur. Set the background once; content sits crisp on top."
        >
          <Tile
            t={t}
            title="Notification"
            sub="A frosted glass card over a wallpaper"
            href={`${EXAMPLES}/GlassNotification.tsx`}
            aspect="16 / 10"
          >
            <GlassNotification wallpaper="url(/frames/wallpaper-blue.jpg)" />
          </Tile>
          <Tile
            t={t}
            title="Context menu"
            sub="A glass menu over a wallpaper; right-click to move it"
            href={`${EXAMPLES}/GlassContextMenu.tsx`}
            aspect="16 / 10"
          >
            <GlassContextMenu wallpaper="url(/frames/wallpaper-purple.jpg)" />
          </Tile>
        </Section>

        <Section
          t={t}
          cols="repeat(auto-fit, minmax(min(100%, 300px), 1fr))"
          title="Controls"
          note="Interactive controls where the moving part dissolves into a lens that bends the track through it."
        >
          <Tile
            t={t}
            title="Switch"
            sub="Press or drag, and the pill melts into a lens"
            href={`${EXAMPLES}/GlassSwitch.tsx`}
            center
          >
            <GlassSwitch
              checked={on}
              onCheckedChange={setOn}
              width={84}
              height={32}
              tintBlur={5}
              scheme={t.name}
              trackColor={t.name === "dark" ? "#3a3a40" : "#c7c7cf"}
              activeColor="#0a84ff"
              surface={controlSurface}
              ariaLabel="Demo switch"
            />
          </Tile>
          <Tile
            t={t}
            title="Slider"
            sub="The thumb bends the fill through it"
            href={`${EXAMPLES}/GlassSlider.tsx`}
            center
          >
            <GlassSlider
              value={v}
              onValueChange={setV}
              min={0}
              max={100}
              width={280}
              thumbHeight={24}
              thumbWidth={38}
              height={6}
              tintBlur={4}
              scheme={t.name}
              trackColor={t.name === "dark" ? "#3a3a40" : "#c7c7cf"}
              activeColor="#0a84ff"
              surface={controlSurface}
              ariaLabel="Demo slider"
            />
          </Tile>
        </Section>
      </main>
    </div>
  );
};
