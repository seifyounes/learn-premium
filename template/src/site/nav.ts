// The fixed nav: Modules · Master Rules · Lab · Exam room · Revision · About. Revision is there only
// once a sitting is complete (no stub), and the Exam room only once a complete sitting has a past
// paper: until then neither exists.
import type { Sitting } from "../content/contract.ts";

export type NavKey = "modules" | "rules" | "lab" | "exam" | "revision" | "about";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
}

export const revisionHref = (sitting: Pick<Sitting, "id">) => `/revision/${sitting.id}/`;

/** A sitting's Exam room, and (with a `variant`) one of its papers or mocks. */
export const examHref = (sitting: Pick<Sitting, "id">, variant?: string) =>
  `/exam/${sitting.id}/${variant === undefined ? "" : `${variant}/`}`;

/**
 * The nav's items. Revision opens the last complete sitting in course.yaml (sittings are listed
 * in exam order), and that page links to the others; the Exam room does the same for the last
 * sitting in `examRooms` (the ids of the sittings that have one).
 */
export function navItems(sittings: readonly Sitting[], examRooms: readonly string[] = []): NavItem[] {
  const revision = sittings.filter((s) => s.complete).at(-1);
  const exam = sittings.filter((s) => examRooms.includes(s.id)).at(-1);
  return [
    { key: "modules", label: "Modules", href: "/" },
    { key: "rules", label: "Master Rules", href: "/rules/" },
    { key: "lab", label: "Lab", href: "/lab/" },
    ...(exam ? [{ key: "exam" as const, label: "Exam room", href: examHref(exam) }] : []),
    ...(revision ? [{ key: "revision" as const, label: "Revision", href: revisionHref(revision) }] : []),
    { key: "about", label: "About", href: "/about/" },
  ];
}
