// The galvanic cell's 3D view (DESIGN.md, Live 3D Viewers): the cell on the viewer's three.js stage,
// framed on the sheet, each part named in a gutter at its own side of the cell. The engine drives
// it: the electrons run the wire, the arrows beside them say which way, and when E goes negative
// they turn round and the anode and cathode labels swap. Under reduced motion the electrons hide
// and only the arrows stay. three.js loads after first paint, never with the page, and only while
// the viewer is near the screen: a browser keeps about 16 WebGL contexts.
//
// It never traps the page: until the student taps (or clicks) the cell, a swipe or a wheel over it
// scrolls the page. Once tapped, one finger turns it, two pinch-zoom inside the frame (the wheel
// zooms too), and a tap outside, Escape, or scrolling it out of view hands the page back. Reset
// view restores the 3/4 view. The stage is left to right in every language: the cell is written
// first | second, and its electrons never mirror.
import { useEffect, useId, useRef, useState } from "react";
import type { CellAnchor, CellState } from "../../sims/nernst/apparatus.ts";
import { cellLabels } from "../../sims/nernst/apparatus.ts";
import type { Model } from "../../sims/nernst/engine.ts";
import { createGestures } from "../../viewer/gesture.ts";
import { placeLabels } from "../../viewer/labels.ts";
import type { BuiltCell } from "../three/cell-scene.ts";
import type { Stage } from "../three/stage.ts";

export type ViewerStatus = "waiting" | "drawn" | "no-webgl" | "no-part";

interface Props {
  model: Model;
  state: CellState;
  /** Decimals the voltmeter and the solutions print with. */
  decimals: { E: number; c: number };
  /** What the cell is, for assistive tech. */
  label: string;
  ready: boolean;
  /** Reduced motion: no moving electrons, the arrows alone. */
  reduced: boolean;
}

/** A gutter label's line, in CSS pixels: 14px type with room to breathe. */
const LABEL_LINE = 22;
/** How far one wheel notch zooms, when the viewer has the page's wheel. */
const WHEEL_ZOOM = 0.0015;
/** The electrons travel the wire this many times a second. */
const LAPS_PER_SECOND = 0.25;

type Side = "start" | "end";
interface Placed {
  height: number;
  at: { id: CellAnchor; y: number; side: Side }[];
}
const NONE_PLACED: Placed = { height: 0, at: [] };

/** Runs `then` once the page has loaded and painted, when the browser is idle. */
function afterFirstPaint(then: () => void): () => void {
  let cancelled = false;
  // Safari has no requestIdleCallback.
  const onIdle = window.requestIdleCallback as typeof window.requestIdleCallback | undefined;
  const idle = () => (onIdle ? onIdle(go, { timeout: 1500 }) : window.setTimeout(go, 200));
  const go = () => {
    if (!cancelled) then();
  };
  const painted = () => requestAnimationFrame(() => requestAnimationFrame(idle));
  if (document.readyState === "complete") painted();
  else window.addEventListener("load", painted, { once: true });
  return () => {
    cancelled = true;
    window.removeEventListener("load", painted);
  };
}

export function CellViewer({ model, state, decimals, label, ready, reduced }: Props) {
  const [status, setStatus] = useState<ViewerStatus>("waiting");
  const [active, setActive] = useState(false);
  const [home, setHome] = useState(true);
  const [placed, setPlaced] = useState<Placed>(NONE_PLACED);
  const frameEl = useRef<HTMLElement>(null);
  const objectEl = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage>(undefined);
  const built = useRef<BuiltCell>(undefined);
  /** `placeCell`, once three.js has loaded. */
  const place = useRef<typeof import("../three/cell-scene.ts").placeCell>(undefined);
  const activeRef = useRef(false);
  activeRef.current = active;
  /** A viewer that can't draw leaves every gesture to the page; one drawing, or about to, can be tapped on. */
  const usable = status === "drawn" || status === "waiting";
  const usableRef = useRef(false);
  usableRef.current = usable;
  const stateRef = useRef(state);
  stateRef.current = state;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const phase = useRef(0);
  const hintId = useId();
  const words = cellLabels(model, state, decimals);

  // Near the screen or not: the stage, and its WebGL context, exist only while it is.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const frame = frameEl.current;
    if (!frame) return;
    const watch = new IntersectionObserver(([entry]) => entry && setNear(entry.isIntersecting), {
      rootMargin: "10% 0px",
    });
    watch.observe(frame);
    return () => watch.disconnect();
  }, []);

  // three.js, after first paint, while the viewer is near the screen.
  useEffect(() => {
    if (!near) return;
    let disposed = false;
    const stop = afterFirstPaint(() => {
      void (async () => {
        const host = objectEl.current;
        if (!host) return;
        let modules;
        try {
          modules = await Promise.all([import("../three/stage.ts"), import("../three/cell-scene.ts")]);
        } catch {
          // A chunk that didn't download: the sim keeps its values and its plot.
          if (!disposed) setStatus("no-part");
          return;
        }
        const [{ createStage, readViewerInks }, scene] = modules;
        if (disposed) return;
        let made: Stage;
        try {
          made = createStage(host, readViewerInks(host));
        } catch {
          setStatus("no-webgl");
          return;
        }
        stage.current = made;
        place.current = scene.placeCell;
        const cell = scene.showCell(made, model);
        built.current = cell;
        scene.placeCell(cell, stateRef.current, { reduced: reducedRef.current, phase: phase.current });
        made.beforeDraw(() => {
          cell.root.updateMatrixWorld(true);
          const { width, height } = made.size();
          const middle = width / 2;
          const seen = (Object.keys(cell.anchors) as CellAnchor[]).flatMap((id) => {
            const at = made.project(cell.anchors[id].getWorldPosition(new made.three.Vector3()));
            return at.inside ? [{ id, ...at, side: (at.x < middle ? "start" : "end") as Side }] : [];
          });
          const next: Placed = { height: 0, at: [] };
          const leaders: { from: [number, number]; to: [number, number]; strong: boolean }[] = [];
          for (const side of ["start", "end"] as const) {
            const own = seen.filter((s) => s.side === side);
            const laid = placeLabels(own, height, LABEL_LINE);
            next.height = Math.max(next.height, laid.height);
            for (const l of laid.at) {
              next.at.push({ id: l.id as CellAnchor, y: l.y, side });
              const a = own.find((s) => s.id === l.id);
              if (a) leaders.push({ from: [a.x, a.y], to: [side === "start" ? 0 : width, l.y], strong: false });
            }
          }
          made.setLeaders(leaders);
          // Re-rendering on every frame of the electrons would cost the page: only when a label moved.
          setPlaced((now) => (JSON.stringify(now) === JSON.stringify(next) ? now : next));
          setHome(made.atHome());
        });
        setStatus("drawn");
      })();
    });
    return () => {
      disposed = true;
      stop();
      stage.current?.dispose();
      stage.current = undefined;
      built.current = undefined;
      setPlaced(NONE_PLACED);
      setStatus((now) => (now === "drawn" ? "waiting" : now));
    };
  }, [model, near]);

  // The state moves the cell; the stage draws once. The labels are the page's, so they follow at once.
  useEffect(() => {
    if (!built.current || !place.current || status !== "drawn") return;
    place.current(built.current, state, { reduced, phase: phase.current });
    stage.current?.draw();
  }, [state, reduced, status]);

  // The electrons run the wire: one frame loop, only while drawn, near the screen, moving and with current.
  useEffect(() => {
    if (status !== "drawn" || !near || reduced || state.flow === "none") return;
    let last = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      frame = requestAnimationFrame(step);
      phase.current = (phase.current + ((now - last) / 1000) * LAPS_PER_SECOND) % 1;
      last = now;
      if (built.current && place.current)
        place.current(built.current, stateRef.current, { reduced: false, phase: phase.current });
      stage.current?.draw();
    });
    return () => cancelAnimationFrame(frame);
  }, [status, near, reduced, state.flow]);

  // A viewer that can't draw hands every gesture back to the page.
  useEffect(() => {
    if (status === "no-webgl" || status === "no-part") setActive(false);
  }, [status]);

  // Touch and the wheel: nothing is taken from the page until the cell is tapped.
  useEffect(() => {
    const el = objectEl.current;
    if (!el) return;
    const gestures = createGestures({
      turn: (dx, dy) => activeRef.current && stage.current?.turn(dx, dy),
      pinch: (ratio) => activeRef.current && stage.current?.zoom(ratio),
      tap: () => usableRef.current && setActive(true),
    });
    const down = (e: PointerEvent) => {
      gestures.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      if (activeRef.current) el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => gestures.move(e.pointerId, e.clientX, e.clientY);
    const up = (e: PointerEvent) => gestures.up(e.pointerId, e.timeStamp);
    const cancel = (e: PointerEvent) => gestures.cancel(e.pointerId);
    const wheel = (e: WheelEvent) => {
      if (!activeRef.current) return; // the page scrolls
      e.preventDefault();
      stage.current?.zoom(Math.exp(-e.deltaY * WHEEL_ZOOM));
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  // Handing the page back: a tap outside the frame, Escape, or the viewer scrolled out of view.
  useEffect(() => {
    if (!active) return;
    const frame = frameEl.current;
    const outside = (e: PointerEvent) => {
      if (frame && !frame.contains(e.target as Node)) setActive(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setActive(false);
    const gone = new IntersectionObserver(([entry]) => entry && !entry.isIntersecting && setActive(false));
    if (frame) gone.observe(frame);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      gone.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [active]);

  const keys = (e: React.KeyboardEvent) => {
    const s = stage.current;
    if (!activeRef.current) {
      if (usableRef.current && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setActive(true);
      }
      return;
    }
    const step = s ? s.size().height / 12 : 0;
    const moves: Record<string, () => void> = {
      ArrowLeft: () => s?.turn(-step, 0),
      ArrowRight: () => s?.turn(step, 0),
      ArrowUp: () => s?.turn(0, -step),
      ArrowDown: () => s?.turn(0, step),
      "+": () => s?.zoom(1.2),
      "=": () => s?.zoom(1.2),
      "-": () => s?.zoom(1 / 1.2),
    };
    const act = moves[e.key];
    if (act) {
      e.preventDefault();
      act();
    }
  };

  const hint =
    status === "no-webgl"
      ? "This browser can't draw the cell in 3D: its values and its plot are shown."
      : status === "no-part"
        ? "The cell didn't load in 3D: its values and its plot are shown."
        : status === "waiting"
          ? "Drawing the cell…"
          : active
            ? "Drag to turn it, pinch or scroll to zoom. Tap outside it, or press Esc, to scroll the page again."
            : "Tap or click the cell to turn it. Until then the page scrolls over it.";
  const particles = state.flow === "none" ? "none" : reduced ? "static" : "moving";

  const gutter = (side: Side) => (
    <div
      className="viewer-gutter"
      data-side={side}
      style={{ blockSize: placed.height || undefined }}
      aria-hidden="true"
    >
      {placed.at
        .filter((l) => l.side === side)
        .map((l) => (
          <span
            key={l.id}
            className="viewer-label"
            data-cell-label={l.id}
            style={{ insetBlockStart: l.y - LABEL_LINE / 2 }}
          >
            {words[l.id]}
          </span>
        ))}
    </div>
  );

  return (
    <div className="cell-viewer" data-active={active} data-particles={particles}>
      <figure className="viewer-frame" ref={frameEl} data-framed-tool>
        <div className="viewer-stage" dir="ltr">
          {gutter("start")}
          <div
            className="viewer-object"
            ref={objectEl}
            data-viewer-object
            data-viewer-state={status}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            aria-disabled={!ready || !usable}
            aria-label={`${label}: tap to turn it`}
            aria-describedby={hintId}
            onKeyDown={keys}
            // Assistive tech may activate the button with a click alone.
            onClick={() => usableRef.current && setActive(true)}
          />
          {gutter("end")}
        </div>
        <figcaption className="viewer-caption">
          <span id={hintId}>{hint}</span>
          <button
            type="button"
            className="button-print"
            disabled={!ready || status !== "drawn" || home}
            onClick={() => stage.current?.reset()}
          >
            Reset view
          </button>
        </figcaption>
      </figure>
    </div>
  );
}
