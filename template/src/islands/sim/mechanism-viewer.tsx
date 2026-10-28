// The mechanism's 3D view (DESIGN.md, Live 3D Viewers): the linkage or gear pair on the viewer's
// three.js stage, framed on the sheet, its pin letters hung in a gutter beside it. three.js loads
// after first paint, never with the page, and only while the viewer is near the screen: a browser
// keeps about 16 WebGL contexts, and a Lab page holds several.
//
// It never traps the page: until the student taps (or clicks) the mechanism, a swipe or a wheel over
// it scrolls the page. Once tapped, a drag that starts on the ringed driving pin turns the driver
// (the pointer is cast onto the sheet's plane), any other drag turns the view, two fingers pinch-zoom
// inside the frame (the wheel zooms too), and a tap outside, Escape, or scrolling it out of view
// hands the page back. Reset view restores the 3/4 view. The pose is the engine's, drawn here.
import { useEffect, useId, useRef, useState } from "react";
import { dragAngle, type Model, type Pose } from "../../sims/mechanism/engine.ts";
import { createGestures } from "../../viewer/gesture.ts";
import { placeLabels } from "../../viewer/labels.ts";
import type { BuiltMechanism } from "../three/mechanism-scene.ts";
import type { Stage } from "../three/stage.ts";

export type ViewerStatus = "waiting" | "drawn" | "no-webgl" | "no-part";

interface Props {
  model: Model;
  pose: Pose;
  /** What the mechanism is, for assistive tech. */
  label: string;
  /** The student drags the driving pin: the driver's new angle, in degrees. */
  onAngle(angle: number): void;
  /** Told when the 3D view can't draw, so the sim can fall back to the sheet drawing. */
  onStatus(status: ViewerStatus): void;
  ready: boolean;
}

/** A gutter label's line, in CSS pixels: 14px type with room to breathe. */
const LABEL_LINE = 22;
/** How far one wheel notch zooms, when the viewer has the page's wheel. */
const WHEEL_ZOOM = 0.0015;
/** A press this close to the driving pin's mark (CSS px) takes the pin, not the view. */
const PIN_REACH = 22;

/** The pins whose letters hang in the gutter, with the marker each is read from. */
const NAMED: Record<Model["type"], readonly (readonly [key: string, marker: string])[]> = {
  "four-bar": [
    ["O2", "ground.O2"],
    ["A", "crank.A"],
    ["B", "coupler.B"],
    ["O4", "ground.O4"],
    ["P", "coupler.P"],
  ],
  "gear-pair": [
    ["O1", "ground.O1"],
    ["O2", "ground.O2"],
  ],
};
const DRIVING = { "four-bar": "crank.A", "gear-pair": "driver.H" } as const;

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

/** A letter and its trailing digit as a subscript, the way the figure prints it. */
function Letter({ text }: { text: string }) {
  return (
    <>
      {text.slice(0, 1)}
      {text.length > 1 && <sub>{text.slice(1)}</sub>}
    </>
  );
}

export function MechanismViewer({ model, pose, label, onAngle, onStatus, ready }: Props) {
  const [status, setStatus] = useState<ViewerStatus>("waiting");
  const [active, setActive] = useState(false);
  const [home, setHome] = useState(true);
  const [labels, setLabels] = useState<{ height: number; at: { id: string; y: number }[] }>({ height: 0, at: [] });
  const frameEl = useRef<HTMLElement>(null);
  const objectEl = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage>(undefined);
  const built = useRef<BuiltMechanism>(undefined);
  /** `placeLinks`, once three.js has loaded. */
  const place = useRef<typeof import("../three/mechanism-scene.ts").placeLinks>(undefined);
  const activeRef = useRef(false);
  activeRef.current = active;
  /** A viewer that can't draw leaves every gesture to the page; one drawing, or about to, can be tapped on. */
  const usable = status === "drawn" || status === "waiting";
  const usableRef = useRef(false);
  usableRef.current = usable;
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const onAngleRef = useRef(onAngle);
  onAngleRef.current = onAngle;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const hintId = useId();

  useEffect(() => onStatusRef.current(status), [status]);

  // Near the screen or not: the stage, and its WebGL context, exist only while it is.
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
          modules = await Promise.all([import("../three/stage.ts"), import("../three/mechanism-scene.ts")]);
        } catch {
          // A chunk that didn't download: the sim shows the sheet drawing instead.
          if (!disposed) setStatus("no-part");
          return;
        }
        const [{ createStage, readViewerInks }, { buildMechanism, placeLinks }] = modules;
        if (disposed) return;
        let made: Stage;
        try {
          made = createStage(host, readViewerInks(host));
        } catch {
          setStatus("no-webgl");
          return;
        }
        stage.current = made;
        place.current = placeLinks;
        const mechanism = buildMechanism(made.three, model, made.inks);
        built.current = mechanism;
        made.scene.add(mechanism.root);
        placeLinks(mechanism, poseRef.current);
        mechanism.root.updateMatrixWorld(true);
        // Framed once, over every pose: the camera never jumps as the mechanism moves.
        made.frame(mechanism.box);
        made.beforeDraw(() => {
          mechanism.root.updateMatrixWorld(true);
          const { width, height } = made.size();
          const rtl = getComputedStyle(host).direction === "rtl";
          const seen = NAMED[model.type].flatMap(([id, name]) => {
            const marker = mechanism.pins.get(name);
            if (!marker) return [];
            const at = made.project(marker.getWorldPosition(new made.three.Vector3()));
            return at.inside ? [{ id, y: at.y, x: at.x }] : [];
          });
          const placed = placeLabels(seen, height, LABEL_LINE);
          const edge = rtl ? 0 : width;
          made.setLeaders(
            placed.at.flatMap((l) => {
              const a = seen.find((s) => s.id === l.id);
              // The ringed crank pin's leader is the strong one.
              return a ? [{ from: [a.x, a.y], to: [edge, l.y], strong: l.id === "A" }] : [];
            }),
          );
          setLabels(placed);
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
      setLabels({ height: 0, at: [] });
      setStatus((now) => (now === "drawn" ? "waiting" : now));
    };
  }, [model, near]);

  // The pose moves the links; the stage draws once.
  useEffect(() => {
    const mechanism = built.current;
    if (!mechanism || !place.current || status !== "drawn") return;
    place.current(mechanism, pose);
    stage.current?.draw();
  }, [pose, status]);

  // A viewer that can't draw hands every gesture back to the page.
  useEffect(() => {
    if (status === "no-webgl" || status === "no-part") setActive(false);
  }, [status]);

  // Touch and the wheel: nothing is taken from the page until the mechanism is tapped.
  useEffect(() => {
    const el = objectEl.current;
    if (!el) return;
    let pinned: number | undefined;
    const gestures = createGestures({
      turn: (dx, dy) => activeRef.current && stage.current?.turn(dx, dy),
      pinch: (ratio) => activeRef.current && stage.current?.zoom(ratio),
      tap: () => usableRef.current && setActive(true),
    });
    /** Whether a press at (x, y) on the stage is on the driving pin's mark. */
    const onPin = (x: number, y: number) => {
      const marker = built.current?.pins.get(DRIVING[model.type]);
      const made = stage.current;
      if (!marker || !made) return false;
      const at = made.project(marker.getWorldPosition(new made.three.Vector3()));
      return at.inside && Math.hypot(at.x - x, at.y - y) <= PIN_REACH;
    };
    const turnPin = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const root = built.current?.root;
      const on = root && stage.current?.pointOnPlane(e.clientX - rect.left, e.clientY - rect.top, root);
      if (on) onAngleRef.current(dragAngle([0, 0], [on.x, on.y]));
    };
    const down = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (activeRef.current && onPin(e.clientX - rect.left, e.clientY - rect.top)) {
        pinned = e.pointerId;
        el.setPointerCapture(e.pointerId);
        return;
      }
      gestures.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      if (activeRef.current) el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (pinned === e.pointerId) turnPin(e);
      else gestures.move(e.pointerId, e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (pinned === e.pointerId) pinned = undefined;
      else gestures.up(e.pointerId, e.timeStamp);
    };
    const cancel = (e: PointerEvent) => {
      if (pinned === e.pointerId) pinned = undefined;
      else gestures.cancel(e.pointerId);
    };
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
  }, [model.type]);

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
      ? "This browser can't draw the mechanism in 3D: it is shown as the sheet drawing."
      : status === "no-part"
        ? "The mechanism didn't load in 3D: it is shown as the sheet drawing."
        : status === "waiting"
          ? "Drawing the mechanism…"
          : active
            ? "Drag the ringed pin to turn the driver, or anywhere else to turn the view; pinch or scroll to zoom. Tap outside it, or press Esc, to scroll the page again."
            : "Tap or click the mechanism to take hold of it. Until then the page scrolls over it.";

  return (
    <div className="mechanism-viewer" data-active={active}>
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
            aria-label={`${label}: tap to take hold of it`}
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
                data-pin={l.id}
                style={{ insetBlockStart: l.y - LABEL_LINE / 2 }}
              >
                <Letter text={model.labels?.[l.id] ?? l.id} />
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
    </div>
  );
}
