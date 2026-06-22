import React, { useEffect, useRef } from "react";
import { GlassMotionValue } from "./signal";

/**
 * Opt-in motion helpers for building interactive glass controls: a
 * velocity-driven squash-and-stretch spring, a rubber-band easing for
 * over-drag, and a transform-only motion div. None are required to use
 * `<Glass>` — recipes use them to make a control feel alive.
 */

// Spring + response tuning for the wobble. The stretch target rises with the
// pointer speed (sub-linear, so fast flicks don't blow out) and is held while
// pressed; the spring chases it underdamped for a little bounce on release.
const SPRING_STIFFNESS = 176;
const SPRING_DAMPING = 13.6;
const STRETCH_CEILING = 0.34;
// target ≈ speed^SPEED_SHAPE / SPEED_DIVISOR  (≈ 0.0119 · speed^0.75)
const SPEED_SHAPE = 0.75;
const SPEED_DIVISOR = 84;
// dt is clamped before integrating (a backgrounded tab returns a huge gap) and
// again, tighter, when differencing position into velocity.
const MAX_STEP = 0.033;
const VEL_DT_MIN = 0.008;
const VEL_DT_MAX = 0.03;

/**
 * Velocity-driven squash-and-stretch spring. Watches a position signal, derives
 * its velocity, and runs an underdamped spring on `stretch` toward
 * `min(STRETCH_CEILING, max(speed-response, hold))`. While `holdRef.current` > 0
 * (press-and-hold) the lens stays stretched. `stretch` then drives
 * lensW · (1 − 0.2·s) and lensH · (1 + 0.4·s).
 */
export const useLensWobble = (
  position: GlassMotionValue,
  stretch: GlassMotionValue,
  holdRef: React.MutableRefObject<number>,
  kickRef: React.MutableRefObject<() => void>,
) => {
  useEffect(() => {
    let frame = 0;
    let displacement = 0;
    let speedValue = 0; // d(displacement)/dt
    let prevStamp = 0;
    let prevPosition = position.get();
    let active = false;

    const stretchTarget = (pointerSpeed: number) => {
      const fromSpeed = Math.pow(pointerSpeed, SPEED_SHAPE) / SPEED_DIVISOR;
      const responsive =
        fromSpeed < STRETCH_CEILING ? fromSpeed : STRETCH_CEILING;
      const held = holdRef.current;
      const raised = responsive > held ? responsive : held;
      return raised < STRETCH_CEILING ? raised : STRETCH_CEILING;
    };

    const settled = (pointerSpeed: number) =>
      Math.abs(displacement) < 6e-4 &&
      Math.abs(speedValue) < 6e-3 &&
      pointerSpeed < 6e-3 &&
      holdRef.current === 0;

    const step = (now: number) => {
      const gap = (now - prevStamp) / 1e3;
      const dt = gap < MAX_STEP ? gap : MAX_STEP;
      prevStamp = now;

      const pos = position.get();
      const velDt =
        gap < VEL_DT_MIN ? VEL_DT_MIN : gap > VEL_DT_MAX ? VEL_DT_MAX : gap;
      const pointerSpeed = Math.abs((pos - prevPosition) / velDt);
      prevPosition = pos;

      const target = stretchTarget(pointerSpeed);
      // Explicit Euler on a damped harmonic oscillator about `target`.
      const accel =
        SPRING_STIFFNESS * (target - displacement) -
        SPRING_DAMPING * speedValue;
      speedValue += accel * dt;
      displacement += speedValue * dt;
      stretch.set(displacement);

      if (settled(pointerSpeed)) {
        active = false;
        stretch.set(0);
        return;
      }
      frame = requestAnimationFrame(step);
    };

    const begin = () => {
      if (active) return;
      active = true;
      prevStamp = performance.now();
      prevPosition = position.get();
      frame = requestAnimationFrame(step);
    };

    kickRef.current = begin;
    const detach = position.on("change", begin);
    return () => {
      detach();
      cancelAnimationFrame(frame);
      kickRef.current = () => {};
    };
  }, [position, stretch, holdRef, kickRef]);
};

/**
 * Rubber-band overshoot for dragging past the ends — a cubic ease-out of the
 * normalized excess, expanded inline (1−(1−t)³ = t·(3 + t·(t−3))).
 */
export const rubberBand = (excess: number, limit: number, range: number) => {
  const t = excess < range ? excess / range : 1;
  return limit * t * (3 + t * (t - 3));
};

/**
 * Minimal motion.div: composes translateX/scale from signals without
 * re-rendering (the glass controls animate at 60fps during interaction).
 */
export const GlassDiv = React.forwardRef<
  HTMLDivElement,
  {
    x?: GlassMotionValue;
    scaleX?: GlassMotionValue;
    scaleY?: GlassMotionValue;
  } & React.HTMLAttributes<HTMLDivElement>
>(({ x, scaleX, scaleY, style, children, ...rest }, forwardedRef) => {
  const nodeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const sources = [x, scaleX, scaleY].filter(
      (v): v is GlassMotionValue => v != null,
    );
    const compose = () => {
      let transform = "";
      if (x) transform = `translateX(${x.get()}px)`;
      if (scaleX || scaleY) {
        const sx = scaleX ? scaleX.get() : 1;
        const sy = scaleY ? scaleY.get() : 1;
        transform += `${transform ? " " : ""}scale(${sx}, ${sy})`;
      }
      node.style.transform = transform;
    };
    compose();
    const detaches = sources.map((v) => v.on("change", compose));
    return () => detaches.forEach((off) => off());
  }, [x, scaleX, scaleY]);

  return (
    <div
      ref={(node) => {
        nodeRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
});
GlassDiv.displayName = "GlassDiv";
