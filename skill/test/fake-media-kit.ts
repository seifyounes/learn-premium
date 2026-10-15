// A fake media kit for the Media pass tests: it stands in for the Python kit (PyAV, Pillow, Whisper), so
// no Node test ever needs Python. `evidence` writes what the real kit writes, with a synthetic
// transcript; `encode` writes a file whose size the test chooses, or the master's bytes plus a marker
// naming the profile, so a web copy never equals its master.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { createHash } from "node:crypto";
import type { KitRequest, MediaKit } from "../scripts/media/kit.ts";
import { FIXTURE_MEDIA } from "./media-course.ts";

export interface FakeKit extends MediaKit {
  /** Every call in order: `evidence`, `encode` (standard), `encode-harder`, with the master's file name. */
  calls: { call: "evidence" | "encode" | "encode-harder"; master: string; kind: KitRequest["kind"] }[];
}

/**
 * `transcript` is what Whisper "heard" in every audio and video. `sizes` gives the bytes of the encodes of an
 * item, in order (standard, then harder); an item with none writes the master plus a profile marker.
 */
export function fakeKit(options: { transcript?: unknown; sizes?: Record<string, number[]> } = {}): FakeKit {
  const calls: FakeKit["calls"] = [];
  const tries: Record<string, number> = {};
  const itemOf = (master: string) => basename(master, extname(master)).replace(/-\d+$/, "");
  return {
    calls,
    evidence(r) {
      calls.push({ call: "evidence", master: basename(r.master), kind: r.kind });
      mkdirSync(r.out, { recursive: true });
      const hash = createHash("sha256").update(readFileSync(r.master)).digest("hex");
      const talks = r.kind !== "infographic";
      const frames = r.kind === "video" ? ["frames/frame-001.png", "frames/frame-002.png"] : [];
      for (const frame of frames) {
        mkdirSync(dirname(join(r.out, frame)), { recursive: true });
        copyFileSync(join(FIXTURE_MEDIA, "infographic.png"), join(r.out, frame));
      }
      if (talks) writeFileSync(join(r.out, "transcript.json"), JSON.stringify(options.transcript ?? { segments: [] }));
      writeFileSync(
        join(r.out, "evidence.json"),
        JSON.stringify({
          evidence: "learn-premium media evidence v1",
          kind: r.kind,
          masterHash: hash,
          duration: talks ? 4 : null,
          transcript: talks ? "transcript.json" : null,
          frames,
          image: talks ? null : r.master,
        }),
      );
      return { ok: true };
    },
    encode(r) {
      const item = itemOf(r.master);
      calls.push({ call: r.harder ? "encode-harder" : "encode", master: basename(r.master), kind: r.kind });
      const n = (tries[item] = (tries[item] ?? -1) + 1);
      const size = options.sizes?.[item]?.[n];
      mkdirSync(dirname(r.out), { recursive: true });
      const master = readFileSync(r.master);
      writeFileSync(
        r.out,
        size === undefined
          ? Buffer.concat([master, Buffer.from(`web:${r.harder ? "harder" : "standard"}`)])
          : Buffer.alloc(size, 7),
      );
      return { ok: true, duration: r.kind === "infographic" ? null : 4 };
    },
  };
}
