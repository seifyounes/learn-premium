// Test-only preload (node --import): loads the ledger code, then spins until START_AT (epoch ms), so
// racing processes hit the ledger within microseconds of each other instead of a Node startup apart.
import "../scripts/ledger/cli.ts";

const startAt = Number(process.env["START_AT"]);
while (Date.now() < startAt) {
  // spin: a timer would let the processes drift apart again
}
