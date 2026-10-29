// Asking PubChem what it calls a molecule: its formula and InChIKey for a name, recorded once at an
// explicit online step (`npm run pubchem`). Pure apart from the fetch it is handed, so the build,
// the gates and every test read only the committed records and never touch the network.
import { PUBCHEM_RECORD, type PubchemRecord } from "./record.ts";

export const PUBCHEM_PROPERTIES = "MolecularFormula,InChIKey,IUPACName,Title";

export const pubchemUrl = (name: string) =>
  `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/property/${PUBCHEM_PROPERTIES}/JSON`;

/** What PubChem answered: the HTTP status and the JSON body (null when it wasn't JSON). */
export type Fetched = { status: number; body: unknown };

interface Property {
  CID?: unknown;
  MolecularFormula?: unknown;
  InChIKey?: unknown;
  IUPACName?: unknown;
  Title?: unknown;
}

const propertiesOf = (body: unknown): Property[] | undefined => {
  const list = (body as { PropertyTable?: { Properties?: unknown } } | null)?.PropertyTable?.Properties;
  return Array.isArray(list) ? (list as Property[]) : undefined;
};

/**
 * The record for PubChem's answer to `name`, asked on `on`: a 200 is a compound (the first of its
 * matches), a 400 or 404 is "it doesn't know that name", and anything else says nothing about the
 * molecule, so the caller stays offline.
 */
export function recordOf(name: string, fetched: Fetched, on: string): PubchemRecord | { offline: string } {
  const base = { record: PUBCHEM_RECORD, query: name, url: pubchemUrl(name), fetched: on } as const;
  if (fetched.status === 400 || fetched.status === 404) return { ...base, found: false, status: fetched.status };
  if (fetched.status !== 200) return { offline: `PubChem answered ${fetched.status}` };
  const properties = propertiesOf(fetched.body);
  const first = properties?.[0];
  if (
    !properties ||
    typeof first?.CID !== "number" ||
    typeof first.MolecularFormula !== "string" ||
    typeof first.InChIKey !== "string"
  )
    return { offline: "PubChem's answer holds no compound properties" };
  return {
    ...base,
    found: true,
    cid: first.CID,
    formula: first.MolecularFormula,
    inchiKey: first.InChIKey,
    ...(typeof first.IUPACName === "string" ? { iupacName: first.IUPACName } : {}),
    ...(typeof first.Title === "string" ? { title: first.Title } : {}),
    matches: properties.length,
  };
}

export interface PubchemIo {
  fetch: typeof fetch;
  /** Today, as `YYYY-MM-DD`. */
  today: () => string;
  wait: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/**
 * Asks PubChem for `name`: one retry after a second when it is busy (503), a 15 s timeout, and a
 * rejected fetch (no network, a timeout) is offline, not a crash.
 */
export async function fetchPubchem(name: string, io: PubchemIo): Promise<Fetched | { offline: string }> {
  const ask = async (): Promise<Fetched> => {
    const response = await io.fetch(pubchemUrl(name), {
      signal: AbortSignal.timeout(io.timeoutMs ?? 15_000),
      headers: { accept: "application/json" },
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  try {
    let fetched = await ask();
    if (fetched.status === 503) {
      await io.wait(1000);
      fetched = await ask();
    }
    return fetched;
  } catch (error) {
    return { offline: error instanceof Error ? error.message : String(error) };
  }
}

/** Asks PubChem for `name` and records what it answered. */
export async function askPubchem(name: string, io: PubchemIo): Promise<PubchemRecord | { offline: string }> {
  const fetched = await fetchPubchem(name, io);
  return "offline" in fetched ? fetched : recordOf(name, fetched, io.today());
}
