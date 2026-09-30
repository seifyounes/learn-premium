// @ts-check
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { paperMathProcessor } from "./src/math/markdown.ts";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  integrations: [react()],
  markdown: {
    processor: paperMathProcessor(),
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
