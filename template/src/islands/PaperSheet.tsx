// One past paper or mock, sat on the page: untimed (Practise) or against the clock (Start timed,
// which submits itself when the time is up). A numeric answer is checked by the site; a written
// one is marked by the student against the model answer and what earns the marks, so a paper of
// written answers says it is sat and to mark it yourself, never 0/0. A fully marked paper's result
// is kept in this browser (Save result); a mock's best one joins the sitting's readiness.
import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { formatClock, paperScore, resultLabel, type Mark } from "../exam/score.ts";
import { checkNumeric, type NumericResult } from "../practice/check.ts";
import { recordPaper } from "../progress/progress.ts";
import { updateProgress } from "../progress/store.ts";
import { DoneTick, PenVerdict } from "./worked/pen.tsx";

interface QuestionProps {
  /** Its number: its order on the paper. */
  n: number;
  marks: number;
  /** The question, rendered to HTML (paper math) at build. */
  questionHtml: string;
  answer:
    | { kind: "numeric"; value: number; tolerance: number; unitHtml?: string }
    | { kind: "prose"; modelHtml: string; earnsHtml: string[] };
}

interface Props {
  /** Where the result is kept: `<sitting>/<variant>`. */
  progressKey: string;
  minutes: number;
  questions: QuestionProps[];
}

type Mode = "idle" | "timed" | "practice";

export default function PaperSheet({ progressKey, minutes, questions }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const draw = !(useReducedMotion() ?? false);
  const [mode, setMode] = useState<Mode>("idle");
  const [left, setLeft] = useState(minutes * 60);
  const [submitted, setSubmitted] = useState(false);
  const [timeUp, setTimeUp] = useState(false);
  const [typed, setTyped] = useState<string[]>(() => questions.map(() => ""));
  const [earned, setEarned] = useState<ReadonlySet<number>[]>(() => questions.map(() => new Set()));
  const [marked, setMarked] = useState<boolean[]>(() => questions.map(() => false));
  const [saved, setSaved] = useState(false);

  // The clock runs from the moment Start timed is pressed, and submits the paper at zero.
  useEffect(() => {
    if (mode !== "timed" || submitted) return;
    const deadline = Date.now() + minutes * 60_000;
    const tick = () => {
      const remaining = (deadline - Date.now()) / 1000;
      setLeft(Math.max(0, remaining));
      if (remaining <= 0) {
        setTimeUp(true);
        setSubmitted(true);
      }
    };
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [mode, submitted, minutes]);

  const verdicts: NumericResult[] = questions.map((q, i) =>
    q.answer.kind === "numeric" ? checkNumeric(typed[i] ?? "", q.answer) : "unreadable",
  );
  const marks: Mark[] = questions.map((q, i) =>
    q.answer.kind === "numeric"
      ? { kind: "numeric", marks: q.marks, correct: verdicts[i] === "right" }
      : { kind: "prose", marks: q.marks, got: marked[i] ? (earned[i]?.size ?? 0) : null },
  );
  const score = paperScore(marks);
  const fieldsOn = ready && mode !== "idle" && !submitted;
  const set = <T,>(list: T[], i: number, value: T) => list.map((x, j) => (j === i ? value : x));

  const submit = () => setSubmitted(true);
  const save = () => {
    if (!score.total) return;
    const result = { got: score.total.got, of: score.total.of, at: new Date().toISOString() };
    updateProgress((p) => recordPaper(p, progressKey, result));
    setSaved(true);
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="paper-sheet">
        <div className="paper-controls">
          {mode === "idle" && (
            <>
              <button
                type="button"
                className="button-print label-action"
                disabled={!ready}
                onClick={() => setMode("timed")}
              >
                Start timed (<span dir="ltr">{formatClock(minutes * 60)}</span>)
              </button>
              <button
                type="button"
                className="button-print label-action"
                disabled={!ready}
                onClick={() => setMode("practice")}
              >
                Practise
              </button>
            </>
          )}
          {mode === "timed" && (
            <p className="paper-clock font-quantity text-quantity" role="timer" dir="ltr" data-clock>
              {formatClock(left)}
            </p>
          )}
          {mode !== "idle" && !submitted && (
            <button type="button" className="button-print label-action" disabled={!ready} onClick={submit}>
              Submit
            </button>
          )}
        </div>
        {mode === "idle" && (
          <p className="text-body-small text-muted">
            Start the clock, or practise with no time limit. The questions stay in view either way.
          </p>
        )}

        <ol className="paper-questions">
          {questions.map((q, i) => (
            <li key={q.n} id={`q${q.n}`} className="paper-question">
              <p className="field-label">
                Question <span dir="ltr">{q.n}</span> · <span dir="ltr">{q.marks}</span>{" "}
                {q.marks === 1 ? "mark" : "marks"}
              </p>
              <div dangerouslySetInnerHTML={{ __html: q.questionHtml }} />
              {q.answer.kind === "numeric" ? (
                <Numeric
                  answer={q.answer}
                  typed={typed[i] ?? ""}
                  on={fieldsOn}
                  submitted={submitted}
                  verdict={verdicts[i] ?? "unreadable"}
                  draw={draw}
                  onType={(value) => setTyped(set(typed, i, value))}
                />
              ) : (
                <Prose
                  answer={q.answer}
                  marks={q.marks}
                  written={typed[i] ?? ""}
                  on={fieldsOn}
                  submitted={submitted}
                  earned={earned[i] ?? new Set()}
                  marked={marked[i] ?? false}
                  draw={draw}
                  onWrite={(value) => setTyped(set(typed, i, value))}
                  onEarn={(next) => {
                    setEarned(set(earned, i, next));
                    setSaved(false);
                  }}
                  onDone={() => {
                    setMarked(set(marked, i, true));
                    setSaved(false);
                  }}
                />
              )}
            </li>
          ))}
        </ol>

        {submitted && (
          <div className="paper-result">
            {timeUp && <p className="text-muted">Time is up: the paper was submitted as it stood.</p>}
            <p className="paper-score font-quantity text-quantity" role="status">
              {resultLabel(score)}
            </p>
            <button
              type="button"
              className="button-print label-action"
              disabled={!ready || !score.total}
              onClick={save}
            >
              Save result
            </button>
            {saved && <p className="text-muted">Saved in this browser.</p>}
          </div>
        )}
      </div>
    </MotionConfig>
  );
}

function Numeric({
  answer,
  typed,
  on,
  submitted,
  verdict,
  draw,
  onType,
}: {
  answer: Extract<QuestionProps["answer"], { kind: "numeric" }>;
  typed: string;
  on: boolean;
  submitted: boolean;
  verdict: NumericResult;
  draw: boolean;
  onType: (value: string) => void;
}) {
  const id = useId();
  const unit = answer.unitHtml && (
    <span className="answer-unit" dangerouslySetInnerHTML={{ __html: answer.unitHtml }} />
  );
  return (
    <div className="answer-box">
      <label className="field-label" htmlFor={id}>
        Your answer
      </label>
      <div className="answer-line">
        <input
          id={id}
          className="answer-input"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={!on}
          value={typed}
          onChange={(e) => onType(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />
        {unit}
      </div>
      {submitted && (
        <p className="check-result" role="status">
          <span className="check-verdict" data-result={verdict === "right" ? "right" : "wrong"}>
            <PenVerdict correct={verdict === "right"} draw={draw} />
            {verdict === "right" ? "Right" : "Not right"}
            <span className="text-muted">
              {" "}
              (answer <span className="font-quantity">{answer.value}</span> {unit}, within ±{" "}
              <span className="font-quantity">{answer.tolerance}</span>)
            </span>
          </span>
        </p>
      )}
    </div>
  );
}

function Prose({
  answer,
  marks,
  written,
  on,
  submitted,
  earned,
  marked,
  draw,
  onWrite,
  onEarn,
  onDone,
}: {
  answer: Extract<QuestionProps["answer"], { kind: "prose" }>;
  marks: number;
  written: string;
  on: boolean;
  submitted: boolean;
  earned: ReadonlySet<number>;
  marked: boolean;
  draw: boolean;
  onWrite: (value: string) => void;
  onEarn: (next: ReadonlySet<number>) => void;
  onDone: () => void;
}) {
  const id = useId();
  const toggle = (i: number) => {
    const next = new Set(earned);
    if (!next.delete(i)) next.add(i);
    onEarn(next);
  };
  return (
    <>
      <div className="answer-box">
        <label className="field-label" htmlFor={id}>
          Your answer
        </label>
        <textarea
          id={id}
          className="answer-text"
          rows={4}
          disabled={!on && !submitted}
          readOnly={submitted}
          value={written}
          onChange={(e) => onWrite(e.target.value)}
        />
      </div>
      {submitted && (
        <>
          <div className="model-answer">
            <span className="field-label block mbe-1">Model answer</span>
            <div dangerouslySetInnerHTML={{ __html: answer.modelHtml }} />
          </div>
          <fieldset className="earns">
            <legend className="field-label">What earns the marks</legend>
            <ul>
              {answer.earnsHtml.map((point, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="earns-point"
                    role="checkbox"
                    aria-checked={earned.has(i)}
                    onClick={() => toggle(i)}
                  >
                    <span className="try-box" aria-hidden="true">
                      {earned.has(i) && <DoneTick draw={draw} />}
                    </span>
                    <span dangerouslySetInnerHTML={{ __html: point }} />
                  </button>
                </li>
              ))}
            </ul>
            <p className="earns-tally" role="status">
              <span className="font-quantity" dir="ltr">
                {earned.size}
              </span>{" "}
              of{" "}
              <span className="font-quantity" dir="ltr">
                {marks}
              </span>{" "}
              marks{marked ? "" : ", not yet marked"}
            </p>
            {!marked && (
              <button type="button" className="button-print label-action" onClick={onDone}>
                Done marking
              </button>
            )}
          </fieldset>
        </>
      )}
    </>
  );
}
