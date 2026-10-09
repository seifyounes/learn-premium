// The fresh reviewer's files as the wave reads them in the Private folder, for the review and ready tests.
import { COMMIT } from "./fixture-courses.ts";
import { writeFiles } from "./helpers.ts";

/** The phone and laptop screenshots of the preview, as the template's `gates shots` leaves them. */
export function shots(privateFolder: string, commit = COMMIT, module = "01") {
  writeFiles(privateFolder, {
    [`waves/${module}/review/shots/phone.png`]: "png",
    [`waves/${module}/review/shots/laptop.png`]: "png",
    [`waves/${module}/review/shots/shots.json`]: JSON.stringify({
      shots: "learn-premium review shots v1",
      module: "01-m01",
      url: "https://heat-git-module-01.vercel.app",
      commit,
      files: [
        { device: "phone", width: 375, view: 1, file: "phone.png" },
        { device: "laptop", width: 1280, view: 1, file: "laptop.png" },
      ],
    }),
  });
}

/** A meaning slip the adversarial read finds: the Summary says the opposite of the lecture. */
export const MEANING_SLIP = {
  kind: "meaning",
  content: "modules/01-m01/summary/2.md",
  screenshot: null,
  materials: { file: "L01.pdf", page: 4, box: [0.1, 0.2, 0.9, 0.4] },
  site: "In a series wall the largest temperature drop is across the layer with the smallest resistance.",
  source: "The lecture: the same heat flows through every layer, so the largest drop is across the largest resistance.",
  why: "Reversed: ΔT = q·R, so the drop grows with R.",
};

export const VISUAL = {
  kind: "visual",
  content: null,
  screenshot: "waves/01/review/shots/phone.png",
  materials: { file: "L01.pdf", page: 2, box: null },
  site: "The wall figure draws three layers.",
  source: "The Professor's figure has four layers.",
  why: "A layer is missing from the redrawn figure.",
};

export function review(privateFolder: string, findings: unknown[], commit = COMMIT, module = "01") {
  writeFiles(privateFolder, {
    [`waves/${module}/review/review.json`]: JSON.stringify({
      review: "learn-premium review v1",
      module,
      commit,
      findings,
    }),
  });
}

export function verdicts(privateFolder: string, list: unknown[], module = "01") {
  writeFiles(privateFolder, { [`waves/${module}/review/verdicts.json`]: JSON.stringify({ verdicts: list }) });
}
