import { useEffect, useState } from "react";

/** Subscribe to a media query (SSR-safe: false on the server / first paint). */
export const useMediaQuery = (query: string): boolean => {
  // Lazy-init from matchMedia so the first client paint already has the right
  // value (no desktop→mobile flash); falls back to false on the server.
  const [match, setMatch] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatch(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return match;
};

/** True on phone-width viewports — the breakpoint where the floating control
 *  panels stop fitting and the hero needs to scale down. */
export const useIsMobile = (): boolean => useMediaQuery("(max-width: 760px)");
