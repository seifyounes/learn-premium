// One Practice item, written first. A numeric answer is checked against the item's tolerance and
// marked in red pen; a prose or derivation answer is marked by the student against the model
// answer and what earns the mark. The model answer shows only once the student has had a go.
import { MotionConfig, useReducedMotion } from "motion/react";
import { useEffect, useId, useState, type ReactNode, type SubmitEvent } from "react";
import { checkNumeric, type NumericResult } from "../practice/check.ts";
import { markPlace, recordPractice } from "../progress/progress.ts";
import { updateProgress } from "../progress/store.ts";
import { DoneTick, PenVerdict } from "./worked/pen.tsx";

interface Common {
  /** Where progress is kept: the Module, and the item's number in it. */
  module: string;
  item: string;
  /** The model working, rendered to HTML (paper math) at build. */
  modelHtml: string;
  /** Derived values, Slips and Divergences: shown with the model answer. */
  outputsHtml: string;
}

type Props = Common &
  (
    | { kind: "numeric"; answer: { value: number; tolerance: number }; unitHtml?: string }
    | { kind: "prose"; earnsHtml: string[] }
  );

export default function PracticeItem(props: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <MotionConfig reducedMotion="user">
      <div className="practice-work">
        {props.kind === "numeric" ? <Numeric {...props} ready={ready} /> : <Prose {...props} ready={ready} />}
      </div>
    </MotionConfig>
  );
}

function ModelAnswer({
  modelHtml,
  outputsHtml,
  children,
}: Pick<Common, "modelHtml" | "outputsHtml"> & { children?: ReactNode }) {
  return (
    <div className="model-answer">
      <span className="field-label block mbe-1">Model answer</span>
      <div dangerouslySetInnerHTML={{ __html: modelHtml }} />
      {children}
      {outputsHtml && <div className="mbs-3" dangerouslySetInnerHTML={{ __html: outputsHtml }} />}
    </div>
  );
}

const resultText = (result: NumericResult) =>
  result === "right"
    ? "Right"
    : result === "wrong"
      ? "Not yet: check your working and try again."
      : "Write your answer as one number, e.g. 9.6.";

function Numeric({
  module,
  item,
  answer,
  unitHtml,
  modelHtml,
  outputsHtml,
  ready,
}: Extract<Props, { kind: "numeric" }> & { ready: boolean }) {
  const id = useId();
  const draw = !(useReducedMotion() ?? false);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<NumericResult>();
  const [checks, setChecks] = useState(0);
  const [tried, setTried] = useState(false);
  const [shown, setShown] = useState(false);
  const check = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const verdict = checkNumeric(typed, answer);
    setResult(verdict);
    setChecks((n) => n + 1);
    if (verdict === "unreadable") return;
    setTried(true);
    updateProgress((p) =>
      markPlace(recordPractice(p, module, item, { kind: "numeric", correct: verdict === "right" }), {
        module,
        kind: "practice",
        item,
      }),
    );
  };
  const unit = unitHtml && <span className="answer-unit" dangerouslySetInnerHTML={{ __html: unitHtml }} />;
  return (
    <>
      <form className="answer-box" onSubmit={check}>
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
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
          {unit}
          <button type="submit" className="button-print label-action" disabled={!ready || typed.trim() === ""}>
            Check
          </button>
        </div>
        <p className="check-result" role="status">
          {result && (
            <span key={checks} className="check-verdict" data-result={result}>
              {result !== "unreadable" && <PenVerdict correct={result === "right"} draw={draw} />}
              {resultText(result)}
              {result === "right" && (
                <span className="text-muted">
                  {" "}
                  (within ± <span className="font-quantity">{answer.tolerance}</span>)
                </span>
              )}
            </span>
          )}
        </p>
      </form>
      {tried && !shown && (
        <button type="button" className="button-print label-action" onClick={() => setShown(true)}>
          Show model answer
        </button>
      )}
      {shown && (
        <ModelAnswer modelHtml={modelHtml} outputsHtml={outputsHtml}>
          <p className="mbs-2 font-quantity text-pencil">
            {answer.value} {unit} (± {answer.tolerance})
          </p>
        </ModelAnswer>
      )}
    </>
  );
}

function Prose({
  module,
  item,
  earnsHtml,
  modelHtml,
  outputsHtml,
  ready,
}: Extract<Props, { kind: "prose" }> & { ready: boolean }) {
  const id = useId();
  const draw = !(useReducedMotion() ?? false);
  const [written, setWritten] = useState("");
  const [shown, setShown] = useState(false);
  const [earned, setEarned] = useState<ReadonlySet<number>>(new Set());
  const record = (marks: number) =>
    updateProgress((p) =>
      markPlace(recordPractice(p, module, item, { kind: "prose", marks, of: earnsHtml.length }), {
        module,
        kind: "practice",
        item,
      }),
    );
  const toggle = (i: number) => {
    const next = new Set(earned);
    if (!next.delete(i)) next.add(i);
    setEarned(next);
    record(next.size);
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
          value={written}
          readOnly={shown}
          onChange={(e) => setWritten(e.target.value)}
        />
      </div>
      {!shown && (
        <button
          type="button"
          className="button-print label-action"
          disabled={!ready || written.trim() === ""}
          onClick={() => {
            setShown(true);
            record(0);
          }}
        >
          Mark it yourself
        </button>
      )}
      {shown && (
        <>
          <ModelAnswer modelHtml={modelHtml} outputsHtml={outputsHtml} />
          <fieldset className="earns">
            <legend className="field-label">What earns the mark</legend>
            <ul>
              {earnsHtml.map((point, i) => (
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
              <span className="font-quantity">{earned.size}</span> of{" "}
              <span className="font-quantity">{earnsHtml.length}</span> marks
            </p>
          </fieldset>
        </>
      )}
    </>
  );
}
