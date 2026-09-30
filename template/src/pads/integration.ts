// Every build says which pad it wears and lists each value the contrast auto-fix changed.
import type { AstroIntegration } from "astro";
import { coursePad } from "./course-pad.ts";
import { describeChange } from "./pad.ts";

export function padLog(contentDir: string): AstroIntegration {
  return {
    name: "learn-premium:pad",
    hooks: {
      "astro:build:start": ({ logger }) => {
        let pad;
        try {
          pad = coursePad(contentDir);
        } catch {
          return; // The content layer fails the build on a bad pad, naming course.yaml.
        }
        const name = `pad ${pad.value} (${pad.label})`;
        if (pad.changes.length === 0) {
          logger.info(`${name}: meets every contrast requirement`);
          return;
        }
        logger.info(`${name}: the contrast auto-fix changed ${pad.changes.length} value(s)`);
        for (const change of pad.changes) logger.info(`  ${describeChange(change)}`);
      },
    },
  };
}
