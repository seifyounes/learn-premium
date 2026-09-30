// Command-line flags as the state scripts take them: `<command> [subcommand] --flag value ...`.
import { readFileSync } from "node:fs";
import { LedgerError } from "./file.ts";

export class Args {
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

  /** Whether a flag that takes no value was given. */
  flag(name: string): boolean {
    return this.#args.includes(name);
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

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new LedgerError("invalid", `can't read ${path} as JSON: ${(error as Error).message}`);
  }
}
