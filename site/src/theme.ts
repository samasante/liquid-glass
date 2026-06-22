import { useEffect, useState } from "react";

/**
 * One shared light/dark palette for the whole site, so every page (playground,
 * examples, docs) renders the same chrome. The theme is persisted in
 * localStorage and read on mount, so it survives the `?view=` full-page
 * navigations (each page is its own document).
 */
export interface Theme {
  name: "dark" | "light";
  pageBg: string;
  panelBg: string; // subtle raised card surface
  text: string; // primary text
  sub: string; // secondary text
  faint: string; // tertiary / dim
  border: string; // hairline borders
  headerBg: string; // sticky header (translucent)
  chipBg: string;
  chipBorder: string;
  codeBg: string;
  codeBorder: string;
  codeText: string;
  accent: string; // blue accent
  primaryBg: string; // solid button
  primaryText: string;
  footer: string;
  dots: string; // dot-grid background-image
}

export const DARK: Theme = {
  name: "dark",
  pageBg: "#060607",
  panelBg: "rgba(255,255,255,0.025)",
  text: "#fff",
  sub: "rgba(255,255,255,0.6)",
  faint: "rgba(255,255,255,0.42)",
  border: "rgba(255,255,255,0.1)",
  headerBg: "rgba(6,6,7,0.72)",
  chipBg: "rgba(255,255,255,0.05)",
  chipBorder: "rgba(255,255,255,0.14)",
  codeBg: "#0b0b0e",
  codeBorder: "rgba(255,255,255,0.1)",
  codeText: "#d7dbe6",
  accent: "#4c9aff",
  primaryBg: "#fff",
  primaryText: "#0a0b0d",
  footer: "rgba(255,255,255,0.4)",
  dots: "radial-gradient(rgba(220,228,246,0.16) 1.1px, transparent 1.6px)",
};

export const LIGHT: Theme = {
  name: "light",
  pageBg: "#eef0f5",
  panelBg: "rgba(255,255,255,0.66)",
  text: "#0a0b0d",
  sub: "rgba(0,0,0,0.6)",
  faint: "rgba(0,0,0,0.42)",
  border: "rgba(0,0,0,0.1)",
  headerBg: "rgba(238,240,245,0.72)",
  chipBg: "rgba(255,255,255,0.66)",
  chipBorder: "rgba(0,0,0,0.12)",
  // Code blocks stay dark in both schemes (the syntax colours are tuned for it,
  // and a dark code card reads well on a light page too).
  codeBg: "#0b0b0e",
  codeBorder: "rgba(0,0,0,0.12)",
  codeText: "#d7dbe6",
  accent: "#0a84ff",
  primaryBg: "#0a0b0d",
  primaryText: "#fff",
  footer: "rgba(0,0,0,0.42)",
  dots: "radial-gradient(rgba(58,86,210,0.2) 1.2px, transparent 1.7px)",
};

const KEY = "lg-theme";

/** Site theme state, persisted to localStorage (default dark). */
export const useTheme = () => {
  const [dark, setDark] = useState(true);
  // Read the stored preference on mount (SSR-safe: defaults to dark first paint).
  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v === "light") setDark(false);
    } catch {
      /* ignore */
    }
  }, []);
  const toggle = () =>
    setDark((d) => {
      const next = !d;
      try {
        localStorage.setItem(KEY, next ? "dark" : "light");
      } catch {
        /* ignore */
      }
      return next;
    });
  return { dark, t: dark ? DARK : LIGHT, toggle };
};
