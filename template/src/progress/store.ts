// The browser side of progress: kept in localStorage, one record for the whole Study site. Where
// storage is blocked (a private window, cleared site data) progress lives for the page only, and
// the site works the same. Every change is announced so the rail can mark sections done.
import { emptyProgress, parseProgress, type Progress } from "./progress.ts";

/** Where progress is stored. */
const STORAGE_KEY = "learn-premium:progress";
/** The event announcing a change on this page. */
const CHANGED = "learn-premium:progress-changed";

/** Progress for this page when storage can't hold it. */
let unsaved: Progress | undefined;

export function readProgress(): Progress {
  if (unsaved) return unsaved;
  try {
    return parseProgress(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyProgress();
  }
}

export function updateProgress(change: (p: Progress) => Progress): void {
  const next = change(readProgress());
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    unsaved = undefined;
  } catch {
    unsaved = next;
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

/** Calls `listener` whenever progress changes, here or in another tab. */
export function onProgress(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGED, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED, listener);
    window.removeEventListener("storage", onStorage);
  };
}
