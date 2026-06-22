/**
 * A tiny reactive scalar ("signal") used to drive lens geometry imperatively,
 * plus the easing + tween helpers built on top of it. Lets `<Glass>` accept
 * animated geometry without pulling in framer-motion: anything exposing
 * `{ get(); on('change', cb) }` — a {@link LensSignal} here, or a real
 * framer-motion `MotionValue` — is a valid {@link GlassValue}.
 */

export interface GlassMotionValue {
  get(): number;
  set(value: number): void;
  on(event: "change", callback: (value: number) => void): () => void;
}

export type GlassValue = number | GlassMotionValue;

/** Duck-type test: a `get`/`on` pair marks a reactive value vs a plain number. */
export const isGlassMotionValue = (value: unknown): value is GlassMotionValue =>
  typeof value === "object" &&
  value !== null &&
  "get" in value &&
  "on" in value;

/** Read the current scalar whether `value` is a signal or a literal number. */
export const readGlassValue = (value: GlassValue): number =>
  isGlassMotionValue(value) ? value.get() : value;

/**
 * Observable scalar. Subscribers are notified only when the value actually
 * changes; `on` returns its own detach function. A class (rather than a closure
 * over a Set) keeps each instance's state on the prototype and the subscriber
 * list compact for the per-frame writes during a drag.
 */
class LensSignal implements GlassMotionValue {
  private current: number;
  private readonly subscribers: Array<(value: number) => void> = [];

  constructor(initial: number) {
    this.current = initial;
  }

  get(): number {
    return this.current;
  }

  set(next: number): void {
    if (next === this.current) return;
    this.current = next;
    // Notify over a snapshot so a subscriber that detaches itself (or a sibling)
    // mid-dispatch can't make the loop skip another — a published primitive must
    // be safe against self-unsubscribe during a change.
    for (const notify of this.subscribers.slice()) notify(next);
  }

  on(_event: "change", callback: (value: number) => void): () => void {
    this.subscribers.push(callback);
    return () => {
      const at = this.subscribers.indexOf(callback);
      if (at !== -1) this.subscribers.splice(at, 1);
    };
  }
}

/** Create a reactive scalar seeded with `initial`. */
export const glassValue = (initial: number): GlassMotionValue =>
  new LensSignal(initial);

/**
 * A signal computed from other signals (framer-motion's `useTransform`
 * equivalent): seeded with `compute()` and recomputed whenever any input fires.
 */
export const deriveGlass = (
  deps: GlassMotionValue[],
  compute: () => number,
): GlassMotionValue => {
  const derived = glassValue(compute());
  const recompute = () => derived.set(compute());
  for (const dep of deps) dep.on("change", recompute);
  return derived;
};

/**
 * Cubic-bezier easing with the same contract as CSS `cubic-bezier()`.
 *
 * Uses the classic UnitBezier formulation (precomputed polynomial coefficients
 * `a/b/c` per axis, then Newton–Raphson with a bisection fallback) — the
 * reference technique browsers themselves use to invert x→t before reading y.
 * Control points outside [0,1] on the y-axis produce intended overshoot.
 */
export const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const curveX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const curveY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;

  const solveForT = (x: number) => {
    let t = x;
    // Newton–Raphson: fast where the curve is well-behaved.
    for (let i = 0; i < 8; i += 1) {
      const offset = curveX(t) - x;
      if (Math.abs(offset) < 1e-6) return t;
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= offset / slope;
    }
    // Bisection fallback: guaranteed to converge inside the unit interval.
    let lo = 0;
    let hi = 1;
    t = x;
    while (lo < hi) {
      const sampled = curveX(t);
      if (Math.abs(sampled - x) < 1e-6) break;
      if (sampled < x) lo = t;
      else hi = t;
      if (hi - lo < 1e-7) break;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return curveY(solveForT(x));
  };
};

/** Our default control easing — a gentle overshoot on settle. */
export const glassEase = cubicBezier(0.34, 1.36, 0.42, 1);

export interface GlassAnimation {
  stop(): void;
}

// One in-flight tween per signal: starting a new one cancels the previous, so a
// re-target mid-flight (expand interrupted by collapse) hands off cleanly.
const inFlight = new WeakMap<GlassMotionValue, GlassAnimation>();

export const animateGlassValue = (
  value: GlassMotionValue,
  to: number,
  {
    duration = 0.3,
    ease = glassEase,
    onComplete,
  }: {
    duration?: number;
    ease?: (t: number) => number;
    onComplete?: () => void;
  } = {},
): GlassAnimation => {
  inFlight.get(value)?.stop();
  const from = value.get();
  if (from === to || duration <= 0) {
    value.set(to);
    onComplete?.();
    return { stop() {} };
  }

  const durationMs = duration * 1000;
  let frame = 0;
  let startedAt = 0;

  const advance = (now: number) => {
    if (startedAt === 0) startedAt = now;
    const progress = (now - startedAt) / durationMs;
    if (progress >= 1) {
      value.set(to);
      inFlight.delete(value);
      onComplete?.();
      return;
    }
    value.set(from + (to - from) * ease(progress));
    frame = requestAnimationFrame(advance);
  };
  frame = requestAnimationFrame(advance);

  const handle: GlassAnimation = {
    stop() {
      cancelAnimationFrame(frame);
      inFlight.delete(value);
    },
  };
  inFlight.set(value, handle);
  return handle;
};
