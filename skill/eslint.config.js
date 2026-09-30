// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["node_modules/"] },
  js.configs.recommended,
  tseslint.configs.strict,
  { languageOptions: { globals: { ...globals.node } } },
  prettier,
);
