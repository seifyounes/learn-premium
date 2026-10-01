// Adds the Trap page (`src/trap/route.ts`) to every build except Vercel's production deploy.
import type { AstroIntegration } from "astro";
import { shipsTrapPage, TRAP_ROUTE } from "./route.ts";

export function trapPage(): AstroIntegration {
  return {
    name: "learn-premium:trap-page",
    hooks: {
      "astro:config:setup": ({ injectRoute }) => {
        if (shipsTrapPage()) injectRoute({ pattern: TRAP_ROUTE, entrypoint: new URL("./Trap.astro", import.meta.url) });
      },
    },
  };
}
