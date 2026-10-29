// The toggles under a chemistry plot with more lines than the eye can follow: one printed button
// for each line, a drawn tick box and a swatch of its line style beside its label. At most four
// lines are drawn in ink at once; the rest are dimmed to pencil, and drawing another dims the one
// drawn longest. No pills, no chips, no rounded corners: printed buttons on the sheet.
import { MAX_SHOWN, SERIES_STYLES, type SeriesDef, type SeriesState } from "../../chemistry/series.ts";

interface Props {
  defs: readonly SeriesDef[];
  state: SeriesState;
  ready: boolean;
  onToggle(id: string): void;
}

/** A drawn tick box: a graphite tick when pressed, an empty pencil box when not. */
function TickBox({ pressed }: { pressed: boolean }) {
  return (
    <svg className="series-tick" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <rect x="0.75" y="0.75" width="12.5" height="12.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      {pressed && (
        <path d="M3 7.4 L5.8 10.2 L11 3.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" />
      )}
    </svg>
  );
}

/** The line's style as a short swatch, stroked in the button's own ink. */
function Swatch({ index }: { index: number }) {
  const style = SERIES_STYLES[index % SERIES_STYLES.length];
  return (
    <svg className="series-swatch" width="34" height="14" viewBox="0 0 34 14" aria-hidden="true" focusable="false">
      <line
        x1="1"
        y1="7"
        x2="33"
        y2="7"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeDasharray={style?.dasharray === "none" ? undefined : style?.dasharray}
      />
    </svg>
  );
}

export function SeriesToggles({ defs, state, ready, onToggle }: Props) {
  return (
    <div className="series-toggles-wrap">
      <div className="series-toggles" role="group" aria-label="Isotherms drawn">
        {defs.map((d, i) => {
          const pressed = state.shown.includes(d.id);
          return (
            <button
              key={d.id}
              type="button"
              className="button-print series-toggle label-action"
              aria-pressed={pressed}
              data-series={d.id}
              disabled={!ready}
              onClick={() => onToggle(d.id)}
            >
              <TickBox pressed={pressed} />
              <Swatch index={i} />
              <span className="font-quantity tabular-nums">{d.label}</span>
            </button>
          );
        })}
      </div>
      {defs.length > MAX_SHOWN && (
        <p className="sim-readout series-note" role="status">
          {state.shown.length} of {defs.length} drawn; drawing another dims the one drawn longest.
        </p>
      )}
    </div>
  );
}
