// @ts-check
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { buildContentDir } from "./src/content/layout.ts";
import { plotlyStandIns } from "./src/islands/sim/plotly-shims/stand-ins.ts";
import { licencesFile } from "./src/licences/integration.ts";
import { paperMathProcessor } from "./src/math/markdown.ts";
import { moduleMedia } from "./src/media/integration.ts";
import { padLog } from "./src/pads/integration.ts";
import { pyodideFiles } from "./src/python/integration.ts";
import { trapPage } from "./src/trap/integration.ts";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  integrations: [
    react(),
    padLog(buildContentDir()),
    moduleMedia(buildContentDir()),
    pyodideFiles(buildContentDir()),
    trapPage(),
    licencesFile(),
  ],
  markdown: {
    processor: paperMathProcessor(),
  },
  vite: {
    plugins: [tailwindcss(), plotlyStandIns()],
  },
});
