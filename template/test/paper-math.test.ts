import { describe, expect, it } from "vitest";
import { renderProse } from "../src/math/katex.ts";

const render = (text: string) => renderProse(text, () => ({ file: "test", line: 1 }));

describe("prose with paper math", () => {
  it("keeps punctuation written after inline math on the math's line", () => {
    const html = render("held at $T_4$. Find $\\dot{Q}$, then stop");
    expect(html).toMatch(/^held at <span class="whitespace-nowrap"><span class="katex">.*<\/span>\.<\/span> Find /);
    expect(html).toMatch(/<span class="whitespace-nowrap"><span class="katex">.*<\/span>,<\/span> then stop$/);
  });

  it("leaves math with no punctuation after it, and display math, unwrapped", () => {
    expect(render("so $x$ and")).not.toContain("whitespace-nowrap");
    expect(render("$$x = 1$$.")).not.toContain("whitespace-nowrap");
  });
});
