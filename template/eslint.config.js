// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import astro from "eslint-plugin-astro";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/", "dist-production/", ".astro/", ".test-out/", "node_modules/", ".oracle-venv/"] },
  js.configs.recommended,
  tseslint.configs.strict,
  astro.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  // The browser gates' in-page script runs in the page, not in Node.
  { files: ["gates/browser/in-page.js"], languageOptions: { globals: { ...globals.browser } } },
  prettier,
);
