// The Build ledger's command interface: argv in, exit code and one JSON document out.
//
// Exit codes: 0 done; 1 a check found problems (integrity); 2 bad arguments, input or ledger file;
// 3 refused (the lock, or the ledger's state). The entry point (../ledger.ts) adds 4 for internal errors.
import { readFileSync } from "node:fs";
import {
  checkpointAnswer,
  claimLock,
  diff,
  endWave,
  init,
  map,
  nextAction,
  recordCheckpoint,
  recordJob,
  recordOverride,
  releaseLock,
  ROW_KINDS,
  startWave,
  status,
  supersede,
  verifyIntegrity,
} from "./ledger.ts";
import {
  commitSha,
  intakeSchema,
  issueNumber,
  JOB_RESULTS,
  moduleMapSchema,
  RULINGS,
  WAVE_KINDS,
  WAVE_RESULTS,
} from "./model.ts";
import { isoTime, oneOf, SchemaError } from "./schema.ts";
import { LedgerError } from "./store.ts";

export interface RunResult {
  code: number;
  stdout: string;
}

export function run(args: string[]): RunResult {
  try {
    const { code = 0, ...out } = dispatch(new Args(args));
    return { code, stdout: JSON.stringify({ ok: code === 0, ...out }) };
  } catch (error) {
    if (error instanceof LedgerError) return failure(error.kind === "refused" ? 3 : 2, error.message);
    if (error instanceof SchemaError) return failure(2, error.message);
    throw error;
  }
}

function failure(code: number, error: string): RunResult {
  return { code, stdout: JSON.stringify({ ok: false, error }) };
}

type Output = { code?: number } & Record<string, unknown>;

function dispatch(args: Args): Output {
  const command = args.command();
  const project = args.required("--project");
  switch (command) {
    case "next":
      return nextAction(project);
    case "init":
      init(
        project,
        args.required("--holder"),
        args.required("--release"),
        intakeSchema(readJson(args.required("--intake")), "intake"),
      );
      return {};
    case "map":
      map(project, args.required("--holder"), moduleMapSchema(readJson(args.required("--input")), "input"));
      return {};
    case "wave":
      return wave(args, project);
    case "lock":
      return lock(args, project);
    case "record":
      return record(args, project);
    case "supersede": {
      const row = oneOf(...ROW_KINDS)(args.required("--row"), "--row");
      supersede(project, args.required("--holder"), row, args.required("--id"), args.required("--reason"));
      return {};
    }
    case "integrity": {
      const { intact, ...report } = verifyIntegrity(project);
      return { code: intact ? 0 : 1, ...report };
    }
    case "checkpoint":
      return { answer: checkpointAnswer(project, args.required("--key")) };
    case "diff":
      return { ...diff(project) };
    case "status":
      return status(project);
    default:
      throw new LedgerError("invalid", `unknown command: ${command}`);
  }
}

function lock(args: Args, project: string): Output {
  const holder = args.required("--holder");
  switch (args.subcommand()) {
    case "claim":
      claimLock(project, holder, args.optional("--take-over") ?? null);
      return {};
    case "release":
      releaseLock(project, holder);
      return {};
    default:
      throw new LedgerError("invalid", "lock takes claim or release");
  }
}

function record(args: Args, project: string): Output {
  const holder = args.required("--holder");
  switch (args.subcommand()) {
    case "job": {
      const startedAt = args.optional("--started-at");
      recordJob(project, holder, {
        wave: args.required("--wave"),
        job: args.required("--job"),
        result: oneOf(...JOB_RESULTS)(args.required("--result"), "--result"),
        startedAt: startedAt === undefined ? null : isoTime(startedAt, "--started-at"),
        detail: args.optional("--detail") ?? null,
      });
      return {};
    }
    case "checkpoint": {
      const ruling = args.optional("--ruling");
      recordCheckpoint(project, holder, {
        wave: args.required("--wave"),
        key: args.required("--key"),
        question: args.required("--question"),
        answer: args.required("--answer"),
        ruling: ruling === undefined ? null : oneOf(...RULINGS)(ruling, "--ruling"),
      });
      return {};
    }
    case "override": {
      const gap = args.required("--gate-gap");
      recordOverride(
        project,
        holder,
        args.required("--path"),
        issueNumber(/^\d+$/.test(gap) ? Number(gap) : gap, "--gate-gap"),
      );
      return {};
    }
    default:
      throw new LedgerError("invalid", "record takes job, checkpoint or override");
  }
}

function wave(args: Args, project: string): Output {
  const holder = args.required("--holder");
  switch (args.subcommand()) {
    case "start": {
      const kind = oneOf(...WAVE_KINDS)(args.required("--kind"), "--kind");
      return { wave: startWave(project, holder, kind, args.required("--target"), args.required("--branch")) };
    }
    case "end": {
      const result = oneOf(...WAVE_RESULTS)(args.required("--result"), "--result");
      const commit = args.optional("--commit");
      endWave(
        project,
        holder,
        args.required("--wave"),
        result,
        commit === undefined ? null : commitSha(commit, "--commit"),
      );
      return {};
    }
    default:
      throw new LedgerError("invalid", "wave takes start or end");
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new LedgerError("invalid", `can't read ${path} as JSON: ${(error as Error).message}`);
  }
}

class Args {
  readonly #args: string[];
  constructor(args: string[]) {
    this.#args = args;
  }

  command(): string {
    const [command] = this.#args;
    if (command === undefined || command.startsWith("--")) throw new LedgerError("invalid", "no command given");
    return command;
  }

  subcommand(): string | undefined {
    const sub = this.#args[1];
    return sub === undefined || sub.startsWith("--") ? undefined : sub;
  }

  optional(name: string): string | undefined {
    const at = this.#args.indexOf(name);
    if (at === -1) return undefined;
    const value = this.#args[at + 1];
    if (value === undefined || value.startsWith("--")) throw new LedgerError("invalid", `${name} needs a value`);
    return value;
  }

  required(name: string): string {
    const value = this.optional(name);
    if (value === undefined) throw new LedgerError("invalid", `${name} is required`);
    return value;
  }
}
