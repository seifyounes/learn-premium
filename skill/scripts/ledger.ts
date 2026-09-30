// The Build ledger's command line: `node ledger.ts <command> --project <Course project> ...`.
// Commands, flags and exit codes: ledger/README.md.
import { run } from "./ledger/cli.ts";

try {
  const { code, stdout } = run(process.argv.slice(2));
  process.stdout.write(`${stdout}\n`);
  process.exitCode = code;
} catch (error) {
  // A bug, not a refusal: say so in the same JSON shape, and keep the stack for whoever debugs it.
  process.stdout.write(`${JSON.stringify({ ok: false, error: `internal error: ${(error as Error).message}` })}\n`);
  process.stderr.write(`${(error as Error).stack}\n`);
  process.exitCode = 4;
}
