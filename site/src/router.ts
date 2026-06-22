import { useSyncExternalStore } from "react";

/**
 * Tiny client-side router for the `?view=` pages. Swapping views updates the URL
 * with `history.pushState` and re-renders the app in place — no full-page reload
 * (the JS bundle + glass engine stay warm), so nav is instant. Back/forward work
 * via `popstate`. The theme already persists in localStorage, so it survives.
 */
export type View = "playground" | "examples" | "docs";

const VIEWS: readonly string[] = ["playground", "examples", "docs"];

const parse = (): View => {
  if (typeof location === "undefined") return "playground";
  const v = new URLSearchParams(location.search).get("view") ?? "";
  return VIEWS.includes(v) ? (v as View) : "playground";
};

let current: View = parse();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** Navigate to a view client-side (no reload). Cmd/ctrl-click is handled by the
 *  caller so it can still open a real new tab. */
export const navigate = (view: View) => {
  if (view === current) return;
  current = view;
  if (typeof history !== "undefined")
    history.pushState(null, "", `?view=${view}`);
  emit();
};

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    const next = parse();
    if (next !== current) {
      current = next;
      emit();
    }
  });
}

const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
};

/** The current view; re-renders the component on client-side navigation. */
export const useView = (): View =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
