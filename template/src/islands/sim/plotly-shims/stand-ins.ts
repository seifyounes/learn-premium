// The heatmap builds Plotly from its sources (src/islands/sim/heatmap.ts): its prebuilt dist bundle
// held a 4×-slow phone for 2–4s as it started. A few small packages those sources ask for get
// stand-ins here, for Plotly's own files only:
//
// - has-hover reads Node's `global`, which no browser has (Plotly's own build defines it);
// - has-hover, is-mobile and native-promise-only ship no licence text, so the Licences file couldn't
//   carry their notices and every deploy would ask the Owner about them;
// - MapLibre's stylesheet is for Plotly's map traces, which the heatmap never registers.
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const here = (file: string) => fileURLToPath(new URL(`./${file}`, import.meta.url));

export const PLOTLY_STAND_INS: Readonly<Record<string, string>> = {
  "has-hover": here("has-hover.cjs"),
  "is-mobile": here("is-mobile.cjs"),
  "native-promise-only": here("native-promise-only.cjs"),
  "maplibre-gl/dist/maplibre-gl.css": here("no-maplibre.css"),
};

/** Resolves Plotly's own imports of those packages to their stand-ins. */
export function plotlyStandIns(): Plugin {
  return {
    name: "learn-premium:plotly-stand-ins",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer === undefined || !/[\\/]node_modules[\\/]plotly\.js[\\/]/.test(importer)) return null;
      return PLOTLY_STAND_INS[source] ?? null;
    },
  };
}
