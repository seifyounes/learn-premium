// The Module wave's command line: `node wave.ts <command> --project <Course project> ...`.
// Commands, flags and exit codes: wave/README.md.
import { run } from "./wave/cli.ts";

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
