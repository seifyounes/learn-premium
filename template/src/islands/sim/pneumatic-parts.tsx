// The parts of a pneumatic circuit that move, drawn over the schematic: each valve's pair of boxes
// slid so the box for its state sits over its ports (a 5/2 valve's pilot leads stretching to follow),
// and each piston and rod at its travel. In drawing px, laid over the layout core's drawing, which
// holds only what never moves. Spools slide by motion (instant under reduced motion); a piston is
// redrawn each frame from the engine's whole-ms travel, so it needs no motion library.
import { motion } from "motion/react";
import type { Drawing } from "../../sims/layout/drawing.ts";
import { cylinderMoving, pairPath, pilotLeads, valveOffset } from "../../sims/layout/pneumatic.ts";
import { transformOf } from "../../sims/layout/symbols.ts";
import { STROKE_MS, type PneumaticModel, type State } from "../../sims/pneumatic/engine.ts";

interface Props {
  drawing: Drawing;
  model: PneumaticModel;
  state: State;
}

/** How long a spool takes to slide, in seconds. */
const SLIDE = { duration: 0.16, ease: "easeOut" } as const;

export function PneumaticParts({ drawing, model, state }: Props) {
  return (
    <g className="pneumatic-parts">
      {drawing.parts.map((placed) => {
        const part = model.parts.find((p) => p.id === placed.id);
        if (!part) return null;
        if (part.kind === "valve-52") {
          const side = state.spools[part.id] ?? "12";
          const offset = valveOffset(part.kind, side);
          const pair = pairPath(part.kind);
          return (
            <g key={part.id} transform={transformOf(placed)} data-valve={part.id}>
              <motion.path
                className="pneumatic-pilot"
                initial={false}
                animate={{ d: pilotLeads(offset) }}
                transition={SLIDE}
              />
              <motion.g
                data-spool={part.id}
                data-side={side}
                initial={false}
                animate={{ x: offset }}
                transition={SLIDE}
              >
                <path className="pneumatic-moving" d={pair.d} />
                <path className="pneumatic-fill" d={pair.fill} />
              </motion.g>
            </g>
          );
        }
        if (part.kind === "valve-32-roller" || part.kind === "valve-32-button") {
          const made = state.made[part.id] === 1;
          const pair = pairPath(part.kind);
          return (
            <g key={part.id} transform={transformOf(placed)} data-valve={part.id}>
              <motion.g
                data-spool={part.id}
                data-side={made ? "made" : "freed"}
                initial={false}
                animate={{ x: valveOffset(part.kind, made ? "made" : "freed") }}
                transition={SLIDE}
              >
                <path className="pneumatic-moving" d={pair.d} />
                <path className="pneumatic-fill" d={pair.fill} />
              </motion.g>
            </g>
          );
        }
        if (part.kind === "cylinder") {
          const fraction = (state.travel[part.id] ?? 0) / STROKE_MS;
          const moving = cylinderMoving(fraction);
          return (
            <g key={part.id} transform={transformOf(placed)} data-piston={part.id} data-travel={fraction.toFixed(3)}>
              <path className="pneumatic-moving" d={moving.d} />
              <path className="pneumatic-fill" d={moving.fill} />
            </g>
          );
        }
        return null;
      })}
    </g>
  );
}
