// A Module's media files: the ones its `media.yaml` names, in the Module's `media/` folder,
// published at `/<module>/media/<file>`. The page, the content gate and the publishing integration
// all read them through here.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "astro/zod";
import type { media } from "../content/contract.ts";

export type Media = z.output<typeof media>;

export const mediaFolder = (contentDir: string, module: string) => join(contentDir, "modules", module, "media");

export const mediaUrl = (module: string, file: string) => `/${module}/media/${file}`;

/** Every file a Module's media names. */
export function mediaFiles(m: Media): string[] {
  return [m.video?.file, m.video?.captions, m.audio?.file, m.infographic?.file].filter(
    (file): file is string => file !== undefined,
  );
}

/** The files a Module's media names that its `media/` folder doesn't hold. */
export const missingMediaFiles = (contentDir: string, module: string, m: Media) =>
  mediaFiles(m).filter((file) => !existsSync(join(mediaFolder(contentDir, module), file)));

/** A PNG's pixel size, read from its header, so the page reserves the infographic's room. */
export function pngSize(path: string): { width: number; height: number } {
  const header = readFileSync(path).subarray(0, 24);
  const signature = "89504e470d0a1a0a";
  if (header.subarray(0, 8).toString("hex") !== signature || header.subarray(12, 16).toString("ascii") !== "IHDR")
    throw new Error(`${path} is not a PNG`);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

export const MEDIA_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  png: "image/png",
  vtt: "text/vtt",
};
