// Which npm package a bundled module came from, and what that package says about its licence.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageNotice } from "./file.ts";

/**
 * The folder of the package a bundled module id sits in (the innermost `node_modules/<name>` or
 * `node_modules/@scope/<name>`), or undefined for the site's own code.
 */
export function packageDirOf(moduleId: string): string | undefined {
  const id = moduleId
    .replace(/^\0/, "")
    .replace(/[?#].*$/, "")
    .replace(/\\/g, "/");
  const at = id.lastIndexOf("/node_modules/");
  if (at === -1) return undefined;
  const rest = id.slice(at + "/node_modules/".length).split("/");
  const name = rest[0]?.startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1);
  if (name.length === 0 || name.some((part) => part === "")) return undefined;
  return `${id.slice(0, at)}/node_modules/${name.join("/")}`;
}

/** A licence or notice file a package ships: LICENSE, LICENCE.md, COPYING, NOTICE… */
const NOTICE_FILE = /^(licen[cs]e|copying|notice)([.-].*)?$/i;

interface PackageJson {
  name?: unknown;
  version?: unknown;
  license?: unknown;
  licenses?: unknown;
  repository?: unknown;
}

export function readPackage(dir: string): PackageNotice {
  const json = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PackageJson;
  if (typeof json.name !== "string" || typeof json.version !== "string")
    throw new Error(`${dir}/package.json has no name or version`);
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => NOTICE_FILE.test(f))
        .sort()
    : [];
  const texts = files.map((f) => readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n").trimEnd());
  const source = sourceOf(json.repository);
  return {
    name: json.name,
    version: json.version,
    licence: licenceOf(json),
    ...(source === undefined ? {} : { source }),
    text: texts.length > 0 ? texts.join("\n\n") : "(The package ships no licence text.)",
  };
}

/** The SPDX expression a package.json declares, including the old `{ type }` and `licenses` forms. */
function licenceOf({ license, licenses }: PackageJson): string | undefined {
  const typeOf = (value: unknown) =>
    typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof (value as { type?: unknown }).type === "string"
        ? (value as { type: string }).type
        : undefined;
  if (license !== undefined) return typeOf(license);
  if (Array.isArray(licenses)) {
    const types = licenses.map(typeOf);
    if (types.length > 0 && types.every((t) => t !== undefined)) return types.join(" OR ");
  }
  return undefined;
}

function sourceOf(repository: unknown): string | undefined {
  const url =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object" && typeof (repository as { url?: unknown }).url === "string"
        ? (repository as { url: string }).url
        : undefined;
  if (url === undefined) return undefined;
  if (/^github:|^[\w-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url.replace(/^github:/, "")}`;
  return url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/\.git$/, "");
}
