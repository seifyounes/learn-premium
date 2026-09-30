// The Go-public check: `node go-public.ts --project <Course project> [--private <Private folder>]`.
// What it checks, its report and exit codes: go-public/README.md.
import { run } from "./go-public/cli.ts";

try {
  const { code, stdout } = await run(process.argv.slice(2));
  process.stdout.write(`${stdout}\n`);
  process.exitCode = code;
} catch (error) {
  // A bug, not a finding: say so in the same JSON shape, and keep the stack for whoever debugs it.
  process.stdout.write(`${JSON.stringify({ ok: false, error: `internal error: ${(error as Error).message}` })}\n`);
  process.stderr.write(`${(error as Error).stack}\n`);
  process.exitCode = 4;
}
