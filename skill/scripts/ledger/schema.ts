// A small schema checker: each schema validates an unknown value and returns it typed, or throws
// with the path of the first bad field. The Build ledger's types are inferred from its schema, so
// the check and the types can't drift apart. No dependencies: the scripts run straight from the
// release worktree with nothing installed.

export class SchemaError extends Error {}

export type Schema<T> = (value: unknown, path: string) => T;
export type Infer<S> = S extends Schema<infer T> ? T : never;

export function fail(path: string, expected: string, value: unknown): never {
  throw new SchemaError(`${path}: expected ${expected}, got ${JSON.stringify(value) ?? String(value)}`);
}

export const nonEmpty: Schema<string> = (v, p) =>
  typeof v === "string" && v.trim() !== "" ? v : fail(p, "a non-empty string", v);

export const bool: Schema<boolean> = (v, p) => (typeof v === "boolean" ? v : fail(p, "true or false", v));

export const sha256: Schema<string> = (v, p) =>
  typeof v === "string" && /^[0-9a-f]{64}$/.test(v) ? v : fail(p, "a sha256 hex digest", v);

export const isoTime: Schema<string> = (v, p) =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : fail(p, "an ISO timestamp", v);

export const isoDate: Schema<string> = (v, p) =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
    ? v
    : fail(p, "a date (YYYY-MM-DD)", v);

export function oneOf<const T extends readonly string[]>(...values: T): Schema<T[number]> {
  return (v, p) => (values.includes(v as string) ? (v as T[number]) : fail(p, `one of ${values.join(" | ")}`, v));
}

export function nullable<T>(schema: Schema<T>): Schema<T | null> {
  return (v, p) => (v === null ? null : schema(v, p));
}

export function arr<T>(item: Schema<T>): Schema<T[]> {
  return (v, p) => (Array.isArray(v) ? v.map((x, i) => item(x, `${p}[${i}]`)) : fail(p, "a list", v));
}

export function record<T>(value: Schema<T>): Schema<Record<string, T>> {
  return (v, p) => {
    if (!isPlainObject(v)) fail(p, "an object", v);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, value(x, `${p}.${k}`)]));
  };
}

/** An object with exactly these keys: a missing or unknown key is an error, so hand edits show up. */
export function obj<S extends Record<string, Schema<unknown>>>(shape: S): Schema<{ [K in keyof S]: Infer<S[K]> }> {
  return (v, p) => {
    if (!isPlainObject(v)) fail(p, "an object", v);
    for (const key of Object.keys(v)) if (!(key in shape)) fail(`${p}.${key}`, "no such field", v[key]);
    const out: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(shape)) {
      if (!(key in v)) fail(`${p}.${key}`, "a value", undefined);
      out[key] = schema(v[key], `${p}.${key}`);
    }
    return out as { [K in keyof S]: Infer<S[K]> };
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
