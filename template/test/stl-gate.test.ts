// The stl gate on the Fixture Course's STL listing (Module 06): it agrees with awlsim bit for bit,
// every instruction it uses is run by a case, the interpreter's negative controls each exercise
// their defect and are caught, an unsupported instruction ships the listing as a step-through once
// its Gate gap is named, and each of the gate's own negative controls is caught.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runControls } from "../gates/runner.ts";
import { stlGate } from "../gates/stl.ts";
import { courseListings } from "../oracle/listings.ts";
import { MUTANTS, runControls as runMutants } from "../src/sims/stl/mutants.ts";
import { oracleLog } from "../src/sims/stl/oracle.ts";
import { parseStl } from "../src/sims/stl/parse.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "06-tank-level";
const SIM = `modules/${MODULE}/sims/tank.yaml`;
const run = (contentDir: string) => stlGate.run({ contentDir, module: MODULE });

describe("the stl gate", () => {
  it("passes the Fixture Course's listing: bit for bit with awlsim on every statement of every case", async () => {
    const result = await run(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    expect(result.coverage).toMatchObject({ modules: 1, listings: 1, cases: 17, stepThroughs: 0, sheetValues: 4 });
    expect(result.coverage.statements).toBeGreaterThan(2000);
    expect(result.coverage.values).toBeGreaterThan(8000);
    // The FC105 call leaves the accumulators and some status bits behind: never compared.
    expect(result.coverage.leftByALibraryBlock).toBeGreaterThan(0);
  });

  it("runs every negative control the listing's instructions allow, and each one's defect really shows (the float64 lesson)", () => {
    const [listing] = courseListings(FIXTURE_COURSE, MODULE).listings;
    if (!listing) throw new Error("no listing");
    const log = oracleLog.parse(JSON.parse(readFileSync(listing.logPath, "utf8")));
    const results = runMutants(listing.model, listing.cases, log);
    // The tank listing uses every instruction the controls break, so none is skipped and none goes unreached.
    expect(results.map((r) => [r.id, r.outcome])).toEqual(MUTANTS.map((m) => [m.id, "caught"]));
  });

  it("blocks an instruction the listing uses that no case runs (the *I lesson), and only that", async () => {
    const control = stlGate.controls.find((c) => /no gate case runs/.test(c.defect));
    if (!control) throw new Error("no such control");
    const planted = control.plant(
      { contentDir: FIXTURE_COURSE, module: MODULE },
      mkdtempSync(join(tmpdir(), "lp-stl-")),
    );
    const result = await stlGate.run(planted);
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: SIM,
        message: expect.stringMatching(
          /^line \d+ \(RLDA\): no gate case runs it, so nothing checks the interpreter's RLDA against awlsim/,
        ),
      },
    ]);
  });

  it("raises a Checkpoint item for a sheet value awlsim and the interpreter agree against", async () => {
    const control = stlGate.controls.find((c) => c.expect === "checkpoint");
    if (!control) throw new Error("no such control");
    const planted = control.plant(
      { contentDir: FIXTURE_COURSE, module: MODULE },
      mkdtempSync(join(tmpdir(), "lp-stl-")),
    );
    const result = await stlGate.run(planted);
    expect(result.findings).toEqual([
      {
        outcome: "checkpoint",
        at: `modules/${MODULE}/worked/1.json`,
        message: expect.stringMatching(
          /^sheet cell C2 prints 1\.0005, but the engine and the independent recompute both give 1\.0000 \(MD 24\)/,
        ),
      },
    ]);
  });

  it("asks for a Gate gap for an instruction the interpreter lacks, then ships the listing as a step-through", async () => {
    const withTimer = (s: string) =>
      s.replace("          L     0\n          T     MW    36", "          L     T      1\n          T     MW    36");
    const missing = await run(fixtureWith(SIM, withTimer));
    expect(missing.findings).toHaveLength(1);
    expect(missing.findings[0]?.message).toMatch(
      /^line \d+: L can't read the operand "T 1"\. File a Gate gap on seifyounes\/learn-premium/,
    );

    const named = fixtureWith(SIM, (s) => `${withTimer(s)}gateGap: 123\n`);
    const shipped = await run(named);
    // The step-through plays awlsim's trace, so it needs a current log: this one is stale.
    expect(shipped.findings.map((f) => f.message)).toEqual([expect.stringMatching(/another listing or other cases/)]);
  });

  it("blocks a Gate gap named on a listing the interpreter runs in full", async () => {
    const result = await run(fixtureWith(SIM, (s) => `${s}gateGap: 123\n`));
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/^the interpreter runs every instruction in this listing now: drop gateGap 123/),
    ]);
  });

  it("blocks a listing with no oracle log", async () => {
    const course = fixtureWith(SIM, (s) => s);
    rmSync(join(course, "build-records", "oracle", MODULE, "tank.json"));
    const result = await run(course);
    expect(result.findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/^no oracle log at build-records\/oracle\/06-tank-level\/tank\.json/),
    ]);
  });

  it("catches each of its own negative controls", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE, module: MODULE }, gates: [stlGate] });
    expect(result.gates[0]?.controls.map((c) => [c.defect, c.caught])).toEqual(
      stlGate.controls.map((c) => [c.defect, true]),
    );
    expect(result.ok).toBe(true);
  });

  it("reads the listing the page shows: one OB 1, line for line", () => {
    const source = (courseListings(FIXTURE_COURSE, MODULE).listings[0]?.model.source ?? "").replace(/\r/g, "");
    expect(parseStl(source).lines.length).toBe(source.split("\n").length);
  });
});
