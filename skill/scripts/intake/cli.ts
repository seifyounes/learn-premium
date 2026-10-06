// The intake's command interface: argv in, exit code and one JSON document out.
//
// Exit codes as the ledger's: 0 done; 1 a check found problems (host: the live site isn't noindex);
// 2 bad arguments or input; 3 refused (the state on disk, GitHub or Vercel doesn't allow it). The
// entry point (../intake.ts) adds 4 for internal errors.
import { resolve } from "node:path";
import { Args, readJson } from "../ledger/args.ts";
import { LedgerError } from "../ledger/file.ts";
import { SchemaError } from "../ledger/schema.ts";
import { DEFAULT_STATE_DIR } from "../media/model.ts";
import { answersSchema, type Answers } from "./answers.ts";
import { budget } from "./budget.ts";
import { createProject } from "./create.ts";
import { findCourse } from "./find.ts";
import { host } from "./host.ts";
import { HostingError, realHosting, type Hosting } from "./hosting.ts";
import { suggestPad } from "./pads.ts";
import { propose } from "./propose.ts";

export interface RunResult {
  code: number;
  stdout: string;
}

/** What the intake reaches outside this machine through: GitHub and Vercel. Tests pass a fake. */
export interface Deps {
  hosting: Hosting;
}

export async function run(args: string[], deps: Partial<Deps> = {}): Promise<RunResult> {
  try {
    const { code = 0, ...out } = await dispatch(new Args(args), deps);
    return { code, stdout: JSON.stringify({ ok: code === 0, ...out }) };
  } catch (error) {
    if (error instanceof LedgerError) return failure(error.kind === "refused" ? 3 : 2, error.message);
    if (error instanceof SchemaError) return failure(2, error.message);
    if (error instanceof HostingError) return failure(3, error.message);
    throw error;
  }
}

function failure(code: number, error: string): RunResult {
  return { code, stdout: JSON.stringify({ ok: false, error }) };
}

type Output = { code?: number } & Record<string, unknown>;

async function dispatch(args: Args, deps: Partial<Deps>): Promise<Output> {
  const command = args.command();
  switch (command) {
    case "pad":
      return { ...suggestPad(args.required("--discipline")) };
    case "find":
      return { ...findCourse(stateDir(args), args.required("--materials")) };
    case "propose":
      return propose(args.required("--materials"));
    case "budget":
      return budget(stateDir(args), answers(args));
    case "create":
      return createProject({
        answers: answers(args),
        workspace: args.required("--workspace"),
        source: args.optional("--source") ?? RELEASE_ROOT,
        release: args.required("--release"),
        holder: args.required("--holder"),
        stateDir: stateDir(args),
      });
    case "host":
      return host(
        args.required("--project"),
        deps.hosting ??
          realHosting({ vercelToken: process.env["VERCEL_TOKEN"], vercelTeam: process.env["VERCEL_TEAM_ID"] }),
      );
    default:
      throw new LedgerError("invalid", `unknown command: ${command}`);
  }
}

/** The release worktree this script runs from: `<root>/skill/scripts/intake/`. */
const RELEASE_ROOT = resolve(import.meta.dirname, "..", "..", "..");

const stateDir = (args: Args) => args.optional("--state") ?? DEFAULT_STATE_DIR;

const answers = (args: Args): Answers => answersSchema(readJson(args.required("--answers")), "answers");
