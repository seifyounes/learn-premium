// The Go-public check's path and secret rules: each rule on the defect it plants, and every rule
// on what a Course project legitimately carries (the Site template and the Fixture Course).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { evidenceShape } from "../scripts/go-public/evidence.ts";
import { findSecrets, secretPath } from "../scripts/go-public/secrets.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));

/** The files a Course project carries, as this repo holds them: the Site template and the Fixture Course. */
function courseProjectFiles(): string[] {
  const listed = spawnSync("git", ["-C", REPO, "ls-files", "-z", "template", "fixture-course"], {
    encoding: "utf8",
  });
  return listed.stdout.split("\0").filter(Boolean);
}

describe("evidence-shaped paths", () => {
  test.each([
    ["private/q3.md", "private-folder"],
    ["notes/Heat Transfer Private/q3.md", "private-folder"],
    ["notes/heat_private/q3.md", "private-folder"],
    ["work/reader/L01.pdf/pages/page-001.png", "reader-output"],
    ["reader/deck.pptx/transcripts/clip-1.json", "reader-output"],
    ["scans/page-012.png", "page-render"],
    ["transcripts/L03.json", "transcription"],
    ["notes/L03-transcription.md", "transcription"],
    ["notes/L03.transcript.txt", "transcription"],
    ["m01/crops/fig-2.png", "crop"],
    ["m01/quotes/q1.md", "quote"],
    ["m01/blind-readings/a.json", "blind-reading"],
    ["Materials/L01.pdf", "materials-copy"],
    ["build/evidence/recompute.log", "evidence-folder"],
  ])("%s is evidence-shaped (%s)", (path, rule) => {
    expect(evidenceShape(path)).toMatchObject({ rule });
  });

  test.each([
    "src/components/Quote.astro",
    "public/licences.txt",
    "src/crop-marks.css",
    "skill/scripts/reader/pdf.py",
    "src/islands/transcript-panel.tsx",
  ])("%s is not", (path) => {
    expect(evidenceShape(path)).toBeNull();
  });

  test("nothing the Site template or the Fixture Course carries is evidence-shaped", () => {
    const files = courseProjectFiles();

    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((path) => evidenceShape(path) !== null)).toEqual([]);
  });
});

describe("secrets", () => {
  // Built at run time so no token-shaped string sits in this repo for a secret scanner to trip on.
  const join = (...parts: string[]) => parts.join("");
  test.each([
    ["private-key", join("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIE...\n")],
    ["aws-access-key", join("aws = AKIA", "Q7R2S4T6U8V0W2X4")],
    ["github-token", join("gho_", "a".repeat(20), "B".repeat(16))],
    ["github-token", join("github_pat_", "11ABCDEFG0", "x".repeat(50))],
    ["anthropic-api-key", join("sk-ant-", "api03-", "Ab3".repeat(10))],
    ["openai-api-key", join("sk-proj-", "Zx9".repeat(12))],
    ["google-api-key", join("AIza", "Sy", "D".repeat(33))],
    ["slack-token", join("xoxb-", "1234567890-", "abcdefABCDEF")],
    ["stripe-live-key", join("sk_live_", "4eC39HqLyjWDarjtT1zdp7dc")],
    ["npm-token", join("npm_", "a1".repeat(18))],
    ["huggingface-token", join("hf_", "Ab".repeat(17))],
    ["npmrc-auth", join("//registry.npmjs.org/:_auth", "Token=abc123def456")],
    ["url-credentials", join("git remote add o https://owner:", "s3cretpass@github.com/x.git")],
    ["secret-assignment", join('VERCEL_TOKEN = "', "Xk2Lp9Qr4Ts7Vw1Yz3Bn", '"')],
  ])("%s is found", (rule, text) => {
    expect(findSecrets(text).map((found) => found.rule)).toEqual([rule]);
  });

  test("a specific rule wins over the generic assignment on the same line", () => {
    const text = `token: ${["ghp", "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2"].join("_")}`;

    expect(findSecrets(text).map((found) => found.rule)).toEqual(["github-token"]);
  });

  test("an .npmrc reading its token from the environment is not a secret", () => {
    expect(findSecrets("//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n")).toEqual([]);
  });

  test("findings carry the line and a redacted preview, never the value", () => {
    const key = ["sk", "ant", "api03", "Q".repeat(40)].join("-");

    const [found] = findSecrets(`a\nb\nkey = "${key}"\n`);

    expect(found).toMatchObject({ rule: "anthropic-api-key", line: 3 });
    expect(JSON.stringify(found)).not.toContain(key.slice(8));
  });

  test.each([
    [".env", "env-file"],
    ["config/.env.production", "env-file"],
    ["keys/id_ed25519", "ssh-key"],
    ["certs/site.pem", "key-file"],
    ["certs/site.p12", "key-file"],
    ["certs/site.pfx", "key-file"],
    ["android/release.jks", "key-file"],
    ["android/release.keystore", "key-file"],
  ])("%s is a secret by its path (%s)", (path, rule) => {
    expect(secretPath(path)).toMatchObject({ rule });
  });

  test.each([".env.example", "keys/id_ed25519.pub", "src/keyboard.ts"])("%s is not", (path) => {
    expect(secretPath(path)).toBeNull();
  });

  test("nothing the Site template or the Fixture Course carries holds a secret", () => {
    const flagged = courseProjectFiles().flatMap((path) => {
      const content = readFileSync(`${REPO}/${path}`);
      if (content.subarray(0, 8000).includes(0)) return [];
      const found = [secretPath(path), ...findSecrets(content.toString("utf8"))].filter((hit) => hit !== null);
      return found.map((hit) => `${path}: ${hit.rule}`);
    });

    expect(flagged).toEqual([]);
  });
});
