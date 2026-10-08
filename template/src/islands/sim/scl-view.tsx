// The SCL sim's printed parts: the listing (live, or as a build step left it), a syntax fragment
// kept as static code, the statement being read with its watch table, the ruling on a Divergence
// line, and the scan's trace. Pure views: the island owns the run.
import { useEffect, useRef } from "react";
import type { TraceEntry } from "../../sims/scl/engine.ts";
import { describeWrites, type StageLine, type WatchRow } from "../../sims/scl/view.ts";

/** A Divergence as the page prints it: its line (1-based) and the ruling's prose, rendered at build. */
export interface Ruling {
  line: number;
  examHtml: string;
  noteHtml: string;
}

interface ListingProps {
  lines: readonly string[];
  /** The lines of the statement being read. */
  current: { line: number; lastLine: number } | undefined;
  /** Every line a statement this scan ran on. */
  ran: ReadonlySet<number>;
  /** The lines (0-based) the Owner ruled a Divergence on. */
  ruled: ReadonlySet<number>;
  label: string;
}

/** The final listing, line for line; the statement being read is shaded, a ruled line marked in red pen. */
export function Listing({ lines, current, ran, ruled, label }: ListingProps) {
  const box = useRef<HTMLDivElement>(null);
  // Keep the statement being read in view inside the box, never by scrolling the page.
  useEffect(() => {
    const el = box.current;
    const row = el?.querySelector<HTMLElement>('[data-current="true"]');
    if (!el || !row) return;
    const top = row.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight)
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
  }, [current?.line]);
  return (
    <div ref={box} className="stl-listing scl-listing" role="region" aria-label={label} tabIndex={0} dir="ltr">
      <ol className="stl-lines">
        {lines.map((text, i) => {
          const isCurrent = current !== undefined && i >= current.line && i <= current.lastLine;
          return (
            <li
              key={i}
              className="stl-line"
              data-current={isCurrent || undefined}
              data-ran={ran.has(i) || undefined}
              data-divergence={ruled.has(i) || undefined}
            >
              <span className="stl-number" aria-hidden="true">
                {i + 1}
              </span>
              <code className="stl-code">{text || " "}</code>
              {ruled.has(i) && (
                <span className="sr-only"> (a Divergence: the exam's answer differs from a real S7)</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The listing as a build step left it: the lines it added marked, nothing run. */
export function StageListing({ lines, label }: { lines: readonly StageLine[]; label: string }) {
  return (
    <div className="stl-listing scl-listing" role="region" aria-label={label} tabIndex={0} dir="ltr">
      <ol className="stl-lines">
        {lines.map((l) => (
          <li key={l.line} className="stl-line" data-added={l.added || undefined}>
            <span className="stl-number" aria-hidden="true">
              {l.line + 1}
            </span>
            <code className="stl-code">{l.text || " "}</code>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Code a slide shows only for its syntax: printed as it is, never run. */
export function Fragment({ code }: { code: string }) {
  return (
    <figure className="scl-fragment">
      <figcaption className="field-label">Syntax only: not run</figcaption>
      <pre dir="ltr">
        <code>{code.replace(/\n$/, "")}</code>
      </pre>
    </figure>
  );
}

interface StateProps {
  entry: TraceEntry | undefined;
  rows: readonly WatchRow[];
  ruling: Ruling | undefined;
}

/** The statement being read, what it decided and wrote, the watch table, then the ruling on its line. */
export function StatePanel({ entry, rows, ruling }: StateProps) {
  const written = entry ? describeWrites(entry.writes) : [];
  return (
    <>
      <div className="stl-statement">
        <span className="field-label">Statement</span>
        <span className="font-quantity text-graphite">
          {entry ? `${entry.line + 1}  ${entry.text}` : "-"}
          {entry?.outcome ? <span className="text-pencil">{`  → ${entry.outcome}`}</span> : null}
        </span>
      </div>
      <div className="stl-written">
        <span className="field-label">Written</span>
        <span className="font-quantity text-graphite tabular-nums">
          {written.length ? written.join(", ") : "nothing"}
        </span>
      </div>
      <div className="table-box stl-watch scl-watch">
        <table className="border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity">
          <thead>
            <tr>
              <th scope="col" className="stl-th">
                <span className="field-label">Variable</span>
              </th>
              <th scope="col" className="stl-th">
                <span className="field-label">Value</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path} data-written={row.written || undefined}>
                <td className="stl-td text-graphite">{row.path}</td>
                <td className="stl-td stl-value text-graphite">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ruling && (
        <div className="scl-ruling" data-line={ruling.line}>
          <div className="scl-exam answer-frame">
            <span className="field-label">Exam answer, line {ruling.line}</span>
            <span className="text-graphite" dangerouslySetInnerHTML={{ __html: ruling.examHtml }} />
          </div>
          <p className="scl-red-pen">
            <span className="field-label">A real S7</span>{" "}
            <span dangerouslySetInnerHTML={{ __html: ruling.noteHtml }} />
          </p>
        </div>
      )}
    </>
  );
}

interface TraceProps {
  trace: readonly TraceEntry[];
  /** Statements read so far: the last is the one being read. */
  shown: number;
  ruled: ReadonlySet<number>;
}

/** Every statement this scan has run so far, with what it decided or wrote. */
export function Trace({ trace, shown, ruled }: TraceProps) {
  const box = useRef<HTMLDivElement>(null);
  // The newest statement stays in view inside the box.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);
  return (
    <div ref={box} className="stl-trace table-box" role="region" aria-label="Trace of this scan" tabIndex={0}>
      <table className="border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity">
        <thead>
          <tr>
            <th scope="col" className="stl-th">
              <span className="field-label">Line</span>
            </th>
            <th scope="col" className="stl-th">
              <span className="field-label">Statement</span>
            </th>
            <th scope="col" className="stl-th">
              <span className="field-label">Result</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {trace.slice(0, shown).map((t, i) => (
            <tr key={i} data-current={i === shown - 1 || undefined} data-divergence={ruled.has(t.line) || undefined}>
              <td className="stl-td text-pencil">{t.line + 1}</td>
              <td className="stl-td text-graphite">{t.text}</td>
              <td className="stl-td text-pencil">{t.outcome ?? (describeWrites(t.writes).join(", ") || "-")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
