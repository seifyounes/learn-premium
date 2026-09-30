// A fake NotebookLM for the Media pass tests (seam 2): it keeps its own rolling 5-hour and weekly
// usage, refuses a generation past either limit the way the real one does, and turns out media that
// either passes or fails the fact check. `runMediaPass` drives it the way the skill does, through the
// media commands only.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { media } from "./helpers.ts";

type Kind = "video" | "audio" | "infographic" | "sitting-audio";
type Limit = "5-hour" | "weekly";

const WINDOW_MS: Record<Limit, number> = { "5-hour": 5 * 3_600_000, weekly: 7 * 24 * 3_600_000 };

export class FakeNotebookLM {
  readonly costs: Record<Kind, number>;
  readonly limits: Record<Limit, number>;
  /** Outputs that fail the fact check, as `<item>#<attempt>`. */
  readonly inaccurate: Set<string>;
  /** Every generation it accepted. */
  readonly generations: { at: number; project: string; item: string; kind: Kind }[] = [];
  refusals = 0;

  constructor(options: { costs: Record<Kind, number>; limits: Record<Limit, number>; inaccurate?: string[] }) {
    this.costs = options.costs;
    this.limits = options.limits;
    this.inaccurate = new Set(options.inaccurate ?? []);
  }

  /** Starts a generation, or refuses it with the limit it would break. */
  generate(project: string, item: string, kind: Kind): "ok" | Limit {
    const now = Date.now();
    for (const limit of ["weekly", "5-hour"] as const) {
      const used = this.generations
        .filter((g) => g.at > now - WINDOW_MS[limit])
        .reduce((sum, g) => sum + this.costs[g.kind], 0);
      if (used + this.costs[kind] > this.limits[limit]) {
        this.refusals++;
        return limit;
      }
    }
    this.generations.push({ at: now, project, item, kind });
    return "ok";
  }

  timesMade(project: string, item: string): number {
    return this.generations.filter((g) => g.project === project && g.item === item).length;
  }
}

/** Where the pass places a checked item, relative to the Course project. */
export function placedPath(item: string): string {
  return `public/media/${item}.bin`;
}

/**
 * One Media pass, as the skill runs it: gather, take the next item, move it one step, repeat, until
 * `gather` has nothing next (the queue drained, or a quota limit stopped it). Returns the last gather.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the JSON output of `gather`
export function runMediaPass(state: string, notebook: FakeNotebookLM): any {
  for (let step = 0; step < 1000; step++) {
    const { out: gathered } = media("gather", "--state", state);
    const next = gathered.next;
    if (next === null) return gathered;
    const at = ["--state", state, "--project", next.project, "--item", next.item];
    const attempt = next.regenerations + 1;
    switch (next.state) {
      case "queued": {
        must(media("start", ...at));
        const made = notebook.generate(next.project, next.item, next.kind);
        if (made !== "ok")
          must(media("limit", "--state", state, "--kind", made, "--project", next.project, "--item", next.item));
        break;
      }
      case "generating":
        must(media("downloaded", ...at));
        break;
      case "downloaded":
        if (notebook.inaccurate.has(`${next.item}#${attempt}`))
          must(media("fail", ...at, "--reason", "a wrong number"));
        else must(media("checked", ...at));
        break;
      case "checked": {
        const file = join(next.project, placedPath(next.item));
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${next.item}#${attempt}`);
        must(media("placed", ...at, "--file", placedPath(next.item)));
        break;
      }
      default:
        throw new Error(`gather offered an item in state ${next.state}`);
    }
  }
  throw new Error("the Media pass never finished");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the JSON output of a media command
export function must(result: { code: number; out: any }): any {
  if (result.code !== 0) throw new Error(`media command failed (${result.code}): ${result.out.error}`);
  return result.out;
}
