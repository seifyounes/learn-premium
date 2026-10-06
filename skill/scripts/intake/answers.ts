// The intake interview's answers, as one JSON file the agent writes once the Owner has confirmed
// them: what the Build ledger records (`ledgerIntake`), plus what the course config's Credit line
// and About page need.
import { moduleCount, type Intake } from "../ledger/model.ts";
import { arr, bool, fail, isoDate, nonEmpty, nullable, obj, type Infer, type Schema } from "../ledger/schema.ts";
import { PAD_COLOURS } from "../media/pads.ts";

/** Lower-case words joined by dashes: an Exam sitting's route, the Course project's folder and repo name. */
const kebab =
  (what: string): Schema<string> =>
  (v, p) =>
    typeof v === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) ? v : fail(p, `${what} in lower-case-dashes`, v);

/** A catalogue pad's key, or the colour (#RRGGBB) the Owner named for a custom pad. */
const pad: Schema<string> = (v, p) =>
  typeof v === "string" && (Object.hasOwn(PAD_COLOURS, v) || /^#[0-9A-Fa-f]{6}$/.test(v))
    ? v
    : fail(p, `a catalogue pad (${Object.keys(PAD_COLOURS).join(", ")}) or a colour #RRGGBB`, v);

const sittings: Schema<{ id: string; name: string; date: string | null }[]> = (v, p) => {
  const list = arr(obj({ id: kebab("a sitting id"), name: nonEmpty, date: nullable(isoDate) }))(v, p);
  list.forEach((s, i) => {
    if (list.findIndex((other) => other.id === s.id) !== i) fail(`${p}[${i}].id`, "an id no other sitting has", s.id);
  });
  return list;
};

const disciplines: Schema<string[]> = (v, p) => {
  const list = arr(nonEmpty)(v, p);
  return list.length > 0 ? list : fail(p, "at least one Discipline (the main one first)", v);
};

export const answersSchema = obj({
  courseName: nonEmpty,
  /** The Course code, for the title block. */
  code: nonEmpty,
  /** The Course project's folder in the workspace, and its GitHub repo and Vercel project name. */
  slug: kebab("a folder name"),
  materialsPath: nonEmpty,
  /** The Owner-confirmed Disciplines, the main one (which picks the pad) first. */
  disciplines,
  pad,
  arabicNotes: bool,
  /** The Exam sittings known so far; a date only once it is known. */
  sittings,
  /** How many Modules the Owner expects this semester, for the media budget check. */
  expectedModules: moduleCount,
  /** For the Credit line in every page's footer. */
  professor: nonEmpty,
  university: nonEmpty,
  /** Who builds the Study site, for the About page. */
  owner: nonEmpty,
});

export type Answers = Infer<typeof answersSchema>;

/** The part of the answers the Build ledger records, with the Materials folder as an absolute path. */
export function ledgerIntake(answers: Answers, materialsPath: string): Intake {
  const { courseName, disciplines: confirmed, pad: chosen, arabicNotes, sittings: known, expectedModules } = answers;
  return {
    courseName,
    materialsPath,
    disciplines: confirmed,
    pad: chosen,
    arabicNotes,
    sittings: known,
    expectedModules,
  };
}
