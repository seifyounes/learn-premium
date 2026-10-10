// The ladder engine against awlsim on the template's own corpus (`test/ladder/`): every S5 timer and
// counter, as a box and as a coil, the TON, and every FBD box, each run on timelines whose scans
// awlsim ran on the same networks compiled to STL (`oracle/`, kept current by `npm run oracle --
// check --corpus` in CI). The engine must agree bit for bit after every scan: all of I, Q and M,
// every timer's Q, running state and time left, every count, every TON's instance data.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { unexercised } from "../gates/ladder.ts";
import { ladderCorpus, ladderRequestOf } from "../oracle/ladder.ts";
import { PLC_KINDS } from "../src/sims/ladder/model.ts";
import { MUTANTS, runControls } from "../src/sims/ladder/mutants.ts";
import { compareWithOracle, ladderLog } from "../src/sims/ladder/oracle.ts";

const corpus = ladderCorpus();

describe("the ladder corpus against awlsim", () => {
  for (const listing of corpus) {
    it(`${listing.entry} agrees after every scan`, () => {
      expect(existsSync(listing.logPath), `no oracle log at ${listing.logPath}`).toBe(true);
      const log = ladderLog.parse(JSON.parse(readFileSync(listing.logPath, "utf8")));
      expect(log.request, "the log was made from this model and these cases").toBe(ladderRequestOf(listing).hash);
      const agreement = compareWithOracle(listing.model, listing.cases, log);
      expect(agreement.mismatches.slice(0, 5)).toEqual([]);
      // Its cases reach every part: each net (a branch that feeds nothing too) powered and unpowered.
      expect(unexercised(listing.model, agreement.runs)).toEqual([]);
      expect(agreement.scans).toBe(listing.cases.reduce((n, c) => n + c.scans.length, 0));
    });
  }

  it("catches every broken engine somewhere, and misses none it reaches", () => {
    const outcomes = corpus.flatMap((l) =>
      runControls(l.model, l.cases, ladderLog.parse(JSON.parse(readFileSync(l.logPath, "utf8")))),
    );
    expect(outcomes.filter((o) => o.outcome === "missed")).toEqual([]);
    const caught = new Set(outcomes.filter((o) => o.outcome === "caught").map((o) => o.defect));
    expect(MUTANTS.map((m) => m.defect).filter((d) => !caught.has(d))).toEqual([]);
  });

  it("runs every element of the PLC pack somewhere", () => {
    const used = new Set(corpus.flatMap((l) => l.model.parts.map((p) => p.kind)));
    expect(PLC_KINDS.filter((k) => !used.has(k))).toEqual([]);
  });
});
