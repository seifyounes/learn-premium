// @ts-check
import react from "@astrojs/react";
import { unified } from "@astrojs/markdown-remark";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import remarkMath from "remark-math";
import rehypePaperMath from "./src/math/rehype-paper-math.ts";

export default defineConfig({
  output: "static",
  trailingSlash: "always",
  integrations: [react()],
  markdown: {
    processor: unified({
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypePaperMath],
    }),
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
