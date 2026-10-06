// The Template release sequence's commands. What each does: docs/release.md.
//
//   status             [--sha SHA] [--bump major|minor|patch | --version vX.Y.Z]
//   notes              (--bump KIND | --version vX.Y.Z) [--sha SHA] [--out FILE]
//   record-phone-pass  --sha SHA --devices TEXT --pyodide-seconds N [--url URL]   (the Owner's)
//   tag                (--bump KIND | --version vX.Y.Z) [--sha SHA] [--notes FILE] [--dry-run]
//
// The candidate is origin/main's tip unless --sha names another commit on it.
// Exit codes: 0 done (or ready), 1 refused (or not ready), 2 bad usage.
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { NotesError, parseNotes, renderNotes, withPhonePass, type Bump } from "./notes.ts";
import { draftNotes, PHONE_PASS_CONTEXT, plan, steps, type Deps, type Plan, type Steps } from "./sequence.ts";

export interface CliDeps extends Deps {
  /** Asks the Owner a yes/no question in their terminal; false when nobody can answer. */
  confirm(question: string): Promise<boolean>;
}

export interface CliResult {
  code: number;
  stdout: string;
}

class UsageError extends Error {}

const BUMPS = ["major", "minor", "patch"] as const;

/** GitHub keeps at most this much of a commit status's description. */
const STATUS_DESCRIPTION_MAX = 140;

/** The pass as a commit status records it: the phones, then the Pyodide timing. */
const passDescription = (devices: string, seconds: string) => `${devices} · Pyodide ${seconds} s`;

function stepLines(s: Steps): string[] {
  const block = (n: number, title: string, step: { ok: boolean; lines: string[] }) => [
    `${n}. ${title}: ${step.ok ? "yes" : "no"}`,
    ...step.lines.map((line) => `   ${line}`),
  ];
  return [
    ...block(1, "CI green", s.ci),
    ...block(2, "Tool gallery deployed, live gates green", s.gallery),
    ...block(3, "Real-phone pass", s.pass),
  ];
}

function planLines(p: Plan): string[] {
  if (p.version === null) return p.problems.map((problem) => `   ${problem}`);
  return [
    `   ${p.version} (${p.kind}), previous release: ${p.previous ?? "none"}`,
    ...p.problems.map((problem) => `   refused: ${problem}`),
  ];
}

export async function run(argv: string[], deps: CliDeps): Promise<CliResult> {
  const out: string[] = [];
  try {
    return { code: await main(argv, deps, out), stdout: out.join("\n") };
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    out.push(error.message);
    return { code: 2, stdout: out.join("\n") };
  }
}

async function main(argv: string[], deps: CliDeps, out: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      sha: { type: "string" },
      bump: { type: "string" },
      version: { type: "string" },
      out: { type: "string" },
      notes: { type: "string" },
      devices: { type: "string" },
      "pyodide-seconds": { type: "string" },
      url: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const command = positionals[0];
  if (values.bump !== undefined && !BUMPS.includes(values.bump as Bump))
    throw new UsageError(`--bump takes ${BUMPS.join(", ")}`);
  const wanted = {
    ...(values.bump === undefined ? {} : { bump: values.bump as Bump }),
    ...(values.version === undefined ? {} : { version: values.version }),
  };
  const needVersion = () => {
    if (wanted.bump === undefined && wanted.version === undefined)
      throw new UsageError(`${command} takes --bump major|minor|patch or --version vX.Y.Z`);
  };

  if (command === "record-phone-pass") {
    if (values.sha === undefined || values.devices === undefined || values["pyodide-seconds"] === undefined)
      throw new UsageError("record-phone-pass takes --sha SHA --devices TEXT --pyodide-seconds N");
    if (!/^\d+(\.\d+)?$/.test(values["pyodide-seconds"]))
      throw new UsageError("--pyodide-seconds is the Pyodide run's time on the phone, in seconds");
    const description = passDescription(values.devices, values["pyodide-seconds"]);
    if (description.length > STATUS_DESCRIPTION_MAX)
      throw new UsageError(
        `the pass record "${description}" is over GitHub's ${STATUS_DESCRIPTION_MAX} characters; shorten --devices`,
      );
  } else if (command === "notes" || command === "tag") needVersion();
  else if (command !== "status")
    throw new UsageError(`unknown command "${command ?? ""}"; use status, notes, record-phone-pass or tag`);

  deps.git.fetch();
  const main = deps.git.resolve(deps.git.mainRef);
  let sha: string;
  try {
    sha = values.sha === undefined ? main : deps.git.resolve(values.sha);
  } catch {
    out.push(`refused: ${values.sha} names no commit here`);
    return 1;
  }
  out.push(`Candidate ${sha}${sha === main ? ` (${deps.git.mainRef})` : ""}`);
  if (!deps.git.isAncestor(sha, main)) {
    out.push(`refused: the candidate is not on ${deps.git.mainRef}; a release is cut from main`);
    return 1;
  }

  switch (command) {
    case "status": {
      const s = await steps(deps, sha);
      out.push(...stepLines(s));
      let ready = s.ci.ok && s.gallery.ok && s.pass.ok;
      if (s.ci.ok && s.gallery.ok && !s.pass.ok) {
        out.push(
          "   The Owner tries the Tool gallery above on a real phone (every sim by touch, the 3D viewer, the",
          "   Pyodide run timed), then records the pass in their own terminal:",
          `   node skill/scripts/release.ts record-phone-pass --sha ${sha} --devices "<phones and browsers>" --pyodide-seconds <N>`,
        );
      }
      if (wanted.bump !== undefined || wanted.version !== undefined) {
        const p = plan(deps.git, sha, wanted);
        out.push("4. Tag:", ...planLines(p));
        ready &&= p.problems.length === 0;
      }
      out.push(ready ? "ready to tag" : "not ready to tag");
      return ready ? 0 : 1;
    }
    case "notes": {
      const p = plan(deps.git, sha, wanted);
      if (p.version === null || p.kind === null) {
        out.push(...planLines(p));
        return 1;
      }
      const pass = (await steps(deps, sha)).pass.pass;
      const draft = await draftNotes(deps, sha, { version: p.version, previous: p.previous, kind: p.kind }, pass);
      const notes = renderNotes(draft.input);
      if (values.out !== undefined) {
        writeFileSync(values.out, notes);
        out.push(`notes written to ${values.out}`);
      } else out.push("", notes);
      out.push(...p.problems.map((problem) => `refused when tagging: ${problem}`));
      out.push(...draft.checks.map((check) => `check: ${check}`));
      return 0;
    }
    case "record-phone-pass": {
      const s = await steps(deps, sha);
      if (!s.ci.ok || !s.gallery.ok) {
        out.push(
          ...stepLines(s),
          "refused: the real-phone pass comes after CI and the Tool gallery's live gates are green",
        );
        return 1;
      }
      const [owner, viewer] = [await deps.forge.owner(), await deps.forge.viewer()];
      if (owner !== viewer) {
        out.push(`refused: only the Owner (@${owner}) records the real-phone pass; gh is signed in as @${viewer}`);
        return 1;
      }
      const url = values.url ?? s.gallery.url;
      const description = passDescription(values.devices ?? "", values["pyodide-seconds"] ?? "");
      const yes = await deps.confirm(
        `Did you go through the Tool gallery at ${url ?? "(no URL)"} on a real phone (${values.devices}), ` +
          `and did every tool work by touch? Type yes to record the pass on ${sha.slice(0, 7)}`,
      );
      if (!yes) {
        out.push("not recorded: the Owner didn't confirm the pass");
        return 1;
      }
      await deps.forge.setStatus(sha, { state: "success", context: PHONE_PASS_CONTEXT, description, targetUrl: url });
      out.push(`recorded the real-phone pass on ${sha}: ${description}`);
      return 0;
    }
    case "tag": {
      const s = await steps(deps, sha);
      const p = plan(deps.git, sha, wanted);
      const refusals = [
        ...(s.ci.ok && s.gallery.ok && s.pass.ok ? [] : ["the release sequence isn't complete on this commit"]),
        ...p.problems,
      ];
      let notes: string | null = null;
      if (refusals.length === 0 && p.version !== null && p.kind !== null) {
        if (values.notes !== undefined) {
          // The Owner words the notes; the pass section always states the pass as recorded.
          notes = withPhonePass(readFileSync(values.notes, "utf8"), s.pass.pass);
          try {
            // A draft made for another version or commit would advertise the wrong release.
            const parsed = parseNotes(notes);
            if (parsed.version !== p.version)
              refusals.push(`${values.notes} is written for ${parsed.version ?? "no version"}, not ${p.version}`);
            if (parsed.sha !== sha)
              refusals.push(`${values.notes} is written for commit ${parsed.sha ?? "(none)"}, not ${sha}`);
          } catch (error) {
            if (!(error instanceof NotesError)) throw error;
            refusals.push(`${values.notes}: ${error.message}`);
          }
        } else {
          const draft = await draftNotes(
            deps,
            sha,
            { version: p.version, previous: p.previous, kind: p.kind },
            s.pass.pass,
          );
          notes = renderNotes(draft.input);
          out.push(...draft.checks.map((check) => `check: ${check}`));
        }
      }
      if (refusals.length > 0 || notes === null || p.version === null) {
        out.push(...stepLines(s), "4. Tag:", ...planLines(p), ...refusals.map((r) => `refused: ${r}`));
        return 1;
      }
      out.push(...stepLines(s), "4. Tag:", ...planLines(p), "", notes);
      if (values["dry-run"]) {
        out.push(`dry run: ${p.version} not tagged`);
        return 0;
      }
      deps.git.tag(p.version, sha, notes);
      out.push(`tagged ${p.version} on ${sha} and pushed it to origin`);
      try {
        out.push(`GitHub Release: ${await deps.forge.createRelease(p.version, `learn-premium ${p.version}`, notes)}`);
      } catch (error) {
        out.push(
          `the tag is out, but the GitHub Release failed (${(error as Error).message}); publish it with:`,
          `gh release create ${p.version} --verify-tag --title "learn-premium ${p.version}" --notes-from-tag`,
        );
      }
      return 0;
    }
  }
  throw new UsageError(`unknown command "${command ?? ""}"`);
}
