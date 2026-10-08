// The 3D viewer's stage: a plain three.js renderer in a framed viewer on the sheet (DESIGN.md, Live
// 3D Viewers). A transparent background, so the sheet's grid shows through; matte materials and
// pencil edges, never the default glossy three.js look; colours read from the page's tokens, so
// nothing here names one. The camera orbits the object (`src/viewer/orbit.ts`), and the stage draws
// only when something changed. Machine parts, mechanisms (#61) and chemistry apparatus (#62) each
// add their objects to `scene` and draw on the same stage.
//
// This module imports three.js: the viewer loads it only after first paint, never with the page.
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { atHome, cameraOffset, homeView, turn, zoom, type Orbit } from "../../viewer/orbit.ts";

/** The pad's inks and slots a viewer draws with, read from the page's tokens. */
export interface ViewerInks {
  graphite: string;
  pencil: string;
  sheet: string;
  desk: string;
  print: string;
}

export function readViewerInks(el: Element): ViewerInks {
  const style = getComputedStyle(el);
  const token = (name: string) => style.getPropertyValue(`--color-${name}`).trim();
  return {
    graphite: token("graphite"),
    pencil: token("pencil"),
    sheet: token("sheet"),
    desk: token("desk"),
    print: token("print"),
  };
}

/** A screen-space line on the stage, in CSS pixels: x from the stage's left edge, y down from its upper edge. A label's leader. */
export type Leader = { from: [number, number]; to: [number, number]; strong: boolean };

export interface Stage {
  three: typeof THREE;
  /** Add the viewer's objects here, in three.js's frame (+y up), in millimetres. */
  scene: THREE.Group;
  inks: ViewerInks;
  /** Frames `box`: the home view fits it, and the view goes home. */
  frame(box: THREE.Box3): void;
  /** One-finger turn, pinch zoom and Reset view; each redraws. */
  turn(dx: number, dy: number): void;
  zoom(factor: number): void;
  reset(): void;
  atHome(): boolean;
  /** Where a point in the scene falls on the stage, in CSS pixels, and whether it is on it. */
  project(point: THREE.Vector3): { x: number; y: number; inside: boolean };
  /** The stage's size in CSS pixels. */
  size(): { width: number; height: number };
  /** Lines drawn over the scene in screen space, beside the object, never across it. */
  setLeaders(leaders: readonly Leader[]): void;
  /** Called before every draw, with the camera placed: labels follow the view here. */
  beforeDraw(callback: () => void): void;
  /** Ask for a draw on the next frame (several asks make one draw). */
  draw(): void;
  dispose(): void;
}

const FOV_DEG = 30;
/** The home view brings the part's box this close to the frame's edges (normalised device units). */
const FIT_EDGE = 0.9;

/** A matte surface: lit, never glossy. */
export const matte = (colour: string) =>
  new THREE.MeshLambertMaterial({ color: colour, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

/**
 * Pencil edges for a mesh: the creases between faces (over 30°), drawn once even where the mesh's
 * faces were exported apart (each face of a solid is its own primitive, with its own seam).
 */
export function pencilEdges(geometries: THREE.BufferGeometry[], colour: string): THREE.LineSegments {
  const bare = geometries.map((g) => {
    const position = g.getAttribute("position");
    const only = new THREE.BufferGeometry();
    only.setAttribute("position", position);
    if (g.index) only.setIndex(g.index);
    return only.index ? only.toNonIndexed() : only;
  });
  const merged = mergeVertices(mergeGeometries(bare), 1e-6);
  return new THREE.LineSegments(new THREE.EdgesGeometry(merged, 30), new THREE.LineBasicMaterial({ color: colour }));
}

/** Makes the stage in `host`, or throws when the browser can't draw WebGL. */
export function createStage(host: HTMLElement, inks: ViewerInks): Stage {
  const canvas = document.createElement("canvas");
  canvas.className = "viewer-canvas";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearAlpha(0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.autoClear = false;
  host.append(canvas);

  const world = new THREE.Scene();
  const scene = new THREE.Group();
  world.add(scene);
  world.add(new THREE.HemisphereLight(inks.sheet, inks.print, 2.2));
  const sun = new THREE.DirectionalLight(inks.sheet, 1.6);
  world.add(sun);
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.1, 100_000);

  // Leaders: a screen-space scene in CSS pixels, y down, drawn after the object.
  const overlay = new THREE.Scene();
  const flat = new THREE.OrthographicCamera(0, 1, 0, -1, -1, 1);
  const leaderLines = {
    weak: new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: inks.pencil })),
    strong: new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: inks.graphite })),
  };
  overlay.add(leaderLines.weak, leaderLines.strong);

  let width = 1;
  let height = 1;
  const target = new THREE.Vector3();
  let radius = 1;
  /** The framed box's corners: the home view fits them, not just the sphere round them. */
  let corners: THREE.Vector3[] = [];
  let home: Orbit = homeView({ radius, fovDeg: FOV_DEG, aspect: 1 });
  let view = home;
  const before: (() => void)[] = [];
  let pending = 0;

  const place = () => {
    const [x, y, z] = cameraOffset(view);
    camera.position.set(target.x + x, target.y + y, target.z + z);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    // The labels project their anchors before the renderer would update the camera's matrices.
    camera.updateMatrixWorld();
    camera.near = Math.max(view.distance - radius * 4, view.distance / 100);
    camera.far = view.distance + radius * 4;
    camera.updateProjectionMatrix();
    // The light comes from over the viewer's left shoulder, wherever the camera turns.
    sun.position.copy(camera.position).add(new THREE.Vector3(-radius, radius * 2, 0));
  };
  /**
   * The home view: the 3/4 view, as close as it can come with every corner of the part's box inside
   * the frame. The whole bounding sphere always fits, so the search starts from there and closes in.
   */
  const fitHome = (): Orbit => {
    const sphere = homeView({ radius, fovDeg: FOV_DEG, aspect: camera.aspect });
    const fits = (distance: number) => {
      view = { ...sphere, distance };
      place();
      return corners.every((c) => {
        const p = c.clone().project(camera);
        return p.z < 1 && Math.abs(p.x) <= FIT_EDGE && Math.abs(p.y) <= FIT_EDGE;
      });
    };
    let far = sphere.distance;
    let near = sphere.distance * 0.3;
    if (corners.length === 0 || fits(near)) return { ...sphere, distance: corners.length === 0 ? far : near };
    for (let i = 0; i < 24; i++) {
      const mid = (near + far) / 2;
      if (fits(mid)) far = mid;
      else near = mid;
    }
    return { ...sphere, distance: far };
  };
  const render = () => {
    pending = 0;
    place();
    for (const callback of before) callback();
    renderer.clear();
    renderer.render(world, camera);
    renderer.clearDepth();
    renderer.render(overlay, flat);
  };
  const draw = () => {
    if (!pending) pending = requestAnimationFrame(render);
  };
  const resize = () => {
    width = Math.max(1, host.clientWidth);
    height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    flat.right = width;
    flat.bottom = -height;
    flat.updateProjectionMatrix();
    const wasHome = atHome(view, home);
    const kept = view;
    home = fitHome();
    view = wasHome ? home : kept;
    draw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  return {
    three: THREE,
    scene,
    inks,
    frame(box) {
      box.getCenter(target);
      radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1e-3);
      corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
        (i) =>
          new THREE.Vector3(
            i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y,
            i & 4 ? box.max.z : box.min.z,
          ),
      );
      home = fitHome();
      view = home;
      draw();
    },
    turn(dx, dy) {
      view = turn(view, dx, dy, height);
      draw();
    },
    zoom(factor) {
      view = zoom(view, factor, home);
      draw();
    },
    reset() {
      view = home;
      draw();
    },
    atHome: () => atHome(view, home),
    project(point) {
      const p = point.clone().project(camera);
      const x = ((p.x + 1) / 2) * width;
      const y = ((1 - p.y) / 2) * height;
      return { x, y, inside: p.z < 1 && x >= 0 && x <= width && y >= 0 && y <= height };
    },
    size: () => ({ width, height }),
    setLeaders(leaders) {
      for (const strong of [false, true]) {
        const points = leaders
          .filter((l) => l.strong === strong)
          .flatMap((l) => [new THREE.Vector3(l.from[0], -l.from[1], 0), new THREE.Vector3(l.to[0], -l.to[1], 0)]);
        const lines = strong ? leaderLines.strong : leaderLines.weak;
        lines.geometry.dispose();
        lines.geometry = new THREE.BufferGeometry().setFromPoints(points);
      }
    },
    beforeDraw: (callback) => before.push(callback),
    draw,
    dispose() {
      cancelAnimationFrame(pending);
      observer.disconnect();
      world.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments || o instanceof THREE.Line) o.geometry.dispose();
      });
      renderer.dispose();
      // Give the context back now, not when the canvas is collected: the browser's limit is per page.
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
