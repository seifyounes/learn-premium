import { describe, expect, it } from "vitest";
import { stepThroughAt, toStepThrough } from "../src/sims/step-through.ts";

const html = (prose: string) => `<p>${prose}</p>`;
const stepped = toStepThrough(
  {
    figure: {
      kind: "plot",
      caption: "Path",
      x: { label: "a", min: 0, max: 1, step: 1 },
      y: { label: "b", min: 0, max: 1, step: 1 },
      elements: [
        { id: "start", kind: "point", at: [0, 0], side: "end" },
        { id: "next", kind: "point", at: [1, 1], side: "end" },
        {
          id: "leg",
          kind: "line",
          through: [
            [0, 0],
            [1, 1],
          ],
        },
      ],
      question: ["start"],
    },
    steps: [
      { caption: "Start", add: [], ring: [] },
      { caption: "Step", add: ["leg", "next"], ring: ["next"] },
    ],
  },
  html,
);

describe("a sim's step-through", () => {
  it("opens on the figure as the Materials draw it", () => {
    const first = stepThroughAt(stepped, 0);
    expect([...first.drawn]).toEqual(["start"]);
    expect(first.added).toEqual([]);
    expect(first.captionHtml).toBe("<p>Start</p>");
    expect(first.last).toBe(false);
  });

  it("draws each step's elements on top of the earlier ones, ringing what it points at", () => {
    const second = stepThroughAt(stepped, 1);
    expect([...second.drawn]).toEqual(["start", "leg", "next"]);
    expect(second.added).toEqual(["leg", "next"]);
    expect(second.rings).toEqual(["next"]);
    expect(second.last).toBe(true);
  });

  it("stays inside its steps", () => {
    expect(stepThroughAt(stepped, 9).index).toBe(1);
    expect(stepThroughAt(stepped, -2).index).toBe(0);
  });
});
