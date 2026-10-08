// The 3D viewer for a machine part (DESIGN.md, Live 3D Viewers): the part's GLB on a three.js stage
// framed on the sheet, its tagged dimensions labelled in a gutter beside it and listed below with
// their Provenance tags. three.js loads after first paint, once the page has loaded, never with it.
//
// It never traps the page: until the student taps (or clicks) the part, a swipe or a wheel over it
// scrolls the page. Once tapped, one finger turns it, two pinch-zoom inside the frame (the wheel
// zooms too), and a tap outside, Escape, or scrolling it out of view hands the page back. Reset view
// restores the 3/4 view. A Checkpoint item links to a dimension's row (`#dim-…`), and the viewer
// opens with that dimension highlighted.
import { useEffect, useId, useRef, useState } from "react";
import { createGestures } from "../viewer/gesture.ts";
import { placeLabels } from "../viewer/labels.ts";
import type { PartScene } from "./three/part-scene.ts";
import type { Stage } from "./three/stage.ts";

type Point3 = [number, number, number];

export interface ViewerDimension {
  id: string;
  /** Its row's id on the page: what a Checkpoint item links to. */
  anchor: string;
  /** What it measures, rendered at build. */
  labelHtml: string;
  /** As the gutter prints it: `Ø80`, `30`. */
  text: string;
  /** Its Provenance tag, as the list says it: `stated`, `scaled off the drawing`… */
  tag: string;
  from: Point3;
  to: Point3;
}

interface Props {
  /** The part's GLB, as the site publishes it. */
  glb: string;
  dimensions: ViewerDimension[];
  /** What the part is, for assistive tech. */
  label: string;
}

/** A gutter label's line, in CSS pixels: 14px type with room to breathe. */
const LABEL_LINE = 22;
/** How far one wheel notch zooms, when the viewer has the page's wheel. */
const WHEEL_ZOOM = 0.0015;

type Status = "waiting" | "drawn" | "no-webgl" | "no-part";

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

export default function PartViewer({ glb, dimensions, label }: Props) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>("waiting");
  const [active, setActive] = useState(false);
  const [home, setHome] = useState(true);
  const [highlighted, setHighlighted] = useState<string>();
  const [labels, setLabels] = useState<{ height: number; at: { id: string; y: number }[] }>({ height: 0, at: [] });
  const frameEl = useRef<HTMLElement>(null);
  const objectEl = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage>(undefined);
  const scene = useRef<PartScene>(undefined);
  const activeRef = useRef(false);
  activeRef.current = active;
  /**
   * A viewer that can't draw (no WebGL, a part that didn't load) leaves every gesture to the page. One
   * drawing its part, or drawing it again as it comes back on screen, can be tapped on already.
   */
  const usable = status === "drawn" || status === "waiting";
  const usableRef = useRef(false);
  usableRef.current = usable;
  const highlightRef = useRef<string>(undefined);
  highlightRef.current = highlighted;
  const hintId = useId();

  useEffect(() => setReady(true), []);

  // A Checkpoint item's link names a dimension's row: open with it highlighted.
  useEffect(() => {
    const fromHash = () => {
      const named = dimensions.find((d) => `#${d.anchor}` === window.location.hash);
      if (named) setHighlighted(named.id);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [dimensions]);

  // Near the screen or not: a browser keeps only so many WebGL contexts (about 16), so a viewer
  // draws only while it is near the screen, and gives its context back when it leaves (a Lab page may
  // hold many parts). Coming back, it draws again.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const frame = frameEl.current;
    if (!frame) return;
    const watch = new IntersectionObserver(([entry]) => entry && setNear(entry.isIntersecting), {
      rootMargin: "50% 0px",
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
          modules = await Promise.all([import("./three/stage.ts"), import("./three/part-scene.ts")]);
        } catch {
          // A chunk that didn't download: the viewer says so, and keeps its list of dimensions.
          if (!disposed) setStatus("no-part");
          return;
        }
        const [{ createStage, readViewerInks }, { showPart }] = modules;
        if (disposed) return;
        let made: Stage;
        try {
          made = createStage(host, readViewerInks(host));
        } catch {
          setStatus("no-webgl");
          return;
        }
        stage.current = made;
        let part: PartScene;
        try {
          part = await showPart(made, glb, dimensions);
        } catch {
          if (!disposed) setStatus("no-part");
          return;
        }
        if (disposed) {
          made.dispose();
          return;
        }
        scene.current = part;
        made.beforeDraw(() => {
          const { width, height } = made.size();
          const rtl = getComputedStyle(host).direction === "rtl";
          const seen = part.anchors.map(({ id, at }) => ({ id, ...made.project(at) })).filter((a) => a.inside);
          const placed = placeLabels(seen, height, LABEL_LINE);
          const edge = rtl ? 0 : width;
          made.setLeaders(
            placed.at.flatMap((l) => {
              const a = seen.find((s) => s.id === l.id);
              return a ? [{ from: [a.x, a.y], to: [edge, l.y], strong: l.id === highlightRef.current }] : [];
            }),
          );
          setLabels(placed);
          setHome(made.atHome());
        });
        part.emphasise(highlightRef.current);
        setStatus("drawn");
      })();
    });
    return () => {
      disposed = true;
      stop();
      stage.current?.dispose();
      stage.current = undefined;
      scene.current = undefined;
      setLabels({ height: 0, at: [] });
      setStatus((now) => (now === "drawn" ? "waiting" : now));
    };
  }, [glb, dimensions, near]);

  useEffect(() => {
    scene.current?.emphasise(highlighted);
  }, [highlighted, status]);

  // A viewer that can't draw hands every gesture back to the page.
  useEffect(() => {
    if (status === "no-webgl" || status === "no-part") setActive(false);
  }, [status]);

  // Touch and the wheel: nothing is taken from the page until the part is tapped.
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
      ? "This browser can't draw the part in 3D: its dimensions are listed below."
      : status === "no-part"
        ? "The part didn't load: its dimensions are listed below."
        : status === "waiting"
          ? "Drawing the part…"
          : active
            ? "Drag to turn it, pinch or scroll to zoom. Tap outside it, or press Esc, to scroll the page again."
            : "Tap or click the part to turn it. Until then the page scrolls over it.";
  const byId = new Map(dimensions.map((d) => [d.id, d]));

  return (
    <div className="sim viewer" data-viewer data-ready={ready} data-drawn={status === "drawn"} data-active={active}>
      <figure className="viewer-frame" ref={frameEl} data-framed-tool>
        <div className="viewer-stage">
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
          <div className="viewer-gutter" style={{ blockSize: labels.height || undefined }} aria-hidden="true">
            {labels.at.map((l) => (
              <span
                key={l.id}
                className="viewer-label"
                data-dimension={l.id}
                data-strong={l.id === highlighted || undefined}
                style={{ insetBlockStart: l.y - LABEL_LINE / 2 }}
              >
                {byId.get(l.id)?.text}
              </span>
            ))}
          </div>
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
      <div className="table-box viewer-dimensions">
        <table>
          <caption className="sr-only">The part's dimensions, in millimetres</caption>
          <thead>
            <tr>
              <th scope="col">Dimension</th>
              <th scope="col">mm</th>
              <th scope="col">Read as</th>
            </tr>
          </thead>
          <tbody>
            {dimensions.map((d) => (
              <tr key={d.id} id={d.anchor} data-highlighted={d.id === highlighted || undefined}>
                <th scope="row">
                  <button
                    type="button"
                    className="viewer-dimension"
                    aria-pressed={d.id === highlighted}
                    disabled={!ready}
                    onClick={() => setHighlighted((now) => (now === d.id ? undefined : d.id))}
                  >
                    <span dangerouslySetInnerHTML={{ __html: d.labelHtml }} />
                  </button>
                </th>
                <td className="font-quantity tabular-nums">{d.text}</td>
                <td>{d.tag}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
