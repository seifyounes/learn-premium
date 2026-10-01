import { describe, expect, it } from "vitest";
import { contentContract } from "../gates/content.ts";
import { provenanceGate } from "../gates/provenance.ts";
import { FIXTURE_COURSE, fixtureWith } from "./build-course";

const MODULE = "01-thermal-resistance";
const at = (file: string) => `modules/${MODULE}/${file}`;

describe("the provenance gate", () => {
  it("passes the Fixture Course, where every value is tagged, reporting what it covered", async () => {
    const run = await provenanceGate.run({ contentDir: FIXTURE_COURSE, module: MODULE });
    expect(run.findings).toEqual([]);
    expect(run.coverage.entries).toBe(6);
    expect(run.coverage.values).toBeGreaterThan(80);
  });

  it("blocks a value a writer added without a tag, naming the file, the value and where it sits", async () => {
    const course = fixtureWith(at("worked/1.json"), (s) =>
      s.replace("so the profile lands on $T_4$", "so the profile lands on $T_4$ within $0.01\\\\ \\\\text{K}$"),
    );
    const run = await provenanceGate.run({ contentDir: course, module: MODULE });
    expect(run.findings).toEqual([
      {
        outcome: "block",
        at: at("worked/1.json"),
        message:
          "0.01 (in steps.5.note) carries no Provenance tag: list it under provenance as stated, derived, scaled or assumed",
      },
    ]);
  });

  it("blocks an untagged number in a Summary beat's figure and in a Practice item's answer", async () => {
    let course = fixtureWith(at("summary/1.md"), (s) => s.replace("at: [0.2, 5]", "at: [0.2, 6]"));
    course = fixtureWith(at("practice/2.yaml"), (s) => s.replace("value: 0.04", "value: 0.4"), course);
    const run = await provenanceGate.run({ contentDir: course, module: MODULE });
    expect(run.findings.map((f) => `${f.at}: ${f.message.split(" carries")[0]}`)).toEqual([
      `${at("summary/1.md")}: 6 (in figure.elements.4.at)`,
      `${at("practice/2.yaml")}: 0.4 (in answer.value)`,
    ]);
  });
});

describe("the content contract on Module media", () => {
  it("blocks a YouTube card below a 9/10 match", async () => {
    const course = fixtureWith(at("media.yaml"), (s) =>
      [
        s,
        "youtube:",
        "  - { id: abcdefghijk, title: A talk, channel: A channel, duration: '9:30', match: 8, why: Close. }",
        "",
      ].join("\n"),
    );
    const run = await contentContract.run({ contentDir: course, module: MODULE });
    expect(run.findings).toEqual([
      expect.objectContaining({ at: at("media.yaml"), message: expect.stringMatching(/^youtube\.0\.match: /) }),
    ]);
  });

  it("blocks a media file the Module's media folder doesn't hold", async () => {
    const course = fixtureWith(at("media.yaml"), (s) => s.replace("file: deep-dive.mp3", "file: missing.mp3"));
    const run = await contentContract.run({ contentDir: course, module: MODULE });
    expect(run.findings).toEqual([
      {
        outcome: "block",
        at: at("media.yaml"),
        message: "names media/missing.mp3, which isn't in the Module's media/ folder",
      },
    ]);
  });
});
