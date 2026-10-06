// The STL sim's printed parts: the listing with its line numbers, the registers and status word of
// the statement being read, the trace of the scan, and the watch table. Pure views: the island
// owns the run.
import { useEffect, useRef } from "react";
import { pointer, readAccumulator, statusBits, type AccumulatorType, type WatchRow } from "../../sims/stl/view.ts";
import type { TraceEntry } from "../../sims/stl/engine.ts";

interface ListingProps {
  lines: readonly string[];
  /** The lines of the statement being read. */
  current: { line: number; lastLine: number } | undefined;
  /** Every line a statement this scan ran on. */
  ran: ReadonlySet<number>;
  label: string;
}

/** The listing as the Professor wrote it, line for line; the statement being read is shaded. */
export function Listing({ lines, current, ran, label }: ListingProps) {
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
    <div ref={box} className="stl-listing" role="region" aria-label={label} tabIndex={0} dir="ltr">
      <ol className="stl-lines">
        {lines.map((text, i) => {
          const isCurrent = current !== undefined && i >= current.line && i <= current.lastLine;
          return (
            <li key={i} className="stl-line" data-current={isCurrent || undefined} data-ran={ran.has(i) || undefined}>
              <span className="stl-number" aria-hidden="true">
                {i + 1}
              </span>
              <code className="stl-code">{text || " "}</code>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface RegistersProps {
  entry: TraceEntry | undefined;
  /** What each accumulator holds after the statement, as a type. */
  types: { accu1: AccumulatorType; accu2: AccumulatorType };
}

/** ACCU 1, ACCU 2 and AR 1 after the statement, and its status word bit by bit. */
export function Registers({ entry, types }: RegistersProps) {
  const accu = (name: string, value: number, type: AccumulatorType, leftByBlock: string | undefined) => (
    <div className="stl-register">
      <span className="field-label">{name}</span>
      {!entry ? (
        <span className="font-quantity text-pencil">-</span>
      ) : leftByBlock ? (
        <span className="stl-left">left by {leftByBlock}</span>
      ) : (
        <>
          <span className="font-quantity text-graphite tabular-nums">{readAccumulator(value, type).value}</span>
          <span className="font-quantity text-pencil tabular-nums stl-hex">{readAccumulator(value, type).hex}</span>
        </>
      )}
    </div>
  );
  return (
    <div className="stl-registers">
      <div className="stl-accus">
        {accu("ACCU 1", entry?.accu1 ?? 0, types.accu1, entry?.leftBy.ACCU1)}
        {accu("ACCU 2", entry?.accu2 ?? 0, types.accu2, entry?.leftBy.ACCU2)}
        <div className="stl-register">
          <span className="field-label">AR 1</span>
          <span className="font-quantity text-graphite tabular-nums">{entry ? pointer(entry.ar1) : "-"}</span>
        </div>
      </div>
      <ul className="stl-bits" aria-label="Status word">
        {statusBits(entry ?? { status: 0, leftBy: {} }).map((b) => (
          <li
            key={b.bit}
            className="stl-bit"
            data-on={b.value === 1 || undefined}
            data-left={b.value === "?" || undefined}
            title={b.leftBy ? `left by ${b.leftBy}` : undefined}
          >
            <span className="field-label">{b.bit}</span>
            <span className="font-quantity tabular-nums">{entry ? b.value : "-"}</span>
          </li>
        ))}
      </ul>
      {entry && Object.keys(entry.leftBy).length > 0 && (
        <p className="sim-readout">
          A ? is left by {Object.values(entry.leftBy)[0]}: Siemens doesn't publish what the block leaves there, so the
          trace doesn't guess until a statement writes it.
        </p>
      )}
    </div>
  );
}

interface TraceProps {
  trace: readonly TraceEntry[];
  types: readonly { accu1: AccumulatorType }[];
}

/** Every statement this scan has run, in order, with ACCU 1 and the RLO it left; the last is the one being read. */
export function Trace({ trace, types }: TraceProps) {
  const box = useRef<HTMLDivElement>(null);
  // The newest statement stays in view inside the box.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [trace.length]);
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
              <span className="field-label">ACCU 1</span>
            </th>
            <th scope="col" className="stl-th">
              <span className="field-label">RLO</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {trace.map((t, i) => (
            <tr key={i} data-current={i === trace.length - 1 || undefined}>
              <td className="stl-td text-pencil">{t.line + 1}</td>
              <td className="stl-td text-graphite">{[t.op, t.text].filter(Boolean).join(" ")}</td>
              <td className="stl-td text-graphite">
                {t.leftBy.ACCU1 ? "?" : readAccumulator(t.accu1, types[i]?.accu1 ?? "INT").value}
              </td>
              <td className="stl-td text-pencil">{t.leftBy.RLO ? "?" : (t.status >> 1) & 1}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The watch table: each operand's value now, a row the statement wrote ringed in pencil. */
export function WatchTable({ rows }: { rows: readonly WatchRow[] }) {
  return (
    <div className="table-box stl-watch">
      <table className="border-collapse bg-sheet font-quantity text-quantity-phone tabular-nums pad:text-quantity">
        <thead>
          <tr>
            <th scope="col" className="stl-th">
              <span className="field-label">Operand</span>
            </th>
            <th scope="col" className="stl-th">
              <span className="field-label">Value</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.operand} data-written={row.written || undefined}>
              <td className="stl-td text-graphite">{row.operand}</td>
              <td className="stl-td stl-value text-graphite">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
