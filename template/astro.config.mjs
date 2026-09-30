// @ts-check
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { buildContentDir } from "./src/content/layout.ts";
import { paperMathProcessor } from "./src/math/markdown.ts";
import { padLog } from "./src/pads/integration.ts";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  integrations: [react(), padLog(buildContentDir())],
  markdown: {
    processor: paperMathProcessor(),
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
