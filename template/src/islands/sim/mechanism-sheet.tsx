// The mechanism as the Professor's sheet drawing, in SVG: hatched ground pins, pencil bars (or gear
// outlines), the coupler point's trace inking in as the mechanism turns, and the driving pin ringed.
// Drawn at its own size, never scaled to its box, so the pin letters stay at 14px (12px for a digit);
// a wider drawing scrolls inside its box. An engineering drawing never mirrors: its box stays
// ltr on a page set in Arabic too. One frame group turns the sheet frame (x along the ground line,
// y up, mm) into pixels; each moving link is a group inside it that the engine's pose sets as an SVG
// matrix, and its pins ride in it. Letters and the drive handle are drawn over the frame, in pixels.
import { useMemo, useRef } from "react";
import {
  dragAngle,
  gearOutline,
  linkPins,
  pins as placePins,
  svgMatrix,
  sweptBox,
  trace,
  type LinkId,
  type Model,
  type Point,
  type Pose,
} from "../../sims/mechanism/engine.ts";

interface Props {
  model: Model;
  pose: Pose;
  /** The whole degrees of the traced path the mechanism has been through: the crank's, or the driven gear's. */
  inked: ReadonlySet<number>;
  /** What the drawing is, for assistive tech. */
  label: string;
  /** The student drags the ringed pin: the driver's new angle. */
  onAngle(angle: number): void;
  /** Dragging waits for the island to hydrate. */
  ready: boolean;
}

/** The drawing's most pixels per mm, and the width it is drawn to when the mechanism is small. */
const MAX_SCALE = 3;
const DRAWN_WIDTH = 480;
/** Room round the swept box, each side, in pixels whatever the scale: the 14px letters hang beside their pins. */
const PAD_PX = 36;
/** The drive handle: its ring and its hit circle, in px (a 24px hit circle). */
const RING_PX = 8;
const HIT_PX = 12;
/** Letters sit this far off their pin, in px. */
const LETTER_OFFSET = 9;
/** A coupler's bars are this much of the shortest link wide. */
const BAR_WIDTH = 0.12;

/** A bar from the origin to `to` along x, rounded at both ends, `width` wide: SVG path data in its link's frame. */
const slot = (to: number, width: number) => {
  const r = width / 2;
  return `M0 ${-r}L${to} ${-r}A${r} ${r} 0 0 1 ${to} ${r}L0 ${r}A${r} ${r} 0 0 1 0 ${-r}Z`;
};

/** A pin's letter and its trailing digit as a 12px subscript, as the figure prints it (O2 is O with a 2 beneath). */
function Letter({ text, x, y }: { text: string; x: number; y: number }) {
  const [head = "", digit] = [text.slice(0, 1), text.slice(1)];
  return (
    <text className="mechanism-letter" x={x} y={y}>
      {head}
      {digit && (
        <tspan className="mechanism-letter-sub" dy={4}>
          {digit}
        </tspan>
      )}
    </text>
  );
}

/** The pins the drawing names, with the link each is read on. */
const NAMED: Record<Model["type"], readonly (readonly [key: string, link: LinkId, pin: string])[]> = {
  "four-bar": [
    ["O2", "ground", "O2"],
    ["A", "crank", "A"],
    ["B", "coupler", "B"],
    ["O4", "ground", "O4"],
    ["P", "coupler", "P"],
  ],
  "gear-pair": [
    ["O1", "ground", "O1"],
    ["O2", "ground", "O2"],
  ],
};

/**
 * The path the drawing traces, a point for each whole degree along it: the coupler point's (else B's) over a
 * crank turn, or the driven gear's tooth tip over its rim. The tip goes round the driven gear's whole circle,
 * which the driver takes several turns to cover, so it is drawn as that circle, a degree of the gear a point.
 */
function stemOf(model: Model): { from: number; length: number; degrees: number } | undefined {
  if (model.type !== "four-bar" || !model.couplerPoint) return undefined;
  const { along, off } = model.couplerPoint;
  const from = Math.min(Math.max(along, 0), model.coupler);
  const length = Math.hypot(along - from, off);
  return length > 1e-9 ? { from, length, degrees: (Math.atan2(off, along - from) * 180) / Math.PI } : undefined;
}

function tracedPath(model: Model): Point[] {
  if (model.type === "gear-pair") {
    const centre = model.centreDistance ?? (model.module * (model.teeth[0] + model.teeth[1])) / 2;
    const tip = (model.module * model.teeth[1]) / 2 + model.module;
    return Array.from({ length: 360 }, (_, k) => [
      centre + tip * Math.cos((k * Math.PI) / 180),
      tip * Math.sin((k * Math.PI) / 180),
    ]);
  }
  return trace(model).points[model.couplerPoint !== undefined ? "P" : "B"] ?? [];
}

export function MechanismSheet({ model, pose, inked, label, onAngle, ready }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<SVGGElement>(null);
  const dragging = useRef<number | undefined>(undefined);

  const geometry = useMemo(() => {
    const box = sweptBox(model);
    const [w, h] = [box.max[0] - box.min[0], box.max[1] - box.min[1]];
    const scale = Math.min(MAX_SCALE, (DRAWN_WIDTH - 2 * PAD_PX) / Math.max(w, h));
    const local = linkPins(model);
    const lengths =
      model.type === "four-bar" ? [model.ground, model.crank, model.coupler, model.rocker] : [model.module * 4];
    const width = BAR_WIDTH * Math.min(...lengths);
    return {
      scale,
      width,
      pinRadius: 0.32 * width,
      pxWidth: w * scale + 2 * PAD_PX,
      pxHeight: h * scale + 2 * PAD_PX,
      // Sheet (x, y up) to drawing pixels: scaled, y flipped, the box's corner at the margin.
      origin: [PAD_PX - box.min[0] * scale, PAD_PX + box.max[1] * scale] as const,
      local,
      // The coupler point hangs on a stem from the bar's nearest point, wherever P lies: before A, past B, or off to a side.
      stem: stemOf(model),
      path: tracedPath(model),
      gears:
        model.type === "gear-pair"
          ? ([0, 1] as const).map((g) => {
              const outline = gearOutline(model, g);
              return `M${outline.map(([x, y]) => `${Number(x.toFixed(4))} ${Number(y.toFixed(4))}`).join("L")}Z`;
            })
          : [],
    };
  }, [model]);
  const { scale, origin } = geometry;
  const px = (p: Point): [number, number] => [origin[0] + scale * p[0], origin[1] - scale * p[1]];

  const placed = placePins(model, pose);
  const letters = NAMED[model.type].flatMap(([key, link, pin]) => {
    const at = placed[link]?.[pin];
    return at ? [{ text: model.labels?.[key] ?? key, at: px(at), key }] : [];
  });
  const drive = model.type === "four-bar" ? placed.crank?.["A"] : placed.driver?.["H"];
  const drivePx = drive ? px(drive) : undefined;

  /** Runs of consecutive inked degrees, each as the polyline through the path's points, the wrap joined. */
  const runs = useMemo(() => {
    const out: Point[][] = [];
    let run: Point[] = [];
    for (let k = 0; k < 360; k++) {
      const at = geometry.path[k];
      if (inked.has(k) && at) run.push(at);
      else if (run.length > 0) {
        out.push(run);
        run = [];
      }
    }
    if (run.length > 0) {
      const first = out[0];
      // Inked across 359 → 0: one run, not two.
      if (inked.has(0) && inked.has(359) && first) out[0] = [...run, ...first];
      else out.push(run);
    }
    return out;
  }, [inked, geometry.path]);
  const points = (run: readonly Point[]) => run.map(([x, y]) => `${x},${y}`).join(" ");

  /** The pointer on the sheet, in mm, through the frame group's own matrix. */
  const sheetAt = (event: React.PointerEvent): Point | undefined => {
    const ctm = frame.current?.getScreenCTM();
    if (!ctm) return undefined;
    const at = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return [at.x, at.y];
  };
  const turnTo = (event: React.PointerEvent) => {
    const at = sheetAt(event);
    if (at) onAngle(dragAngle([0, 0], at));
  };

  const bars = (link: "crank" | "coupler" | "rocker") => {
    const own = geometry.local[link] ?? {};
    const far = Math.max(...Object.values(own).map((p) => p[0]));
    return <path className="mechanism-bar" d={slot(far, geometry.width)} vectorEffect="non-scaling-stroke" />;
  };
  const link = (id: LinkId) => {
    const at = pose.links[id];
    return at ? svgMatrix(at) : undefined;
  };

  return (
    <div className="mechanism-sheet-box" dir="ltr">
      <svg
        ref={svg}
        className="mechanism-sheet"
        width={geometry.pxWidth}
        height={geometry.pxHeight}
        viewBox={`0 0 ${geometry.pxWidth} ${geometry.pxHeight}`}
        role="img"
        aria-label={label}
      >
        <g ref={frame} data-sheet-frame transform={`matrix(${scale} 0 0 ${-scale} ${origin[0]} ${origin[1]})`}>
          <polygon
            className="mechanism-path"
            points={points(geometry.path)}
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          {runs.map((run, i) => (
            <polyline
              key={i}
              className="mechanism-ink"
              data-trace="inked"
              points={points(run)}
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {Object.entries(geometry.local.ground ?? {}).map(([name, at]) => (
            <g key={name} data-ground={name} transform={`translate(${at[0]} ${at[1]})`}>
              <path
                className="mechanism-ground"
                d="M0 0L-5 -5H5ZM-7 -5H7M-5 -5L-8 -8M-2 -5L-5 -8M1 -5L-2 -8M4 -5L1 -8"
              />
            </g>
          ))}
          {model.type === "four-bar"
            ? (["crank", "coupler", "rocker"] as const).map((id) => (
                <g key={id} data-link={id} transform={link(id)}>
                  {bars(id)}
                  {id === "coupler" && geometry.stem && (
                    <path
                      className="mechanism-bar"
                      d={slot(geometry.stem.length, geometry.width * 0.7)}
                      transform={`translate(${geometry.stem.from} 0) rotate(${geometry.stem.degrees})`}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {Object.entries(geometry.local[id] ?? {}).map(([name, at]) => (
                    <circle
                      key={name}
                      className="mechanism-pin"
                      data-pin={`${id}.${name}`}
                      cx={at[0]}
                      cy={at[1]}
                      r={name === "P" ? geometry.pinRadius * 0.8 : geometry.pinRadius}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              ))
            : (["driver", "driven"] as const).map((id, index) => (
                <g key={id} data-link={id} transform={link(id)}>
                  <path className="mechanism-bar" d={geometry.gears[index]} vectorEffect="non-scaling-stroke" />
                  <circle
                    className="mechanism-pitch"
                    r={(model.module * model.teeth[id === "driver" ? 0 : 1]) / 2}
                    fill="none"
                    vectorEffect="non-scaling-stroke"
                  />
                  {Object.entries(geometry.local[id] ?? {}).map(([name, at]) => (
                    <circle
                      key={name}
                      className="mechanism-pin"
                      data-pin={`${id}.${name}`}
                      cx={at[0]}
                      cy={at[1]}
                      r={geometry.pinRadius}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </g>
              ))}
        </g>
        {letters.map(({ text, at, key }) => (
          <Letter key={key} text={text} x={at[0] + LETTER_OFFSET} y={at[1] - LETTER_OFFSET} />
        ))}
        {drivePx && (
          <g data-drive-pin transform={`translate(${drivePx[0]} ${drivePx[1]})`}>
            <circle className="mechanism-ring" r={RING_PX} fill="none" />
            <circle
              className="mechanism-hit"
              r={HIT_PX}
              style={{ touchAction: "none" }}
              onPointerDown={(event) => {
                // The first finger keeps the pin; a second one on it does nothing.
                if (!ready || dragging.current !== undefined) return;
                dragging.current = event.pointerId;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (dragging.current === event.pointerId) turnTo(event);
              }}
              onPointerUp={(event) => {
                if (dragging.current === event.pointerId) dragging.current = undefined;
              }}
              onPointerCancel={(event) => {
                if (dragging.current === event.pointerId) dragging.current = undefined;
              }}
            />
          </g>
        )}
      </svg>
    </div>
  );
}
