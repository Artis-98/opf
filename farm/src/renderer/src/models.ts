// Loading models onto a plate, laying them out, and writing them back out for the slicer.
// Coordinates are the slicer's: millimetres, Z up, plate origin at the front-left corner.

import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { meshArea, meshVolume } from "../../core/estimate";

export interface PlateObject {
  id: string;
  name: string;
  /** Non-indexed, centred on X/Y, resting on Z = 0. */
  geometry: THREE.BufferGeometry;
  /** Centre on the plate, mm. */
  x: number;
  y: number;
  /** Turn about Z, radians. */
  rot: number;
  color: string;
  material: string;
  size: { x: number; y: number; z: number };
  volume: number;
  area: number;
  /** A stand-in box for an inbox item with no model file. */
  placeholder?: boolean;
}

let n = 0;
const uid = () => `o${Date.now().toString(36)}${(n++).toString(36)}`;

/** Build volume of common printers, mm. Unknown models get a 256 mm Bambu plate. */
export function plateSize(model: string): [number, number] {
  const m = model.toLowerCase();
  if (/a1 ?mini/.test(m)) return [180, 180];
  if (/h2d|h2s/.test(m)) return [350, 320];
  if (/x1|p1|a1|p2s/.test(m)) return [256, 256];
  if (/mk4|mk3|core one/.test(m)) return [250, 210];
  if (/xl/.test(m)) return [360, 360];
  if (/voron.*350|350/.test(m)) return [350, 350];
  if (/voron.*300|300/.test(m)) return [300, 300];
  if (/ender ?3|k1/.test(m)) return [220, 220];
  return [256, 256];
}

function finish(geometry: THREE.BufferGeometry, name: string, color: string, material: string): PlateObject {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  g.computeBoundingBox();
  const b = g.boundingBox!;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);
  g.computeVertexNormals();
  g.computeBoundingBox();
  const s = g.boundingBox!.getSize(new THREE.Vector3());
  const pos = g.getAttribute("position").array as ArrayLike<number>;
  return { id: uid(), name, geometry: g, x: 0, y: 0, rot: 0, color, material, size: { x: s.x, y: s.y, z: s.z }, volume: meshVolume(pos), area: meshArea(pos) };
}

function meshesOf(root: THREE.Object3D): THREE.BufferGeometry[] {
  root.updateMatrixWorld(true);
  const out: THREE.BufferGeometry[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      out.push(g.index ? g.toNonIndexed() : g);
    }
  });
  return out;
}

/** One file can hold several objects (a 3MF with several parts); each becomes its own object on the plate. */
export async function loadModel(fileName: string, data: Uint8Array, color: string, material: string): Promise<PlateObject[]> {
  const ext = fileName.toLowerCase().split(".").pop();
  const base = fileName.replace(/\.[^.]+$/, "");
  const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  if (ext === "stl") return [finish(new STLLoader().parse(buf), base, color, material)];
  if (ext === "3mf") {
    const group = new ThreeMFLoader().parse(buf);
    const parts = meshesOf(group);
    if (!parts.length) throw new Error(`${fileName} has no objects in it.`);
    return parts.map((g, i) => finish(g, parts.length > 1 ? `${base} ${i + 1}` : base, color, material));
  }
  if (ext === "obj") {
    const group = new OBJLoader().parse(new TextDecoder().decode(data));
    const parts = meshesOf(group).map((g) => { g.deleteAttribute("uv"); g.deleteAttribute("normal"); return g; });
    if (!parts.length) throw new Error(`${fileName} has no objects in it.`);
    const merged = mergeGeometries(parts)!;
    merged.rotateX(Math.PI / 2); // OBJ files are usually Y-up
    return [finish(merged, base, color, material)];
  }
  throw new Error(`OPF reads STL, 3MF and OBJ files, not .${ext}.`);
}

export function placeholder(name: string, color: string, material: string, w = 40, d = 40, h = 20): PlateObject {
  const o = finish(new THREE.BoxGeometry(w, d, h), name, color, material);
  o.placeholder = true;
  return o;
}

export function clone(o: PlateObject): PlateObject {
  return { ...o, id: uid(), size: { ...o.size } };
}

export function footprint(o: PlateObject): { w: number; d: number } {
  const c = Math.abs(Math.cos(o.rot)), s = Math.abs(Math.sin(o.rot));
  return { w: c * o.size.x + s * o.size.y, d: s * o.size.x + c * o.size.y };
}

export function offPlate(o: PlateObject, [W, D]: [number, number]): boolean {
  const f = footprint(o);
  return o.x - f.w / 2 < -0.01 || o.y - f.d / 2 < -0.01 || o.x + f.w / 2 > W + 0.01 || o.y + f.d / 2 > D + 0.01 || o.size.z > 400;
}

/** Row packing, biggest first, 6 mm apart, then the whole layout centred on the plate the way slicers do. */
export function arrange(objs: PlateObject[], [W, D]: [number, number], gap = 6): PlateObject[] {
  const order = [...objs].sort((a, b) => footprint(b).w * footprint(b).d - footprint(a).w * footprint(a).d);
  let x = gap, y = D - gap, rowD = 0;
  const placed = new Map<string, { x: number; y: number }>();
  for (const o of order) {
    const f = footprint(o);
    if (x + f.w > W - gap + 0.01 && x > gap) {
      x = gap;
      y -= rowD + gap;
      rowD = 0;
    }
    placed.set(o.id, { x: x + f.w / 2, y: y - f.d / 2 });
    x += f.w + gap;
    rowD = Math.max(rowD, f.d);
  }
  // Centre the packed block on the plate.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const o of order) {
    const f = footprint(o), c = placed.get(o.id)!;
    minX = Math.min(minX, c.x - f.w / 2); maxX = Math.max(maxX, c.x + f.w / 2);
    minY = Math.min(minY, c.y - f.d / 2); maxY = Math.max(maxY, c.y + f.d / 2);
  }
  const dx = order.length ? W / 2 - (minX + maxX) / 2 : 0;
  const dy = order.length && maxY - minY <= D ? D / 2 - (minY + maxY) / 2 : 0;
  return objs.map((o) => {
    const c = placed.get(o.id)!;
    return { ...o, x: c.x + dx, y: c.y + dy };
  });
}

/** The object as a binary STL, in plate coordinates, for the slicer. */
export function toStl(o: PlateObject): Uint8Array {
  const g = o.geometry.clone();
  g.rotateZ(o.rot);
  g.translate(o.x, o.y, 0);
  const view = new STLExporter().parse(new THREE.Mesh(g), { binary: true }) as DataView;
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}
