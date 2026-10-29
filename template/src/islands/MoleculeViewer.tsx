// The 3D viewer for a molecule (DESIGN.md, Live 3D Viewers): the conformer RDKit embedded, drawn by
// 3Dmol.js in standard Jmol CPK colours on a transparent stage, ball and stick, with an element key
// below it (a dot and a symbol for each element the molecule has). Tap or hover an atom and its
// symbol shows. 3Dmol.js loads after first paint and only while the viewer is near the screen: it
// is never part of a page's initial load, and a browser keeps about 16 WebGL contexts, so the
// stage gives its context back when the viewer leaves the screen.
//
// It never traps the page: until the student taps (or clicks) the molecule, a swipe or a wheel over
// it scrolls the page, and 3Dmol's own mouse handlers are switched off (they would take the wheel).
// Once tapped, one finger turns it, two pinch-zoom inside the frame (the wheel zooms too), and a
// tap outside, Escape, or scrolling it out of view hands the page back. Reset view restores the
// first view. No colour is written here: the palette comes in through props.
import { useEffect, useId, useRef, useState } from "react";
import type { GLViewer } from "3dmol";
import { nearestAtom, type ScreenAtom } from "../molecules/pick.ts";
import { createGestures } from "../viewer/gesture.ts";

interface Props {
  /** `<module>/<name>`: what the molecule gates and tests find the viewer by. */
  id: string;
  /** The 3D conformer, as an SDF. */
  sdf: string;
  /** The molecule's elements, in Hill order: the key lists exactly these. */
  elements: string[];
  /** Each element's Jmol CPK colour, `#RRGGBB`. */
  palette: Record<string, string>;
  /** What the molecule is, for assistive tech. */
  label: string;
}

type Status = "waiting" | "drawn" | "no-webgl" | "no-part";

/** How far one wheel notch zooms, when the viewer has the page's wheel. */
const WHEEL_ZOOM = 0.0015;
/**
 * How long a viewer stays near the screen before it starts drawing in 3D. Longer than a mechanism's: loading
 * 3Dmol.js and starting its WebGL can hold the page's main thread for a second or more on a slow machine, so it
 * waits until the page has come to rest.
 */
const DWELL_MS = 1200;
/** Degrees a drag of one pixel turns the molecule. */
const TURN_PER_PX = 0.5;

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

const hex = (n: number) => `#${n.toString(16).toUpperCase().padStart(6, "0")}`;

/** A quaternion turning a point `v` by `q` (x, y, z, w). */
function rotated([x, y, z]: [number, number, number], [qx, qy, qz, qw]: number[]): [number, number, number] {
  const tx = 2 * ((qy ?? 0) * z - (qz ?? 0) * y);
  const ty = 2 * ((qz ?? 0) * x - (qx ?? 0) * z);
  const tz = 2 * ((qx ?? 0) * y - (qy ?? 0) * x);
  return [
    x + (qw ?? 1) * tx + ((qy ?? 0) * tz - (qz ?? 0) * ty),
    y + (qw ?? 1) * ty + ((qz ?? 0) * tx - (qx ?? 0) * tz),
    z + (qw ?? 1) * tz + ((qx ?? 0) * ty - (qy ?? 0) * tx),
  ];
}

export default function MoleculeViewer({ id, sdf, elements, palette, label }: Props) {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>("waiting");
  const [active, setActive] = useState(false);
  const [picked, setPicked] = useState<string>();
  const [drawnPalette, setDrawnPalette] = useState<Record<string, string>>();
  const frameEl = useRef<HTMLElement>(null);
  const objectEl = useRef<HTMLDivElement>(null);
  const viewer = useRef<GLViewer>(undefined);
  const homeView = useRef<number[]>([]);
  const activeRef = useRef(false);
  activeRef.current = active;
  /**
   * A viewer that can't draw (no WebGL, a chunk that didn't load) leaves every gesture to the page.
   * One drawing, or drawing again as it comes back on screen, can be tapped on already.
   */
  const usable = status === "drawn" || status === "waiting";
  const usableRef = useRef(false);
  usableRef.current = usable;
  const hintId = useId();

  useEffect(() => setReady(true), []);

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

  /** Each atom where it is on the page now, with how deep it sits (smaller is nearer the camera). */
  const atomsOnScreen = (): (ScreenAtom & { client: [number, number] })[] => {
    const v = viewer.current;
    if (!v) return [];
    const atoms = v.getModel().selectedAtoms({});
    const spots = v.modelToScreen(atoms) as { x: number; y: number }[];
    const [cx = 0, cy = 0, cz = 0, , ...q] = v.getView();
    return atoms.flatMap((atom, i) => {
      const spot = spots[i];
      if (!spot) return [];
      const depth = -rotated([(atom.x ?? 0) - cx, (atom.y ?? 0) - cy, (atom.z ?? 0) - cz], q)[2];
      return [
        {
          index: atom.index ?? i,
          element: atom.elem ?? "",
          x: spot.x,
          y: spot.y,
          z: depth,
          client: [spot.x - window.scrollX, spot.y - window.scrollY] as [number, number],
        },
      ];
    });
  };

  /** Publishes where the atoms are on the page now (px), for assistive tests and tools: `[symbol, x, y]` each. */
  const publishAtoms = () => {
    const host = objectEl.current;
    if (!host) return;
    host.setAttribute(
      "data-atom-screen",
      JSON.stringify(atomsOnScreen().map((a) => [a.element, Math.round(a.x), Math.round(a.y)])),
    );
  };
  const publishRef = useRef(publishAtoms);
  publishRef.current = publishAtoms;

  const changed = () => publishRef.current();

  // 3Dmol.js, after first paint, while the viewer is near the screen and has stayed there a moment (as the three.js
  // viewers do): a page scrolled quickly past its molecules starts no WebGL.
  useEffect(() => {
    if (!near) return;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    let unlisten: (() => void) | undefined;
    let stop = () => {};
    const dwell = window.setTimeout(() => {
      stop = afterFirstPaint(() => {
        void (async () => {
          const host = objectEl.current;
          if (!host) return;
          let lib: typeof import("3dmol");
          try {
            lib = await import("3dmol");
          } catch {
            // A chunk that didn't download: the viewer says so, and keeps its element key.
            if (!disposed) setStatus("no-part");
            return;
          }
          if (disposed) return;
          const colours = Object.fromEntries(
            Object.entries(palette).map(([element, colour]) => [element, Number.parseInt(colour.slice(1), 16)]),
          );
          let made: GLViewer;
          try {
            // nomouse: 3Dmol's own handlers take the wheel and the touches; ours leave them to the page until a tap.
            // No antialiasing: 3Dmol renders at twice the size to smooth edges, four times the pixels to draw in software WebGL.
            made = lib.createViewer(host, {
              backgroundAlpha: 0,
              nomouse: true,
              antialias: false,
              defaultcolors: colours,
            });
            if (!made.getCanvas()) throw new Error("no canvas");
          } catch {
            host.replaceChildren();
            setStatus("no-webgl");
            return;
          }
          // The colours each atom is drawn in are its own: the palette, handed to the viewer as its defaults.
          made.addModel(sdf, "sdf");
          made.setStyle({}, { stick: { radius: 0.14 }, sphere: { scale: 0.25 } });
          made.zoomTo();
          made.render();
          viewer.current = made;
          homeView.current = made.getView();
          const drawn: Record<string, string> = {};
          for (const atom of made.getModel().selectedAtoms({})) {
            if (atom.elem !== undefined && typeof atom.color === "number") drawn[atom.elem] = hex(atom.color);
          }
          setDrawnPalette(drawn);
          observer = new ResizeObserver(() => {
            made.resize();
            made.render();
            publishRef.current();
          });
          observer.observe(host);
          // The atoms' places on the page move as the page scrolls or its layout settles: say where they are now.
          let queued = 0;
          const later = () => {
            cancelAnimationFrame(queued);
            queued = requestAnimationFrame(() => publishRef.current());
          };
          window.addEventListener("scroll", later, { passive: true });
          window.addEventListener("resize", later);
          unlisten = () => {
            cancelAnimationFrame(queued);
            window.removeEventListener("scroll", later);
            window.removeEventListener("resize", later);
          };
          publishRef.current();
          setStatus("drawn");
        })();
      });
    }, DWELL_MS);
    return () => {
      disposed = true;
      window.clearTimeout(dwell);
      stop();
      observer?.disconnect();
      unlisten?.();
      const v = viewer.current;
      viewer.current = undefined;
      if (v) {
        v.clear();
        // Give the context back now, not when the canvas is collected: the browser's limit is per page.
        const canvas = v.getCanvas();
        const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
      }
      objectEl.current?.replaceChildren();
      objectEl.current?.removeAttribute("data-atom-screen");
      setPicked(undefined);
      setDrawnPalette(undefined);
      setStatus((now) => (now === "drawn" ? "waiting" : now));
    };
  }, [sdf, palette, near]);

  // A viewer that can't draw hands every gesture back to the page.
  useEffect(() => {
    if (status === "no-webgl" || status === "no-part") setActive(false);
  }, [status]);

  // Touch, the wheel and hover: nothing is taken from the page until the molecule is tapped.
  useEffect(() => {
    const el = objectEl.current;
    if (!el) return;
    let lastUp: [number, number] | undefined;
    const pickAt = (x: number, y: number) => setPicked(nearestAtom(atomsOnScreen(), x, y)?.element);
    const gestures = createGestures({
      turn: (dx, dy) => {
        if (!activeRef.current || !viewer.current) return;
        viewer.current.rotate(dx * TURN_PER_PX, "y");
        viewer.current.rotate(dy * TURN_PER_PX, "x");
        changed();
      },
      pinch: (ratio) => {
        if (!activeRef.current || !viewer.current) return;
        viewer.current.zoom(ratio);
        changed();
      },
      tap: () => {
        if (!usableRef.current) return;
        setActive(true);
        if (lastUp) pickAt(...lastUp);
      },
    });
    const down = (e: PointerEvent) => {
      gestures.down(e.pointerId, e.clientX, e.clientY, e.timeStamp);
      if (activeRef.current) el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      gestures.move(e.pointerId, e.clientX, e.clientY);
      // A mouse hovering names the atom under it; a finger names it by tapping.
      if (e.pointerType === "mouse" && e.buttons === 0 && viewer.current) pickAt(e.pageX, e.pageY);
    };
    const up = (e: PointerEvent) => {
      lastUp = [e.pageX, e.pageY];
      gestures.up(e.pointerId, e.timeStamp);
    };
    const cancel = (e: PointerEvent) => gestures.cancel(e.pointerId);
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
    };
    // The handlers read the viewer through refs, so they are set once.
  }, []);

  // The wheel zooms only once the molecule is tapped. Until then it has no wheel listener at all: a listener
  // that may cancel the wheel makes the browser wait on this page's main thread before it scrolls, and a main
  // thread busy drawing WebGL would hold up the scroll the page is owed over the viewer.
  useEffect(() => {
    const el = objectEl.current;
    if (!el || !active) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      viewer.current?.zoom(Math.exp(-e.deltaY * WHEEL_ZOOM));
      changed();
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [active]);

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
    const v = viewer.current;
    if (!activeRef.current) {
      if (usableRef.current && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setActive(true);
      }
      return;
    }
    const moves: Record<string, () => void> = {
      ArrowLeft: () => v?.rotate(-10, "y"),
      ArrowRight: () => v?.rotate(10, "y"),
      ArrowUp: () => v?.rotate(-10, "x"),
      ArrowDown: () => v?.rotate(10, "x"),
      "+": () => v?.zoom(1.2),
      "=": () => v?.zoom(1.2),
      "-": () => v?.zoom(1 / 1.2),
    };
    const act = moves[e.key];
    if (act) {
      e.preventDefault();
      act();
      changed();
    }
  };

  const hint =
    status === "no-webgl"
      ? "This browser can't draw the molecule in 3D: its structure and element key are shown."
      : status === "no-part"
        ? "The molecule didn't load in 3D: its structure and element key are shown."
        : status === "waiting"
          ? "Drawing the molecule…"
          : active
            ? "Drag to turn it, pinch or scroll to zoom, tap an atom for its symbol. Tap outside it, or press Esc, to scroll the page again."
            : "Tap or click the molecule to turn it. Until then the page scrolls over it.";

  return (
    <div
      className="sim viewer molecule-viewer"
      data-molecule={id}
      data-palette={JSON.stringify(palette)}
      data-drawn-palette={drawnPalette === undefined ? undefined : JSON.stringify(drawnPalette)}
      data-ready={ready}
      data-drawn={status === "drawn"}
      data-active={active}
    >
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
          <div className="viewer-gutter" aria-live="polite">
            <span className="viewer-label molecule-atom" data-picked-atom>
              {picked}
            </span>
          </div>
        </div>
        <figcaption className="viewer-caption">
          <span id={hintId}>{hint}</span>
          <button
            type="button"
            className="button-print"
            disabled={!ready}
            onClick={() => {
              viewer.current?.setView(homeView.current);
              viewer.current?.render();
              changed();
            }}
          >
            Reset view
          </button>
        </figcaption>
        <ul className="element-key" aria-label="Element key">
          {elements.map((element) => (
            <li key={element} data-element={element}>
              <span className="element-dot" style={{ backgroundColor: palette[element] }} aria-hidden="true" />{" "}
              {element}
            </li>
          ))}
        </ul>
      </figure>
    </div>
  );
}
