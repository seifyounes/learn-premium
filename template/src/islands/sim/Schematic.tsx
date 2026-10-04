// A schematic drawn on the sheet from the layout core's drawing: symbols in graphite, labels in
// Atkinson Mono, wires in pencil. A wire whose net is high is inked over in graphite, drawing
// itself along the wire as it turns high; one already high stays put, and the drawing the page
// opens on is inked at once (and every change, under reduced motion). Drawn at its own size, never
// scaled, so labels stay at 13px; a wide drawing scrolls inside its box.
import { motion } from "motion/react";
import type { Drawing } from "../../sims/layout/drawing.ts";
import { LABEL_PX } from "../../sims/layout/drawing.ts";
import { symbolOf, transformOf } from "../../sims/layout/symbols.ts";

interface Props {
  drawing: Drawing;
  /** Each wire's net and each dot's, read from geometry at build. */
  nets: { wires: (string | undefined)[]; dots: (string | undefined)[] };
  /** Whether a net carries a 1. */
  high: (net: string | undefined) => boolean;
  /** Whether a wire turning high draws itself in: false for the drawing the page opens on. */
  draw: boolean;
  /** Terminals to fill when their net is high, by part id. */
  terminalNets: Readonly<Record<string, string | undefined>>;
  label: string;
}

/** How long a wire takes to ink in, in seconds. */
const INK_IN = 0.45;

export function Schematic({ drawing, nets, high, draw, terminalNets, label }: Props) {
  const points = (w: Drawing["wires"][number]) => w.points.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <svg
      className="schematic"
      width={drawing.width}
      height={drawing.height}
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      role="img"
      aria-label={label}
    >
      <g className="schematic-wires">
        {drawing.wires.map((w, i) => (
          <polyline key={i} className="schematic-wire" points={points(w)} />
        ))}
      </g>
      <g className="schematic-ink">
        {drawing.wires.map((w, i) =>
          high(nets.wires[i]) ? (
            <motion.polyline
              key={i}
              className="schematic-wire is-high"
              data-net={nets.wires[i]}
              points={points(w)}
              initial={draw ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: INK_IN, ease: "easeOut" }}
            />
          ) : null,
        )}
        {drawing.dots.map(([x, y], i) => (
          <circle
            key={`${x},${y}`}
            className={`schematic-dot${high(nets.dots[i]) ? " is-high" : ""}`}
            cx={x}
            cy={y}
            r={3.5}
          />
        ))}
      </g>
      {drawing.parts.map((part) => {
        const def = symbolOf(part.kind);
        const terminalHigh = part.id in terminalNets && high(terminalNets[part.id]);
        return (
          <g key={part.id} data-part={part.id}>
            <g transform={transformOf(part)} className="schematic-symbol">
              {def.leads && <path className="schematic-lead" d={def.leads} />}
              {def.body && <path d={def.body} />}
              {def.fill && <path className="schematic-fill" d={def.fill} />}
              {def.circles?.map(([cx, cy, r]) => (
                <circle
                  key={`${cx},${cy}`}
                  className={`schematic-circle${terminalHigh ? " is-high" : ""}`}
                  cx={cx}
                  cy={cy}
                  r={r}
                />
              ))}
            </g>
            {part.label && (
              <text className="schematic-label" x={part.label.x} y={part.label.y} fontSize={LABEL_PX}>
                {part.label.text}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
