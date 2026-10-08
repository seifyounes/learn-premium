// A machine part on the viewer's stage: its GLB (build123d's exact solid, tessellated) in matte
// with pencil edges, and its tagged dimensions drawn as pencil dimension lines, one of them in
// graphite when it is highlighted. The red pen is never drawn inside a viewer.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { matte, pencilEdges, type Stage } from "./stage.ts";

type Point3 = readonly [number, number, number];

export interface DimensionLine {
  id: string;
  /** Its ends in the drawing's frame (millimetres, +z up), as the part's descriptor gives them. */
  from: Point3;
  to: Point3;
}

export interface PartScene {
  /** Where each dimension's label is anchored: its line's middle, in the scene. */
  anchors: { id: string; at: THREE.Vector3 }[];
  /** Draws one dimension in graphite and the rest fainter, or every one in pencil. */
  emphasise(id: string | undefined): void;
}

/** The drawing's frame (z up) to three.js's (y up). */
const toScene = ([x, y, z]: Point3) => new THREE.Vector3(x, z, -y);

export async function showPart(stage: Stage, url: string, dimensions: readonly DimensionLine[]): Promise<PartScene> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  // glTF is in metres; the drawing and the stage are in millimetres. build123d's export already
  // turned the part +y up.
  model.scale.setScalar(1000);
  model.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];
  const surface = matte(stage.inks.desk);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = surface;
    geometries.push((object.geometry as THREE.BufferGeometry).clone().applyMatrix4(object.matrixWorld));
  });
  const part = new THREE.Group();
  part.add(model);
  part.add(pencilEdges(geometries, stage.inks.pencil));
  stage.scene.add(part);

  const lines = dimensions.map((d) => {
    const material = new THREE.LineBasicMaterial({
      color: stage.inks.pencil,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    });
    const from = toScene(d.from);
    const to = toScene(d.to);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), material);
    line.renderOrder = 2;
    stage.scene.add(line);
    return { id: d.id, line, material, at: from.clone().add(to).multiplyScalar(0.5) };
  });

  stage.frame(new THREE.Box3().setFromObject(model));
  return {
    anchors: lines.map(({ id, at }) => ({ id, at })),
    emphasise(id) {
      for (const l of lines) {
        const strong = l.id === id;
        l.material.color.set(strong ? stage.inks.graphite : stage.inks.pencil);
        l.material.opacity = id === undefined ? 0.7 : strong ? 1 : 0.3;
        l.line.renderOrder = strong ? 3 : 2;
      }
      stage.draw();
    },
  };
}
