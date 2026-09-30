// Hand-drawn marks: round-capped SVG strokes that draw themselves the way a pen would, and
// appear instantly when `draw` is false (going back, reduced motion).
import { motion } from "motion/react";
import type { CSSProperties } from "react";

/** A loose loop drawn around a value, overshooting where the pen closes it. */
const RING = "M 16 7 C 42 -1 88 1 96 17 C 101 31 72 39 46 38 C 17 37 1 30 4 18 C 6 9 24 3 44 4";

interface RingProps {
  draw: boolean;
  /** Seconds to wait before drawing: red-pen marks land after the values they judge. */
  delay?: number;
  className?: string;
  style?: CSSProperties;
}

/** The red pen's ring, stretched over the box it sits in. */
export function PenRing({ draw, delay = 0, className = "", style }: RingProps) {
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={`pointer-events-none overflow-visible ${className}`}
      style={style}
    >
      <motion.path
        d={RING}
        fill="none"
        stroke="var(--color-red-pen)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        initial={draw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.52, ease: "easeInOut", delay }}
      />
    </svg>
  );
}

/** The graphite tick drawn over a done step's box. */
export function DoneTick({ draw }: { draw: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="done-tick">
      <motion.path
        d="M 3 8.5 L 6.5 12 L 13 3.5"
        fill="none"
        stroke="var(--color-graphite)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={draw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      />
    </svg>
  );
}

/** A printed arrow pointing along the reading direction; it mirrors in RTL. */
export function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={`size-4 shrink-0 ${back ? "rtl:-scale-x-100" : "-scale-x-100 rtl:scale-x-100"}`}
    >
      <path
        d="M10 3 5 8l5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
