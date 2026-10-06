// The STL interpreter against awlsim, on the template's own corpus (`test/stl/`): every instruction
// the interpreter runs, with every kind of operand it takes, is run by some corpus case, and the
// engine agrees with awlsim's committed log bit for bit after every statement. `npm run oracle --
// check --corpus` (template CI) proves the logs are awlsim's own for the corpus as it stands.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { corpusListings, requestOf } from "../oracle/listings.ts";
import { parseStl } from "../src/sims/stl/parse.ts";
import { INSTRUCTIONS } from "../src/sims/stl/instructions.ts";
import { MUTANTS, runControls } from "../src/sims/stl/mutants.ts";
import { compareWithOracle, oracleLog } from "../src/sims/stl/oracle.ts";

const listings = corpusListings();

describe("the awlsim corpus", () => {
  it("has listings", () => {
    expect(listings.length).toBeGreaterThan(0);
  });

  for (const listing of listings) {
    it(`${listing.entry} agrees with awlsim bit for bit on every statement of every case`, () => {
      expect(existsSync(listing.logPath), `${listing.logPath}: run npm run oracle -- write --corpus`).toBe(true);
      const log = oracleLog.parse(JSON.parse(readFileSync(listing.logPath, "utf8")));
      expect(log.request, "the log was made from another listing or other cases").toBe(requestOf(listing).hash);
      const agreement = compareWithOracle(listing.model, listing.cases, log);
      expect(agreement.mismatches.slice(0, 10)).toEqual([]);
      expect(agreement.statements).toBeGreaterThan(0);
    });
  }

  it("catches every negative control wherever its defect shows, and each shows somewhere", () => {
    const caught = new Set<string>();
    for (const listing of listings) {
      const log = oracleLog.parse(JSON.parse(readFileSync(listing.logPath, "utf8")));
      for (const control of runControls(listing.model, listing.cases, log)) {
        expect(control.outcome, `${listing.entry}: ${control.defect}: ${control.detail}`).not.toBe("missed");
        if (control.outcome === "caught") caught.add(control.id);
      }
    }
    expect(MUTANTS.filter((m) => !caught.has(m.id)).map((m) => m.defect)).toEqual([]);
  });

  it("runs every instruction the interpreter has, with every kind of operand it takes", () => {
    const ran = new Set<string>();
    for (const listing of listings) {
      const program = parseStl(listing.model.source);
      const log = oracleLog.parse(JSON.parse(readFileSync(listing.logPath, "utf8")));
      for (const index of compareWithOracle(listing.model, listing.cases, log).ran) {
        const s = program.statements[index];
        if (s) ran.add(`${s.op} ${s.operand.kind}`);
      }
    }
    const missing = Object.entries(INSTRUCTIONS).flatMap(([op, instruction]) =>
      instruction.operands.filter((kind) => !ran.has(`${op} ${kind}`)).map((kind) => `${op} (${kind})`),
    );
    expect(missing).toEqual([]);
  });
});
