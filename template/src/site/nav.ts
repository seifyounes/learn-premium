// The fixed nav: Modules · Master Rules · Lab · Exam room · Revision · About. Exam room and
// Revision are there only once a sitting is complete (no stub): until then they don't exist.
import type { z } from "astro/zod";
import type { course } from "../content/contract.ts";

type Sitting = z.infer<typeof course>["sittings"][number];

export type NavKey = "modules" | "rules" | "lab" | "exam" | "revision" | "about";

export interface NavItem {
  key: NavKey;
  label: string;
  href: string;
}

export const revisionHref = (sitting: Pick<Sitting, "id">) => `/revision/${sitting.id}/`;

/**
 * The nav's items. Revision opens the last complete sitting in course.yaml (sittings are listed
 * in exam order), and that page links to the others. The Exam room joins with #74.
 */
export function navItems(sittings: readonly Sitting[]): NavItem[] {
  const revision = sittings.filter((s) => s.complete).at(-1);
  return [
    { key: "modules", label: "Modules", href: "/" },
    { key: "rules", label: "Master Rules", href: "/rules/" },
    { key: "lab", label: "Lab", href: "/lab/" },
    ...(revision ? [{ key: "revision" as const, label: "Revision", href: revisionHref(revision) }] : []),
    { key: "about", label: "About", href: "/about/" },
  ];
}
