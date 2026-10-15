// Scoring a sitting of a paper. A numeric question is checked by the site; a written one is marked
// by the student, so a paper of written answers has no score until they mark it. Pure: the paper
// island is a thin view over it.

/** One question's marks as the sitting stands: `got` is null while a written answer is unmarked. */
export type Mark =
  { kind: "numeric"; marks: number; correct: boolean } | { kind: "prose"; marks: number; got: number | null };

export interface PaperScore {
  /** The numeric questions, which the site checks. */
  checked: { got: number; of: number };
  /** The written questions: marks the student has given, of how many, with how many questions still unmarked. */
  self: { got: number; of: number; pending: number };
  /** The whole paper; null while a written answer is unmarked, since a total of part of a paper is no score. */
  total: { got: number; of: number } | null;
}

export function paperScore(marks: readonly Mark[]): PaperScore {
  const checked = { got: 0, of: 0 };
  const self = { got: 0, of: 0, pending: 0 };
  for (const m of marks) {
    if (m.kind === "numeric") {
      checked.of += m.marks;
      if (m.correct) checked.got += m.marks;
    } else {
      self.of += m.marks;
      if (m.got === null) self.pending += 1;
      else self.got += m.got;
    }
  }
  const total = self.pending > 0 ? null : { got: checked.got + self.got, of: checked.of + self.of };
  return { checked, self, total };
}

/**
 * How a result reads: "9 / 10" once every question is marked; "7 / 8 auto-checked · mark 2
 * yourself" while written answers wait; a paper of written answers only says it is sat and the
 * student marks it, never a hollow "0 / 0".
 */
export function resultLabel(score: PaperScore): string {
  if (score.total) return `${score.total.got} / ${score.total.of}`;
  if (score.checked.of === 0) return "Sat, mark it yourself";
  return `${score.checked.got} / ${score.checked.of} auto-checked · mark ${score.self.pending} yourself`;
}

/** A countdown as `mm:ss` (minutes run past 99 when the paper does). */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
