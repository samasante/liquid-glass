import React from "react";
import type { Theme } from "../theme";
import { navigate, type View } from "../router";
import { useIsMobile } from "../useMedia";

// Client-side nav on plain click; let modified clicks (new tab / window) and
// middle-click fall through to the real href.
const go = (e: React.MouseEvent, view: View) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0)
    return;
  e.preventDefault();
  navigate(view);
};

const REPO = "https://github.com/samasante/liquid-glass";
const X = "https://x.com/samasante";
const sans =
  "-apple-system, 'SF Pro Text', ui-sans-serif, system-ui, sans-serif";

const GitHubIcon: React.FC = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);
const XIcon: React.FC = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const pressDown = (e: React.PointerEvent) => {
  (e.currentTarget as HTMLElement).style.transform = "scale(0.96)";
};
const pressUp = (e: React.PointerEvent) => {
  (e.currentTarget as HTMLElement).style.transform = "scale(1)";
};
const press = {
  onPointerDown: pressDown,
  onPointerUp: pressUp,
  onPointerLeave: pressUp,
};

export type Page = "playground" | "examples" | "docs";
const NAV: Array<{ id: Page; label: string; href: string }> = [
  { id: "playground", label: "Playground", href: "?view=playground" },
  { id: "examples", label: "Examples", href: "?view=examples" },
  { id: "docs", label: "Docs", href: "?view=docs" },
];

/** The one site header — wordmark, page nav, social pills, theme toggle. Shared
 *  by every page so the chrome is identical everywhere. */
export const SiteHeader: React.FC<{
  active: Page;
  t: Theme;
  onToggleTheme: () => void;
}> = ({ active, t, onToggleTheme }) => {
  const mobile = useIsMobile();
  const pill: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: 34,
    padding: mobile ? 0 : "0 13px",
    width: mobile ? 34 : undefined,
    borderRadius: 999,
    border: `1px solid ${t.chipBorder}`,
    background: t.chipBg,
    color: t.text,
    textDecoration: "none",
    boxSizing: "border-box",
    fontFamily: sans,
    fontSize: 13,
    fontWeight: 600,
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    cursor: "pointer",
    transition: "transform 0.12s ease",
  };
  const navLink = (current: boolean): React.CSSProperties => ({
    color: current ? t.text : t.sub,
    textDecoration: "none",
    fontSize: 13.5,
    fontWeight: current ? 600 : 500,
  });
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 70,
        display: "flex",
        alignItems: "center",
        gap: mobile ? 10 : 18,
        padding: mobile ? "12px 14px" : "14px 22px",
        background: t.headerBg,
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: `1px solid ${t.border}`,
        fontFamily: sans,
      }}
    >
      <a
        href="?view=playground"
        onClick={(e) => go(e, "playground")}
        style={{
          fontWeight: 600,
          fontSize: 15.5,
          letterSpacing: -0.3,
          color: t.text,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        {!mobile && <span style={{ color: t.sub }}>@samasante/</span>}
        liquid-glass
      </a>
      <nav
        style={{
          display: "flex",
          gap: mobile ? 14 : 20,
          alignItems: "center",
          marginLeft: mobile ? 4 : 14,
        }}
      >
        {NAV.map((n) => (
          <a
            key={n.id}
            href={n.href}
            onClick={(e) => go(e, n.id)}
            style={navLink(active === n.id)}
          >
            {n.label}
          </a>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: mobile ? 8 : 10, alignItems: "center" }}>
        {!mobile && (
          <a href={X} target="_blank" rel="noreferrer" {...press} style={pill}>
            <XIcon /> Follow
          </a>
        )}
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          {...press}
          style={pill}
        >
          <GitHubIcon /> {!mobile && "GitHub"}
        </a>
        <button
          onClick={onToggleTheme}
          aria-label="Toggle light / dark"
          title="Toggle light / dark"
          {...press}
          style={{ ...pill, width: 34, padding: 0 }}
        >
          {t.name === "dark" ? (
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
};
