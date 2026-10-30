// The Nernst sim's JSXGraph board, drawn in the pad's inks (`board.ts`): the cell's potential E
// against log₁₀Q, one straight line for each isotherm. A line is graphite or pencil, told from
// the others by its own dash and marker, and named at its end. At most four are drawn in ink;
// the rest dim to pencil (the `series-limit` rule). The regions are named inside them, and the
// operating point is where the sliders put the cell. Nothing on it is dragged, so a swipe on the
// board always scrolls the page.
import type JXGModule from "jsxgraph";
import { SERIES_STYLES, type SeriesDef } from "../../chemistry/series.ts";
import { F, R, electrons, type Model } from "../../sims/nernst/engine.ts";
import type { Range } from "../../sims/tuning.ts";
import { placeLabels } from "../../viewer/labels.ts";
import { makeBoard, screenOf, type Board, type Box, type Inks, type JXG } from "./board.ts";

type Curve = JXGModule.Curve;
type Point = JXGModule.Point;
type Text = JXGModule.Text;

export interface NernstBoard {
  board: Board;
  /** Draws the operating point and the lines: those in `shown` in ink, the rest in pencil. */
  draw(at: { logQ: number; E: number }, shown: readonly string[]): void;
  /** Places the labels again, for the board's new size. */
  relayout(): void;
}

/** A line label's line, in CSS pixels: 14px type with room to breathe. */
const LABEL_LINE = 18;
/** A label whose place moved no more than this from its line's end needs no leader. */
const LEADER_MIN = 4;
const LABEL_PX = 14;
/** The share of the board's width past the lines' ends, where their labels hang. */
const LABEL_ROOM = 0.34;

export function nernstBoard(
  JXG: JXG,
  el: HTMLElement,
  {
    model,
    tune,
    defs,
    inks,
    regions,
    initial,
  }: {
    model: Model;
    tune: { c1: Range; c2: Range };
    defs: readonly SeriesDef[];
    inks: Inks;
    /** The two regions' names, as plain words. */
    regions: { forward: string; reverse: string };
    /** Where the cell is and which lines are drawn in ink, so the board is drawn as it is, never in a first state. */
    initial: { at: { logQ: number; E: number }; shown: readonly string[] };
  },
): NernstBoard {
  const n = electrons(model);
  const E0 = model.second.e0 - model.first.e0;
  const a = n / model.first.charge;
  const b = n / model.second.charge;
  /** The cell's E on the isotherm `T`, at log₁₀Q = x. */
  const line = (T: number, x: number) => E0 - ((R * T * Math.LN10) / (n * F)) * x;

  // Q runs from the lowest c₁ over the highest c₂ to the highest c₁ over the lowest c₂.
  const xMin = Math.log10(tune.c1.min ** a / tune.c2.max ** b);
  const xMax = Math.log10(tune.c1.max ** a / tune.c2.min ** b);
  const ends = defs.flatMap((d) => [line(d.value, xMin), line(d.value, xMax)]);
  const low = Math.min(...ends, 0);
  const high = Math.max(...ends, 0);
  const margin = Math.max((high - low) * 0.1, 1e-3);
  const room = (xMax - xMin) * LABEL_ROOM;
  const box: Box = [xMin - (xMax - xMin) * 0.04, high + margin, xMax + room, low - margin];
  const board = makeBoard(JXG, el, box, inks);
  // Sized by the sim alone (`fitOnResize`, then `relayout`), never by JSXGraph's own observer: that one keeps the
  // size it saw when the stage changed and applies it 10 ms later, dropping a second change that arrives meanwhile.
  // On a slow runner it set the board back to a size the stage no longer had, and the labels placed for the right
  // size sat on the wrong board (the layout sweep found the region name on a marker at 390px).
  board.stopResizeObserver();

  board.suspendUpdate();
  const curves = new Map<string, Curve>();
  const markers = new Map<string, Point[]>();
  const names = new Map<string, Text>();
  const leaders = new Map<string, Curve>();
  defs.forEach((d, i) => {
    const style = SERIES_STYLES[i % SERIES_STYLES.length] as (typeof SERIES_STYLES)[number];
    const curve: Curve = board.create(
      "curve",
      [
        [xMin, xMax],
        [line(d.value, xMin), line(d.value, xMax)],
      ],
      { strokeColor: inks.graphite, strokeWidth: 1.6, dash: style.dash, highlight: false, fixed: true },
    );
    curve.rendNode?.setAttribute("data-series", d.id);
    curves.set(d.id, curve);
    markers.set(
      d.id,
      Array.from({ length: 5 }, (_, k) => {
        const x = xMin + ((k + 0.5) * (xMax - xMin)) / 5;
        return board.create("point", [x, line(d.value, x)], {
          size: 3,
          face: style.face,
          strokeColor: inks.graphite,
          fillColor: inks.graphite,
          fixed: true,
          highlight: false,
          withLabel: false,
          showInfobox: false,
        });
      }),
    );
    names.set(
      d.id,
      board.create("text", [xMax, line(d.value, xMax), d.label], {
        display: "html",
        cssClass: "sim-board-label",
        highlightCssClass: "sim-board-label",
        anchorX: "left",
        anchorY: "middle",
        fontSize: LABEL_PX,
        fontUnit: "px",
        strokeColor: inks.graphite,
        fixed: true,
        highlight: false,
      }),
    );
    leaders.set(
      d.id,
      board.create(
        "curve",
        [
          [xMax, xMax],
          [0, 0],
        ],
        { strokeColor: inks.pencil, strokeWidth: 1, highlight: false, fixed: true },
      ),
    );
  });

  // The regions, named inside them, at the end of the board where the lines keep clear.
  const lowAtMin =
    defs.reduce((sum, d) => sum + line(d.value, xMin), 0) < defs.reduce((sum, d) => sum + line(d.value, xMax), 0);
  // A name sits at its own edge of the board, in two short lines, so it never reaches the vertical axis or a line.
  const regionText = (html: string, atMin: boolean, y: number) => {
    const text: Text = board.create("text", [atMin ? box[0] : box[2], y, html.replace(": ", ":<br>")], {
      display: "html",
      cssClass: "sim-board-label",
      highlightCssClass: "sim-board-label",
      anchorX: atMin ? "left" : "right",
      anchorY: "middle",
      fontSize: LABEL_PX,
      fontUnit: "px",
      strokeColor: inks.pencil,
      fixed: true,
      highlight: false,
    });
    text.rendNode?.setAttribute("data-region", html === regions.forward ? "forward" : "reverse");
  };
  if (high > 0) regionText(regions.forward, lowAtMin, high * 0.35);
  if (low < 0) regionText(regions.reverse, !lowAtMin, low * 0.35);

  const operating: Point = board.create("point", [0, 0], {
    size: 4,
    strokeColor: inks.graphite,
    fillColor: inks.graphite,
    fixed: true,
    highlight: false,
    withLabel: false,
    showInfobox: false,
  });
  operating.rendNode?.setAttribute("data-operating-point", "");
  board.unsuspendUpdate();

  let shownNow: readonly string[] = [];

  const place = () => {
    // Each shown line's label hangs at its end, a line apart from the next, in the order of the ends.
    const seen = defs.filter((d) => shownNow.includes(d.id));
    const anchors = seen.map((d) => ({ id: d.id, y: screenOf(JXG, board, xMax, line(d.value, xMax))[1] }));
    const placed = placeLabels(anchors, board.canvasHeight, LABEL_LINE);
    const atX = screenOf(JXG, board, xMax, 0)[0] + 10;
    board.suspendUpdate();
    for (const d of defs) {
      const label = names.get(d.id);
      const leader = leaders.get(d.id);
      const spot = placed.at.find((p) => p.id === d.id);
      const shown = spot !== undefined;
      label?.setAttribute({ visible: shown });
      if (!shown || !spot) {
        leader?.setAttribute({ visible: false });
        continue;
      }
      const [x, y] = new JXG.Coords(JXG.COORDS_BY_SCREEN, [atX, spot.y], board).usrCoords.slice(1) as [number, number];
      label?.setPosition(JXG.COORDS_BY_USER, [x, y]);
      const end = line(d.value, xMax);
      const moved = Math.abs(spot.y - (anchors.find((p) => p.id === d.id)?.y ?? spot.y)) > LEADER_MIN;
      if (leader) {
        leader.dataX = [xMax, x];
        leader.dataY = [end, y];
        leader.setAttribute({ visible: moved });
      }
    }
    board.unsuspendUpdate();
  };

  const api: NernstBoard = {
    board,
    draw(at, shown) {
      shownNow = shown;
      board.suspendUpdate();
      defs.forEach((d) => {
        const on = shown.includes(d.id);
        const curve = curves.get(d.id);
        curve?.setAttribute(
          on
            ? { strokeColor: inks.graphite, strokeOpacity: 1, strokeWidth: 1.6 }
            : { strokeColor: inks.pencil, strokeOpacity: 0.35, strokeWidth: 1 },
        );
        curve?.rendNode?.setAttribute("data-shown", String(on));
        for (const marker of markers.get(d.id) ?? []) marker.setAttribute({ visible: on });
      });
      operating.setPosition(JXG.COORDS_BY_USER, [at.logQ, at.E]);
      board.unsuspendUpdate();
      place();
    },
    relayout: place,
  };
  // Drawn as it stands before anything shows: the lines' styles, the labels' places, the dot.
  api.draw(initial.at, initial.shown);
  return api;
}
