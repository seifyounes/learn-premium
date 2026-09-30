// The Media pass's command interface: argv in, exit code and one JSON document out.
//
// Exit codes as the ledger's: 0 done; 2 bad arguments, input or file; 3 refused (a quota limit, or the
// item's state doesn't allow the step). The entry point (../media.ts) adds 4 for internal errors.
import { Args } from "../ledger/args.ts";
import { LedgerError } from "../ledger/file.ts";
import { isoTime, oneOf, SchemaError } from "../ledger/schema.ts";
import { advance, fail, limit, place, register, setQuota, start, survey } from "./media.ts";
import { DEFAULT_STATE_DIR, LIMITS, MEDIA_KINDS, units, type Usage } from "./model.ts";

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
  const state = args.optional("--state") ?? DEFAULT_STATE_DIR;
  switch (command) {
    case "register":
      return register(state, args.required("--project"));
    case "gather":
      return { ...survey(state, true) };
    case "status":
      return { ...survey(state, false) };
    case "start": {
      const result = start(state, args.required("--project"), args.required("--item"));
      if (result.started) return { attempt: result.attempt };
      const { limit: which, until } = result.stopped;
      const lifts = until === null ? "never: the item costs more than the whole limit" : `at ${until}`;
      return {
        code: 3,
        error: `NotebookLM's ${which} limit stops new generations; it lifts ${lifts}`,
        stopped: result.stopped,
      };
    }
    case "downloaded":
    case "checked":
      advance(state, args.required("--project"), args.required("--item"), command);
      return {};
    case "placed":
      place(state, args.required("--project"), args.required("--item"), args.required("--file"));
      return {};
    case "fail":
      return fail(
        state,
        args.required("--project"),
        args.required("--item"),
        args.required("--reason"),
        args.flag("--final"),
      );
    case "limit": {
      const until = args.optional("--until");
      const project = args.optional("--project");
      const item = args.optional("--item");
      if ((project === undefined) !== (item === undefined)) {
        throw new LedgerError("invalid", "--project and --item go together: the generation NotebookLM refused");
      }
      return limit(
        state,
        oneOf(...LIMITS)(args.required("--kind"), "--kind"),
        until === undefined ? null : new Date(isoTime(until, "--until")).toISOString(),
        project === undefined || item === undefined ? null : { project, item },
      );
    }
    case "quota":
      return setQuota(state, quotaFlags(args));
    default:
      throw new LedgerError("invalid", `unknown command: ${command}`);
  }
}

/** `--limit-5-hour N --limit-weekly N --cost-<kind> N`: any subset, in NotebookLM's usage unit. */
function quotaFlags(args: Args): { limits: Partial<Usage["limits"]>; costs: Partial<Usage["costs"]> } {
  const pick = <K extends string>(keys: readonly K[], prefix: string): Partial<Record<K, number>> => {
    const out: Partial<Record<K, number>> = {};
    for (const key of keys) {
      const value = args.optional(`${prefix}${key}`);
      if (value !== undefined) out[key] = units(Number(value), `${prefix}${key}`);
    }
    return out;
  };
  const numbers = { limits: pick(LIMITS, "--limit-"), costs: pick(MEDIA_KINDS, "--cost-") };
  if (Object.keys(numbers.limits).length + Object.keys(numbers.costs).length === 0) {
    throw new LedgerError("invalid", "quota needs at least one --limit-<5-hour|weekly> or --cost-<kind>");
  }
  return numbers;
}
