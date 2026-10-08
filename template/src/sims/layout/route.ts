// The wire router: orthogonal A* on the pad's 20px grid, so every corner, jog and gap between
// wires is a whole grid step. Each net grows as a tree from the pin nearest its centre, straight
// joins first; a wire reaches a pin from the side the pin faces, crosses another net only straight
// over it (a crossing never connects), never runs along one, and pays to run beside one. A branch
// meets its tree at a T; the figure's dotted nets get a dot there.
import { splitPin, textBox, type ModelNet, type PlacedPart, type Text, type Wire } from "./drawing.ts";
import { boxOf, GRID, orient, pinsOf, SIDES, symbolOf, type Point, type Side } from "./symbols.ts";

/** E, S, W, N: the four ways a wire runs, as unit steps. */
const STEPS = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const satisfies readonly Point[];
type Dir = 0 | 1 | 2 | 3;
const DIRS = [0, 1, 2, 3] as const satisfies readonly Dir[];
const back = (d: Dir) => ((d + 2) % 4) as Dir;
const horizontal = (d: Dir) => d % 2 === 0;
const dirOf = ([x, y]: Point): Dir =>
  DIRS.find((d) => STEPS[d][0] === Math.sign(x) && STEPS[d][1] === Math.sign(y)) ?? 0;

const COST = {
  step: 1,
  bend: 3,
  crossing: 8,
  /** Running one grid step beside another net's wire: the figure's calm spacing. */
  beside: 4,
  /** Across a label. */
  text: 100,
  /** The cell a foreign pin's wire must leave through. */
  pinFront: 6,
};
/** Room the router may use beyond the parts, in grid steps. */
const MARGIN_CELLS = 6;
const MOST_EXPANSIONS = 200_000;
/** A body keeps this much clear around it, in px. */
const BODY_CLEARANCE = 4;
const TEXT_CLEARANCE = 4;

const key = (x: number, y: number) => `${x},${y}`;
const cellOf = ([x, y]: Point): [number, number] => [Math.round(x / GRID), Math.round(y / GRID)];

/** Per cell: each net there, with the ways its wires leave the cell (a pin's lead counts too). */
type Occupancy = Map<string, Map<string, Set<Dir>>>;

interface PinInfo {
  key: string;
  net: string;
  cell: [number, number];
  /** The way the pin's wire leaves it. */
  faces: Dir;
  lead: boolean;
}

export interface Routed {
  wires: Wire[];
  dots: Point[];
  unrouted: string[];
}

export function route(
  parts: readonly PlacedPart[],
  nets: readonly ModelNet[],
  { sides, dotted }: { sides: Readonly<Record<string, Side | undefined>>; dotted: ReadonlySet<string> },
): Routed {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const split = splitImplicit(nets, byId);
  const pins = new Map<string, PinInfo>();
  for (const net of split) {
    for (const pinKey of net.pins) {
      const [id, name] = splitPin(pinKey);
      const part = byId.get(id);
      const def = part && symbolOf(part.kind).pins[name];
      const at = part && pinsOf(part)[name];
      if (!part || !def || !at) continue;
      const faces = def.faces === "away-from-label" ? awayFrom(sides[id] ?? "left") : dirOf(orient(part, def.faces));
      pins.set(pinKey, { key: pinKey, net: net.id, cell: cellOf(at), faces, lead: def.lead });
    }
  }

  // Obstacles: bodies, labels, and every pin (its own net may end on it, from its side).
  const blocked = new Set<string>();
  const soft = new Map<string, number>();
  const pinAt = new Map<string, PinInfo>();
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    const [bx0, by0, bx1, by1] = boxOf(part);
    for (let x = Math.ceil((bx0 - BODY_CLEARANCE) / GRID); x <= Math.floor((bx1 + BODY_CLEARANCE) / GRID); x++)
      for (let y = Math.ceil((by0 - BODY_CLEARANCE) / GRID); y <= Math.floor((by1 + BODY_CLEARANCE) / GRID); y++)
        blocked.add(key(x, y));
    for (const [px, py] of Object.values(pinsOf(part))) {
      [x0, y0, x1, y1] = [Math.min(x0, px, bx0), Math.min(y0, py, by0), Math.max(x1, px, bx1), Math.max(y1, py, by1)];
    }
    if (part.label) markText(part.label, soft);
    for (const note of part.notes ?? []) markText(note, soft);
  }
  for (const p of pins.values()) {
    pinAt.set(key(...p.cell), p);
    const [dx, dy] = STEPS[p.faces];
    const front = key(p.cell[0] + dx, p.cell[1] + dy);
    soft.set(front, (soft.get(front) ?? 0) + COST.pinFront);
  }
  const bounds = {
    x0: Math.floor(x0 / GRID) - MARGIN_CELLS,
    y0: Math.floor(y0 / GRID) - MARGIN_CELLS,
    x1: Math.ceil(x1 / GRID) + MARGIN_CELLS,
    y1: Math.ceil(y1 / GRID) + MARGIN_CELLS,
  };

  const occupied: Occupancy = new Map();
  const armsAt = (k: string, net: string) => {
    let nets = occupied.get(k);
    if (!nets) occupied.set(k, (nets = new Map()));
    let arms = nets.get(net);
    if (!arms) nets.set(net, (arms = new Set()));
    return arms;
  };
  /** The other nets in a cell. */
  const othersAt = (k: string, net: string) => [...(occupied.get(k) ?? [])].filter(([n]) => n !== net);

  const wires: Wire[] = [];
  const unrouted: string[] = [];
  const spread = (n: ModelNet) => {
    const cells = n.pins.map((k) => pins.get(k)?.cell).filter((c): c is [number, number] => c !== undefined);
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
  };

  for (const net of [...split].sort((a, b) => spread(a) - spread(b))) {
    const own = net.pins.flatMap((k) => pins.get(k) ?? []);
    if (own.length < 2) continue;
    // Grow from the pin nearest the net's centre, so branches meet at a node as a figure's do.
    const mx = own.reduce((s, p) => s + p.cell[0], 0) / own.length;
    const my = own.reduce((s, p) => s + p.cell[1], 0) / own.length;
    const byCentre = [...own].sort(
      (a, b) => Math.hypot(a.cell[0] - mx, a.cell[1] - my) - Math.hypot(b.cell[0] - mx, b.cell[1] - my),
    );
    const [first, ...rest] = byCentre as [PinInfo, ...PinInfo[]];
    const tree = new Set([key(...first.cell)]);
    const firstArms = armsAt(key(...first.cell), net.id);
    if (first.lead) firstArms.add(back(first.faces));
    while (rest.length > 0) {
      // The pin nearest the tree; one in line with it (a straight join) wins a tie.
      rest.sort((a, b) => nearness(a.cell, tree) - nearness(b.cell, tree));
      const next = rest.shift();
      if (!next) break;
      const path = search(next, tree, net.id);
      if (!path) {
        unrouted.push(next.key);
        continue;
      }
      lay(path, net.id, next, tree);
      wires.push({ points: corners(path).map(([x, y]) => [x * GRID, y * GRID] as const) });
    }
  }

  const dots: Point[] = [];
  for (const [cell, nets] of occupied) {
    for (const [net, arms] of nets) {
      if (!dotted.has(baseNet(net)) || arms.size < 3) continue;
      const [x, y] = cell.split(",").map(Number) as [number, number];
      dots.push([x * GRID, y * GRID]);
    }
  }
  return { wires, dots, unrouted };

  /** Marks a path's cells as the net's, with the arms each now has; the net's own cells join its tree. */
  function lay(path: [number, number][], net: string, start: PinInfo, tree: Set<string>) {
    path.forEach((cell, i) => {
      const k = key(...cell);
      const arms = armsAt(k, net);
      if (i === 0 && start.lead) arms.add(back(start.faces));
      for (const other of [path[i - 1], path[i + 1]]) {
        if (other) arms.add(dirOf([other[0] - cell[0], other[1] - cell[1]]));
      }
      tree.add(k);
    });
  }

  /** A* from `start` to any cell of `goal`: the cheapest legal wire, or undefined. */
  function search(start: PinInfo, goal: Set<string>, net: string): [number, number][] | undefined {
    const h = (x: number, y: number) => {
      let best = Infinity;
      for (const g of goal) {
        const [gx, gy] = g.split(",").map(Number) as [number, number];
        best = Math.min(best, Math.abs(gx - x) + Math.abs(gy - y));
      }
      return best;
    };
    const [sx, sy] = start.cell;
    const startState = `${sx},${sy},-`;
    const cost = new Map([[startState, 0]]);
    const came = new Map<string, string>();
    const open = new Heap();
    open.push(h(sx, sy), { x: sx, y: sy, dir: undefined, g: 0, state: startState });
    let expansions = 0;
    while (open.size > 0 && expansions++ < MOST_EXPANSIONS) {
      const node = open.pop();
      if (!node || node.g > (cost.get(node.state) ?? Infinity)) continue;
      const here = key(node.x, node.y);
      if (goal.has(here) && node.state !== startState) return unwind(node.state);
      const crossing = node.state !== startState && othersAt(here, net).length > 0;
      for (const d of DIRS) {
        // A wire leaves its pin the way the pin faces; over a crossing it keeps straight on.
        if (node.dir === undefined && d !== start.faces) continue;
        if (crossing && d !== node.dir) continue;
        if (node.dir !== undefined && d === back(node.dir)) continue;
        const nx = node.x + STEPS[d][0];
        const ny = node.y + STEPS[d][1];
        if (nx < bounds.x0 || nx > bounds.x1 || ny < bounds.y0 || ny > bounds.y1) continue;
        const step = enter(nx, ny, d, net, goal);
        if (step === undefined) continue;
        const g = node.g + COST.step + step + (node.dir !== undefined && d !== node.dir ? COST.bend : 0);
        const state = `${nx},${ny},${d}`;
        if (g >= (cost.get(state) ?? Infinity)) continue;
        cost.set(state, g);
        came.set(state, node.state);
        open.push(g + h(nx, ny), { x: nx, y: ny, dir: d, g, state });
      }
    }
    return undefined;

    function unwind(state: string): [number, number][] {
      const path: [number, number][] = [];
      for (let s: string | undefined = state; s !== undefined; s = came.get(s)) {
        const [x, y] = s.split(",").map(Number) as [number, number];
        path.push([x, y]);
      }
      return path.reverse();
    }
  }

  /** The extra cost of moving into a cell going `d`, or undefined when the move is illegal. */
  function enter(x: number, y: number, d: Dir, net: string, goal: Set<string>): number | undefined {
    const k = key(x, y);
    const pin = pinAt.get(k);
    const others = othersAt(k, net);
    if (goal.has(k)) {
      if (others.length > 0) return undefined;
      // A pin is met from the side it faces; a wire is met at a T, never where three arms meet.
      if (pin) return pin.net === net && back(pin.faces) === d ? 0 : undefined;
      const arms = occupied.get(k)?.get(net);
      return arms && arms.size < 3 && !arms.has(back(d)) ? 0 : undefined;
    }
    if (pin || blocked.has(k) || occupied.get(k)?.has(net)) return undefined;
    let extra = soft.get(k) ?? 0;
    if (others.length > 0) {
      // Only straight over one wire running the other way.
      const across: Dir[] = horizontal(d) ? [1, 3] : [0, 2];
      const [only, ...more] = others;
      const arms = only?.[1];
      if (more.length > 0 || !arms || arms.size !== 2 || !across.every((a) => arms.has(a))) return undefined;
      extra += COST.crossing;
    }
    for (const side of (horizontal(d) ? [1, 3] : [0, 2]) as Dir[]) {
      const beside = othersAt(key(x + STEPS[side][0], y + STEPS[side][1]), net);
      if (beside.some(([, arms]) => [...arms].some((a) => horizontal(a) === horizontal(d)))) extra += COST.beside;
    }
    return extra;
  }
}

/** Distance from a cell to the tree; a cell in line with a tree cell (a straight join) goes first on ties. */
function nearness([x, y]: [number, number], tree: Set<string>) {
  let best = Infinity;
  for (const t of tree) {
    const [tx, ty] = t.split(",").map(Number) as [number, number];
    best = Math.min(best, Math.abs(tx - x) + Math.abs(ty - y) + (tx === x || ty === y ? 0 : 0.5));
  }
  return best;
}

/** The way a terminal's wire leaves it, by the side its label sits on (in `SIDES` order). */
const AWAY_FROM: readonly Dir[] = [0, 2, 1, 3];
const awayFrom = (side: Side): Dir => AWAY_FROM[SIDES.indexOf(side)] ?? 0;

function markText(t: Text, soft: Map<string, number>) {
  const [tx0, ty0, tx1, ty1] = textBox(t);
  for (let x = Math.ceil((tx0 - TEXT_CLEARANCE) / GRID); x <= Math.floor((tx1 + TEXT_CLEARANCE) / GRID); x++)
    for (let y = Math.ceil((ty0 - TEXT_CLEARANCE) / GRID); y <= Math.floor((ty1 + TEXT_CLEARANCE) / GRID); y++)
      soft.set(key(x, y), (soft.get(key(x, y)) ?? 0) + COST.text);
}

/** A net split per ground: each other pin goes to its nearest implicit symbol (grounds join without wires). */
const IMPLICIT_PART = "~";
const baseNet = (id: string) => id.split(IMPLICIT_PART)[0] ?? id;

function splitImplicit(nets: readonly ModelNet[], byId: Map<string, PlacedPart>): ModelNet[] {
  const isImplicit = (k: string) => {
    const part = byId.get(splitPin(k)[0]);
    return part !== undefined && symbolOf(part.kind).implicit !== undefined;
  };
  const at = (k: string) => {
    const [id, name] = splitPin(k);
    const part = byId.get(id);
    return part ? pinsOf(part)[name] : undefined;
  };
  return nets.flatMap((net) => {
    const implicit = net.pins.filter(isImplicit);
    if (implicit.length <= 1) return [net];
    const groups = new Map(implicit.map((k) => [k, [k]]));
    for (const k of net.pins.filter((p) => !isImplicit(p))) {
      const [x, y] = at(k) ?? [0, 0];
      const nearest = implicit.reduce((a, g) => {
        const [ax, ay] = at(a) ?? [0, 0];
        const [gx, gy] = at(g) ?? [0, 0];
        return Math.abs(gx - x) + Math.abs(gy - y) < Math.abs(ax - x) + Math.abs(ay - y) ? g : a;
      });
      groups.get(nearest)?.push(k);
    }
    return [...groups]
      .filter(([, pins]) => pins.length > 1)
      .map(([g, pins]) => ({ id: `${net.id}${IMPLICIT_PART}${g}`, pins }));
  });
}

/** A path's corners: its first cell, every cell where it turns, and its last. */
function corners(path: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  path.forEach((cell, i) => {
    const prev = path[i - 1];
    const next = path[i + 1];
    if (!prev || !next || prev[0] - cell[0] !== cell[0] - next[0] || prev[1] - cell[1] !== cell[1] - next[1])
      out.push(cell);
  });
  return out;
}

interface Node {
  x: number;
  y: number;
  dir: Dir | undefined;
  g: number;
  state: string;
}

/** A binary min-heap on f. */
class Heap {
  private items: { f: number; node: Node }[] = [];
  get size() {
    return this.items.length;
  }
  push(f: number, node: Node) {
    const items = this.items;
    items.push({ f, node });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const [a, b] = [items[i], items[parent]];
      if (!a || !b || b.f <= a.f) break;
      [items[i], items[parent]] = [b, a];
      i = parent;
    }
  }
  pop(): Node | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if ((items[l]?.f ?? Infinity) < (items[m]?.f ?? Infinity)) m = l;
        if ((items[r]?.f ?? Infinity) < (items[m]?.f ?? Infinity)) m = r;
        if (m === i) break;
        [items[i], items[m]] = [items[m] as (typeof items)[number], items[i] as (typeof items)[number]];
        i = m;
      }
    }
    return top?.node;
  }
}
