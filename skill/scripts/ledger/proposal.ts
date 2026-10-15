// A Module map addition proposed for Materials the ledger hasn't inventoried yet.
import { proposeModuleMap } from "../intake/propose.ts";
import { current, type Ledger, type ModuleMap } from "./model.ts";

/**
 * The proposal intake would make for `files`, fitted to the Modules already mapped: a draft Module whose
 * id is a current Module takes that Module's slug and title (so `ledger map` adds the files to it); any
 * other id is a new Module; files with no number are left unmapped. The Owner confirms or edits it.
 */
export function proposeForNew(ledger: Ledger, files: { path: string }[]): ModuleMap {
  const mapped = current(ledger.modules);
  const draft = proposeModuleMap(files);
  return {
    modules: draft.modules.map((module) => {
      const existing = mapped.find((m) => m.id === module.id);
      return existing === undefined ? module : { ...module, slug: existing.slug, title: existing.title };
    }),
    unmapped: draft.unmapped,
  };
}
