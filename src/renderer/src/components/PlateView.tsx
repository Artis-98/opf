import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { offPlate, type PlateObject } from "../models";

export interface PlateViewHandle {
  /** Top view of the plate as a small PNG data: URL, for queue thumbnails. */
  thumbnail(): string | null;
}

interface Props {
  objects: PlateObject[];
  plate: [number, number];
  selected: string | null;
  theme: string;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888";

/**
 * A three.js scene kept outside React's render cycle. React tells it what
 * objects exist; it tells React when something is clicked or dragged.
 */
export const PlateView = forwardRef<PlateViewHandle, Props>(function PlateView(props, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    plateGroup: THREE.Group; objGroup: THREE.Group; meshes: Map<string, THREE.Mesh>; invalidate: () => void;
  } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // One-time setup.
  useEffect(() => {
    const el = wrap.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      el.textContent = "3D view needs WebGL, which this computer's graphics driver does not provide.";
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.maxPolarAngle = Math.PI * 0.49;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-200, -300, 500);
    scene.add(sun);
    const plateGroup = new THREE.Group();
    const objGroup = new THREE.Group();
    scene.add(plateGroup, objGroup);

    let frame = 0;
    const invalidate = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        renderer.render(scene, camera);
      });
    };
    controls.addEventListener("change", invalidate);
    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    sceneRef.current = { renderer, scene, camera, controls, plateGroup, objGroup, meshes: new Map(), invalidate };

    // Picking and dragging objects across the plate.
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const ndc = new THREE.Vector2();
    const hit = new THREE.Vector3();
    let drag: { id: string; mesh: THREE.Mesh; dx: number; dy: number; moved: boolean } | null = null;
    let down: { x: number; y: number } | null = null;
    const setRay = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY };
      setRay(e);
      const hits = ray.intersectObjects(objGroup.children, false);
      if (hits.length && ray.ray.intersectPlane(plane, hit)) {
        const mesh = hits[0].object as THREE.Mesh;
        const id = mesh.userData.id as string;
        propsRef.current.onSelect(id);
        drag = { id, mesh, dx: hit.x - mesh.position.x, dy: hit.y - mesh.position.y, moved: false };
        controls.enabled = false;
        renderer.domElement.setPointerCapture(e.pointerId);
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      setRay(e);
      if (!ray.ray.intersectPlane(plane, hit)) return;
      drag.mesh.position.x = hit.x - drag.dx;
      drag.mesh.position.y = hit.y - drag.dy;
      drag.moved = true;
      invalidate();
    };
    const onUp = (e: PointerEvent) => {
      if (drag) {
        if (drag.moved) propsRef.current.onMove(drag.id, Math.round(drag.mesh.position.x * 10) / 10, Math.round(drag.mesh.position.y * 10) / 10);
        drag = null;
        controls.enabled = true;
      } else if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) {
        propsRef.current.onSelect(null);
      }
      down = null;
    };
    const c = renderer.domElement;
    c.addEventListener("pointerdown", onDown);
    c.addEventListener("pointermove", onMove);
    c.addEventListener("pointerup", onUp);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      c.removeEventListener("pointerdown", onDown);
      c.removeEventListener("pointermove", onMove);
      c.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      c.remove();
      sceneRef.current = null;
    };
  }, []);

  // The plate: redrawn when its size or the theme changes. The camera is reset only when the size changes.
  const [W, D] = props.plate;
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.plateGroup.clear();
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: css("--plate"), roughness: 0.9 }));
    top.position.set(W / 2, D / 2, 0);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, D, 4), new THREE.MeshStandardMaterial({ color: css("--plate-line"), roughness: 0.9 }));
    slab.position.set(W / 2, D / 2, -2.05);
    const pts: number[] = [];
    for (let v = 0; v <= W + 0.01; v += 10) pts.push(v, 0, 0.05, v, D, 0.05);
    for (let v = 0; v <= D + 0.01; v += 10) pts.push(0, v, 0.05, W, v, 0.05);
    const grid = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pts, 3)), new THREE.LineBasicMaterial({ color: css("--plate-line"), transparent: true, opacity: 0.8 }));
    s.plateGroup.add(slab, top, grid);
    s.invalidate();
  }, [W, D, props.theme]);

  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    s.controls.target.set(W / 2, D / 2, 0);
    s.camera.position.set(W / 2 - W * 0.1, -D * 1.05, Math.max(W, D) * 1.25);
    s.controls.update();
    s.invalidate();
  }, [W, D]);

  // Objects: add, update and remove meshes to match props.
  useEffect(() => {
    const s = sceneRef.current;
    if (!s) return;
    const accent = new THREE.Color(css("--accent"));
    const err = new THREE.Color(css("--err"));
    const seen = new Set<string>();
    for (const o of props.objects) {
      seen.add(o.id);
      let mesh = s.meshes.get(o.id);
      if (!mesh || mesh.geometry !== o.geometry) {
        if (mesh) s.objGroup.remove(mesh);
        mesh = new THREE.Mesh(o.geometry, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.02 }));
        mesh.userData.id = o.id;
        s.meshes.set(o.id, mesh);
        s.objGroup.add(mesh);
      }
      mesh.position.set(o.x, o.y, 0);
      mesh.rotation.set(0, 0, o.rot);
      const m = mesh.material as THREE.MeshStandardMaterial;
      m.color.set(o.color);
      const bad = offPlate(o, props.plate);
      m.emissive.copy(bad ? err : props.selected === o.id ? accent : new THREE.Color(0));
      m.emissiveIntensity = bad ? 0.55 : props.selected === o.id ? 0.35 : 0;
      m.transparent = !!o.placeholder;
      m.opacity = o.placeholder ? 0.75 : 1;
    }
    for (const [id, mesh] of s.meshes) {
      if (!seen.has(id)) {
        s.objGroup.remove(mesh);
        (mesh.material as THREE.Material).dispose();
        s.meshes.delete(id);
      }
    }
    s.invalidate();
  }, [props.objects, props.selected, props.plate, props.theme]);

  useImperativeHandle(ref, () => ({
    thumbnail() {
      const s = sceneRef.current;
      if (!s) return null;
      const size = new THREE.Vector2();
      s.renderer.getSize(size);
      const cam = new THREE.OrthographicCamera(0, W, D, 0, -1000, 1000);
      cam.position.set(0, 0, 500);
      s.renderer.setSize(192, 192, false);
      s.renderer.render(s.scene, cam);
      const url = s.renderer.domElement.toDataURL("image/png");
      s.renderer.setSize(size.x, size.y, false);
      s.renderer.render(s.scene, s.camera);
      return url;
    },
  }), [W, D]);

  return <div ref={wrap} style={{ position: "absolute", inset: 0 }} />;
});
