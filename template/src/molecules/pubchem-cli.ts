// `npm run pubchem`: asks PubChem, online and once, what it calls each molecule in the Course, and
// commits the answer as a build record. The one place a molecule touches the network: the build,
// the gates and the tests read only the records, and never fetch.
//
//   npm run pubchem -- [--content DIR] [--module NN-slug] [--replay DIR] [--save DIR] [--refresh]
//
//   --replay DIR   read DIR/<name>.json ({ status, body, recorded }) instead of the network, so a
//                  record is reproduced byte for byte; a name with no file there counts as offline
//   --save DIR     write each live response in that shape, to replay later
//   --refresh      ask again for a molecule that already has a record for its name
//
// Offline, it keeps any record it has and says so; the pubchem-cross-check gate raises a Checkpoint
// item for the molecule until a record exists.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { buildContentDir } from "../content/layout.ts";
import { fetchPubchem, recordOf, type Fetched, type PubchemIo } from "./pubchem.ts";
import { pubchemRecord, pubchemRecordEntry } from "./record.ts";

export interface CliIo extends PubchemIo {
  log(line: string): void;
}

/** PubChem allows five requests a second; ask four. */
const PAUSE_MS = 250;

interface Replayed {
  status: number;
  body: unknown;
  recorded: string;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function writeLf(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n/g, "\n"));
}

/** Every molecule descriptor in the Course (in a Module, when `module` is given), with its name. */
function descriptors(content: string, module: string | undefined): { module: string; file: string; name: string }[] {
  const found: { module: string; file: string; name: string }[] = [];
  const modules = join(content, "modules");
  if (!existsSync(modules)) return found;
  for (const entry of readdirSync(modules).sort()) {
    if (module !== undefined && entry !== module) continue;
    const folder = join(modules, entry, "molecules");
    if (!existsSync(folder)) continue;
    for (const file of readdirSync(folder).sort()) {
      if (!file.endsWith(".json")) continue;
      const path = join(folder, file);
      const name = (readJson(path) as { name?: unknown } | null)?.name;
      if (typeof name !== "string" || name === "")
        throw new Error(`${path} names no molecule: its "name" is what PubChem is asked for`);
      found.push({ module: entry, file: file.replace(/\.json$/, ""), name });
    }
  }
  return found;
}

export async function runPubchem(argv: string[], io: CliIo): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      content: { type: "string" },
      module: { type: "string" },
      replay: { type: "string" },
      save: { type: "string" },
      refresh: { type: "boolean", default: false },
    },
  });
  const content = resolve(values.content ?? buildContentDir());
  const tally = { fetched: 0, had: 0, offline: 0, notFound: 0 };
  let asked = false;
  for (const { module, file, name } of descriptors(content, values.module)) {
    const entry = pubchemRecordEntry(module, file);
    const path = join(content, entry);
    if (!values.refresh && existsSync(path)) {
      const had = pubchemRecord.safeParse(readJson(path));
      if (had.success && had.data.query === name) {
        tally.had += 1;
        continue;
      }
    }
    let answer: Fetched | { offline: string };
    let on = io.today();
    if (values.replay !== undefined) {
      const replayPath = join(resolve(values.replay), `${name}.json`);
      if (!existsSync(replayPath)) answer = { offline: `no replay file ${replayPath}` };
      else {
        const replayed = readJson(replayPath) as Replayed;
        answer = { status: replayed.status, body: replayed.body };
        on = replayed.recorded;
      }
    } else {
      if (asked) await io.wait(PAUSE_MS);
      asked = true;
      answer = await fetchPubchem(name, io);
      if (!("offline" in answer) && values.save !== undefined)
        writeLf(
          join(resolve(values.save), `${name}.json`),
          `${JSON.stringify({ status: answer.status, body: answer.body, recorded: on }, null, 2)}\n`,
        );
    }
    const record = "offline" in answer ? answer : recordOf(name, answer, on);
    if ("offline" in record) {
      tally.offline += 1;
      io.log(
        `offline: no PubChem record for ${module}/${file} ("${name}"): the pubchem-cross-check gate asks the Owner until it is fetched`,
      );
      continue;
    }
    writeLf(path, `${JSON.stringify(record, null, 2)}\n`);
    if (record.found) tally.fetched += 1;
    else tally.notFound += 1;
    io.log(`${record.found ? "recorded" : "not found"}: ${entry}`);
  }
  io.log(`fetched ${tally.fetched}, had ${tally.had}, offline ${tally.offline}, not found ${tally.notFound}`);
  return 0;
}

if (import.meta.main) {
  // exitCode, not process.exit(): exiting with the request's socket still closing trips a libuv assertion on Windows.
  process.exitCode = await runPubchem(process.argv.slice(2), {
    fetch,
    today: () => new Date().toISOString().slice(0, 10),
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
    log: (line) => console.log(line),
  });
}
