import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rulingsIn } from "../gates/rulings.ts";
import { FIXTURE_COURSE } from "./build-course";

const MODULE = "01-thermal-resistance";

describe("the rulings a Course's content carries", () => {
  it("lists each Slip by the sheet's value and each Divergence by the value it ships", () => {
    expect(rulingsIn({ contentDir: FIXTURE_COURSE, module: MODULE })).toEqual([
      { entry: `modules/${MODULE}/worked/1.json`, kind: "slip", printed: [1.45] },
      { entry: `modules/${MODULE}/practice/1.yaml`, kind: "divergence", printed: [9.6] },
    ]);
    expect(rulingsIn({ contentDir: FIXTURE_COURSE, module: "02-convection" })).toEqual([]);
  });

  it("are printed as JSON by the gate CLI, for the Module wave's merge gate", () => {
    const cli = spawnSync(
      process.execPath,
      ["gates/cli.ts", "rulings", "--module", MODULE, "--content", FIXTURE_COURSE],
      { cwd: resolve(import.meta.dirname, ".."), encoding: "utf8" },
    );
    expect(cli.status).toBe(0);
    expect(JSON.parse(cli.stdout)).toEqual({ rulings: rulingsIn({ contentDir: FIXTURE_COURSE, module: MODULE }) });
  });
});
