import { describe, expect, it } from "vitest";
import { runControls } from "../gates/runner.ts";
import { eligibilityOfSource, plantedSim, toolsGate } from "../gates/sims.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "03-gradient-descent";
const at = (file: string) => `modules/${MODULE}/${file}`;
const run = (contentDir: string) => toolsGate.run({ contentDir, module: MODULE });
const withSim = (sim: Record<string, unknown>) => fixtureWith(at("sims/900.json"), () => JSON.stringify(sim));

describe("the tools gate: the five eligibility checks", () => {
  it("passes the Fixture Course's sims, sampling the engine at every slider's min, mid and max", async () => {
    const result = await run(FIXTURE_COURSE);
    expect(result.findings).toEqual([]);
    // One live sim: the example's values, then 4 sliders × min, mid and max. The Pyodide tool's
    // view adds its pad-frame and touch checks.
    expect(result.coverage).toEqual({
      modules: 1,
      sims: 2,
      pythonTools: 1,
      parts: 0,
      kinds: 1,
      checks: 12,
      engineSamples: 13,
    });
  });

  it("holds a machine part's 3D viewer to the pad frame and touch, as a sim's view", async () => {
    const result = await toolsGate.run({ contentDir: FIXTURE_COURSE, module: "07-flanged-hub" });
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({
      modules: 1,
      sims: 0,
      pythonTools: 0,
      parts: 1,
      kinds: 0,
      checks: 3,
      engineSamples: 0,
    });
  });

  it("blocks a ready-made simulator as a tool: PhET and Falstad are credited links only", async () => {
    const result = await run(withSim({ ...plantedSim(), kind: "phet" }));
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: at("sims/900.json"),
        message:
          '"phet" isn\'t a tool this template ships (it ships: gradient-descent, logic, tangent, plane-wall, stl); PhET and Falstad appear only as credited links, never as a tool',
      },
    ]);
  });

  it("blocks a model the Materials don't give: the builder writes it from them", async () => {
    const sim = {
      ...plantedSim(),
      provenance: { stated: ["$0.1$", "$2$", "$20$"], assumed: ["$(0, 1)$, $(1, 3)$, $(2, 4)$", "$0.01$"] },
    };
    const result = await run(withSim(sim));
    expect(result.findings).toEqual([
      {
        outcome: "block",
        at: at("sims/900.json"),
        message:
          "not writable from the Materials: the model's 0, 1, 3, 4 are not tagged stated or scaled, so they don't come from the Materials",
      },
    ]);
  });

  it("blocks an engine that can't run headlessly to finite numbers", async () => {
    const flat = {
      ...plantedSim(),
      model: {
        data: [
          [1, 1],
          [1, 2],
          [1, 3],
        ],
      },
      provenance: { stated: ["$(1, 1)$, $(1, 2)$, $(1, 3)$", "$0.1$", "$0.01$", "$20$"] },
    };
    const result = await run(withSim(flat));
    expect(result.findings).toEqual([
      expect.objectContaining({
        outcome: "block",
        at: at("sims/900.json"),
        message: expect.stringMatching(
          /^not checkable headlessly: at the example's values the engine gives minimum\.theta0 = NaN/,
        ),
      }),
    ]);
  });

  it("reads a view's source for colours outside the pad and for mouse-only handlers", () => {
    expect(eligibilityOfSource("const ink = token('graphite');")).toEqual([]);
    expect(eligibilityOfSource('board.create("point", [0, 0], { strokeColor: "#c3d9ff" });')).toEqual([
      "doesn't take the pad frame: it names the colour #c3d9ff instead of reading the pad's tokens",
    ]);
    expect(eligibilityOfSource("<div onMouseDown={grab} />")).toEqual([
      "isn't touch-usable: onMouseDown handles a mouse only (use pointer events)",
    ]);
  });

  it("catches every negative control", async () => {
    const result = await runControls({ input: { contentDir: FIXTURE_COURSE, module: MODULE }, gates: [toolsGate] });
    expect(result.gates[0]?.positive).toBe("pass");
    expect(result.gates[0]?.controls.every((c) => c.caught)).toBe(true);
    expect(result.ok).toBe(true);
  });
});
