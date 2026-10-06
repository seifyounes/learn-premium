// The media budget check at intake: this Course's semester media demand against what NotebookLM's
// weekly cap can still make before its last Exam sitting, once every registered Course's own demand
// is met. It reports and never decides: the Owner weighs an "over" before committing.
import { LedgerError } from "../ledger/file.ts";
import { current } from "../ledger/model.ts";
import { readLedger } from "../ledger/store.ts";
import { MEDIA_KINDS, MODULE_MEDIA, type MediaKind, type Usage } from "../media/model.ts";
import { readMediaFile, readRegistry, readUsage } from "../media/store.ts";
import type { Answers } from "./answers.ts";
import { samePath } from "./find.ts";

type Items = Record<MediaKind, number>;

const DAY_MS = 86_400_000;

/** A semester's items: a video, an audio and an infographic per Module, and a sitting audio per Exam sitting. */
function demandOf(modules: number, sittings: number): Items {
  return {
    ...(Object.fromEntries(MODULE_MEDIA.map((k) => [k, modules])) as Record<string, number>),
    "sitting-audio": sittings,
  } as Items;
}

/** What `items` cost in NotebookLM's usage unit, or null while a kind among them is unmeasured. */
function unitsOf(items: Items, usage: Usage): number | null {
  let sum = 0;
  for (const kind of MEDIA_KINDS) {
    if (items[kind] === 0) continue;
    const cost = usage.costs[kind];
    if (cost === null) return null;
    sum += cost * items[kind];
  }
  return sum;
}

interface Other {
  project: string;
  course: string;
  items: Items;
  units: number | null;
}

/**
 * What a registered Course still has to make this semester: its expected Modules (or, with none
 * recorded, its mapped ones) and its Exam sittings, less every item already started, made or dropped.
 */
function outstanding(project: string, usage: Usage): Omit<Other, "project"> & { materialsPath: string } {
  const ledger = readLedger(project);
  if (ledger === null) throw new LedgerError("refused", `no Build ledger in ${project}`);
  const modules = ledger.intake.expectedModules ?? current(ledger.modules).length;
  const items = demandOf(modules, ledger.intake.sittings.length);
  for (const item of readMediaFile(project)?.items ?? []) {
    if (item.state !== "queued") items[item.kind] = Math.max(0, items[item.kind] - 1);
  }
  return {
    course: ledger.intake.courseName,
    materialsPath: ledger.intake.materialsPath,
    items,
    units: unitsOf(items, usage),
  };
}

export function budget(stateDir: string, answers: Answers) {
  const usage = readUsage(stateDir);
  const today = new Date().toISOString().slice(0, 10);
  const items = demandOf(answers.expectedModules, answers.sittings.length);
  const course = {
    modules: answers.expectedModules,
    sittings: answers.sittings.length,
    items,
    units: unitsOf(items, usage),
  };

  const last = answers.sittings
    .flatMap((s) => (s.date !== null && s.date >= today ? [s.date] : []))
    .sort()
    .at(-1);
  const days = last === undefined ? null : (Date.parse(last) - Date.parse(today)) / DAY_MS;
  const window = last === undefined || days === null ? null : { from: today, to: last, weeks: round(days / 7) };

  const others: Other[] = [];
  const skipped: { project: string; course: string; error: string }[] = [];
  for (const { project, course: registered } of readRegistry(stateDir).courses) {
    try {
      const { materialsPath, ...rest } = outstanding(project, usage);
      // The same Course checked again after it joined the registry isn't its own competition.
      if (!samePath(materialsPath, answers.materialsPath)) others.push({ project, ...rest });
    } catch (error) {
      if (!(error instanceof LedgerError)) throw error;
      skipped.push({ project, course: registered, error: error.message });
    }
  }

  const weeklyLimit = usage.limits.weekly;
  const units = weeklyLimit === null || days === null ? null : round((weeklyLimit * days) / 7);
  const committed = others.reduce<number | null>(
    (sum, o) => (sum === null || o.units === null ? null : sum + o.units),
    0,
  );
  const capacity = {
    weeklyLimit,
    units,
    committed: weeklyLimit === null ? null : committed,
    remaining: units === null || committed === null ? null : round(units - committed),
  };

  let verdict: "fits" | "over" | "unknown";
  let reason: string | null = null;
  if (window === null) {
    verdict = "unknown";
    reason = "no dated Exam sitting ahead, so there is no window to fit the media in; add a date when it is known";
  } else if (course.units === null || capacity.remaining === null) {
    verdict = "unknown";
    reason =
      "NotebookLM's usage isn't measured yet (or a registered Course can't be priced): record the costs and the weekly limit with `media.ts quota` after the first real media run";
  } else verdict = course.units <= capacity.remaining ? "fits" : "over";

  return { course, window, others, skipped, capacity, verdict, reason };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
