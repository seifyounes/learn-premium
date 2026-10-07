// The plane-wall sim's map of the wall over time: a Plotly heatmap of T over x and t, in the pad's
// colours (light grid to the pad's print, hot as the strongest), with the chosen time ruled across
// it in graphite. Plotly is the shared core's tool for heatmaps and 3D surfaces only, and this
// module is its one door: the sim imports it only when the map is opened, so no page loads Plotly
// with itself. The plot is static, a picture: it takes no drag, so a swipe on it scrolls the page.
// Every text on it is set in screen pixels, so the 12px floor holds at 320px.
// Plotly is built from its sources, its core and the heatmap trace: the prebuilt dist bundle took
// 2–4s to start on a 4×-slow phone, holding every tap on the page (ticket 119); this takes ~0.15s.
import Plotly from "plotly.js/lib/core";
import heatmapTrace from "plotly.js/lib/heatmap";
import type { Field } from "../../sims/plane-wall/engine.ts";
import { TICK_PX, type Inks } from "./board.ts";

Plotly.register([heatmapTrace]);

/** The axis titles, units included, as plain text: Plotly doesn't set paper math. */
export interface HeatmapLabels {
  x: string;
  t: string;
  T: string;
}

export interface Heatmap {
  draw(field: Field, time: number): Promise<void>;
  free(): void;
}

/** An axis title's size, in screen pixels. */
const TITLE_PX = 13;

export function heatmap(el: HTMLElement, { inks, labels }: { inks: Inks; labels: HeatmapLabels }): Heatmap {
  const family = getComputedStyle(el).getPropertyValue("--font-quantity").trim() || "inherit";
  const axis = (title: string) => ({
    title: { text: title, font: { size: TITLE_PX, color: inks.graphite } },
    color: inks.pencil,
    linecolor: inks.pencil,
    tickcolor: inks.pencil,
    tickfont: { size: TICK_PX, color: inks.pencil },
    ticks: "outside",
    showline: true,
    showgrid: false,
    zeroline: false,
    fixedrange: true,
    automargin: true,
  });
  return {
    async draw(field, time) {
      await Plotly.react(
        el,
        [
          {
            type: "heatmap",
            x: field.x,
            y: field.t,
            z: field.T,
            // The browser smooths the image; Plotly's own "best" interpolates every pixel in script.
            zsmooth: "fast",
            colorscale: [
              [0, inks.gridMajor],
              [1, inks.print],
            ],
            colorbar: {
              // Beside the bar, not above it, where it would sit on the top tick's label.
              title: { text: labels.T, side: "right", font: { size: TITLE_PX, color: inks.graphite } },
              thickness: 12,
              outlinecolor: inks.pencil,
              outlinewidth: 1,
              tickcolor: inks.pencil,
              tickfont: { size: TICK_PX, color: inks.pencil },
              ticks: "outside",
            },
            hoverinfo: "skip",
          },
        ],
        {
          autosize: true,
          margin: { l: 8, r: 8, t: 8, b: 8 },
          paper_bgcolor: inks.sheet,
          plot_bgcolor: inks.sheet,
          font: { family, size: TICK_PX, color: inks.pencil },
          xaxis: axis(labels.x),
          yaxis: axis(labels.t),
          shapes: [
            {
              type: "line",
              xref: "paper",
              x0: 0,
              x1: 1,
              y0: time,
              y1: time,
              line: { color: inks.graphite, width: 2 },
            },
          ],
        },
        { staticPlot: true, responsive: true, displayModeBar: false, displaylogo: false },
      );
    },
    free() {
      Plotly.purge(el);
    },
  };
}
