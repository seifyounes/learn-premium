// The plane-wall sim's JSXGraph board, drawn in the pad's inks (`board.ts`): the temperature
// across the wall at the chosen time, between its start (the whole wall at its initial
// temperature) and where it settles (the faces' temperature), both dashed, with the probes the
// Professor's table reads. Nothing on it is dragged: time and diffusivity are tuned by slider, so
// a swipe on the board always scrolls the page.
import type JXGModule from "jsxgraph";
import { PROBES, type Model, type Profile } from "../../sims/plane-wall/engine.ts";
import { asBackdrop, makeBoard, tickSpacing, type Board, type Box, type Inks, type JXG } from "./board.ts";

type Curve = JXGModule.Curve;
type Point = JXGModule.Point;

export interface WallBoard {
  board: Board;
  draw(profile: Profile): void;
}

export function wallBoard(JXG: JXG, el: HTMLElement, { model, inks }: { model: Model; inks: Inks }): WallBoard {
  const { thickness: L, initial, surface } = model;
  const low = Math.min(initial, surface);
  const high = Math.max(initial, surface);
  const span = high - low;
  // The temperature axis crosses on a tick at or below the coldest the wall gets.
  const spacing: [number, number] = [tickSpacing(L * 1.16), tickSpacing(span * 1.2)];
  const cross: [number, number] = [0, Math.floor(low / spacing[1]) * spacing[1]];
  // The length axis's name sits under the board (`PlaneWallSim`), so the box ends just past the far face.
  const box: Box = [-L * 0.08, high + span * 0.1, L * 1.08, cross[1] - span * 0.06];
  const board = makeBoard(JXG, el, box, inks, { cross, spacing });

  board.suspendUpdate();
  const dashed = (y: number) =>
    asBackdrop(
      board.create(
        "curve",
        [
          [0, L],
          [y, y],
        ],
        {
          strokeColor: inks.pencil,
          strokeWidth: 1,
          strokeOpacity: 0.7,
          dash: 2,
          highlight: false,
          fixed: true,
        },
      ),
    );
  dashed(initial);
  dashed(surface);
  // The far face, as a pencil guide; the near face is the temperature axis.
  asBackdrop(
    board.create(
      "curve",
      [
        [L, L],
        [box[3], box[1]],
      ],
      {
        strokeColor: inks.pencil,
        strokeWidth: 1,
        highlight: false,
        fixed: true,
      },
    ),
  );
  const curve: Curve = board.create("curve", [[], []], {
    strokeColor: inks.graphite,
    strokeWidth: 2,
    highlight: false,
    fixed: true,
  });
  const probes: Point[] = PROBES.map(() =>
    board.create("point", [0, 0], {
      size: 3,
      strokeColor: inks.graphite,
      fillColor: inks.graphite,
      fixed: true,
      highlight: false,
      withLabel: false,
      showInfobox: false,
    }),
  );
  board.unsuspendUpdate();

  return {
    board,
    draw({ x, T, at }) {
      board.suspendUpdate();
      curve.dataX = x;
      curve.dataY = T;
      PROBES.forEach(([, share], i) => probes[i]?.setPosition(JXG.COORDS_BY_USER, [share * L, at(share * L)]));
      board.unsuspendUpdate();
    },
  };
}
