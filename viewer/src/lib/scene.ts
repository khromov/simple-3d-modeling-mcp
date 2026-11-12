/**
 * The three.js scene: model, edges, grid, axes, lights and orbit camera.
 * OpenSCAD is Z-up, so the scene is too.
 */

import {
  AxesHelper,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  MathUtils,
  Mesh,
  MeshPhongMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ViewerMesh } from "./mesh.js";

Object3D.DEFAULT_UP.set(0, 0, 1); // OpenSCAD is Z-up

export class ViewerScene {
  readonly #scene = new Scene();
  readonly #camera = new PerspectiveCamera(40, 1, 0.1, 10000);
  readonly #renderer = new WebGLRenderer({ antialias: true });
  readonly #controls: OrbitControls;
  readonly #hemi = new HemisphereLight(0xffffff, 0x404060, 1.2);
  readonly #key = new DirectionalLight(0xffffff, 1.6);
  readonly #fill = new DirectionalLight(0x8899ff, 0.5);
  readonly #material = new MeshPhongMaterial({
    vertexColors: true, flatShading: true, shininess: 40, specular: 0x222222, side: DoubleSide,
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // keep edge lines on top
  });
  readonly #edgeMaterial = new LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 });

  #dark = true;
  #showEdges = true;
  #showGrid = true;
  #modelColor = new Color("#ff8c00");
  #grid: GridHelper | null = null;
  #gridSize = 200;
  #axes: AxesHelper | null = null;
  #mesh: Mesh | null = null;
  #edges: LineSegments | null = null;
  /** Per triangle: 1 = painted with the model colour. */
  #defaultMask: Uint8Array | null = null;
  #home: { position: Vector3; target: Vector3 } | null = null;
  #lastRadius = 0;

  constructor() {
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.#controls = new OrbitControls(this.#camera, this.#renderer.domElement);
    this.#controls.enableDamping = true;
    this.#controls.autoRotateSpeed = 1.5;
    this.#hemi.position.set(0, 0, 1);
    this.#scene.add(this.#hemi, this.#key, this.#fill);
    this.#applyTheme();
  }

  /** Puts the canvas into `container`, sizes it to fit and starts rendering. Returns the undo. */
  mount(container: HTMLElement): () => void {
    container.appendChild(this.#renderer.domElement);
    const resize = () => {
      const w = container.clientWidth, h = container.clientHeight;
      if (!w || !h) return;
      this.#camera.aspect = w / h;
      this.#camera.updateProjectionMatrix();
      this.#renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    this.#renderer.setAnimationLoop(() => {
      this.#controls.update();
      this.#renderer.render(this.#scene, this.#camera);
    });
    return () => {
      this.#renderer.setAnimationLoop(null);
      observer.disconnect();
      this.#renderer.domElement.remove();
    };
  }

  setTheme(dark: boolean): void {
    if (dark === this.#dark) return;
    this.#dark = dark;
    this.#applyTheme();
  }

  setEdges(visible: boolean): void {
    this.#showEdges = visible;
    if (this.#edges) this.#edges.visible = visible;
  }

  setWireframe(on: boolean): void {
    this.#material.wireframe = on;
  }

  setAutoRotate(on: boolean): void {
    this.#controls.autoRotate = on;
  }

  /** Shows or hides the grid and the axes. */
  setGrid(visible: boolean): void {
    this.#showGrid = visible;
    if (this.#grid) this.#grid.visible = visible;
    if (this.#axes) this.#axes.visible = visible;
  }

  /** Colour for parts without color(). */
  setModelColor(hex: string): void {
    this.#modelColor = new Color(hex);
    this.#paintColors();
  }

  resetView(): void {
    if (!this.#home) return;
    this.#camera.position.copy(this.#home.position);
    this.#controls.target.copy(this.#home.target);
  }

  /** Replaces the model. Keeps the camera unless the model's size changed a lot. */
  load(data: ViewerMesh): void {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(data.positions, 3));
    geo.setAttribute("color", new BufferAttribute(data.colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingBox();

    const hadModel = this.#mesh !== null;
    this.#removeModel();
    this.#defaultMask = data.defaultMask;
    const mesh = new Mesh(geo, this.#material);
    this.#mesh = mesh;
    this.#paintColors();
    const box = geo.boundingBox!;
    const c = box.getCenter(new Vector3());
    // Sit the model on the grid, centred in X/Y.
    const offset = new Vector3(-c.x, -c.y, -box.min.z);
    mesh.position.copy(offset);
    this.#scene.add(mesh);
    const edges = new LineSegments(new EdgesGeometry(geo, 35), this.#edgeMaterial);
    edges.position.copy(offset);
    edges.visible = this.#showEdges;
    this.#edges = edges;
    this.#scene.add(edges);

    const size = box.getSize(new Vector3());
    const radius = Math.max(size.length() / 2, 0.5);
    this.#rebuildGrid(Math.max(50, Math.ceil((Math.max(size.x, size.y) * 2) / 50) * 50));
    const axes = new AxesHelper(Math.max(size.x, size.y, size.z) * 0.6);
    axes.position.set(offset.x + box.min.x, offset.y + box.min.y, 0.01);
    axes.visible = this.#showGrid;
    this.#axes = axes;
    this.#scene.add(axes);

    const target = new Vector3(0, 0, size.z / 2);
    const d = (radius / Math.sin(MathUtils.degToRad(this.#camera.fov / 2))) * 1.3;
    const dir = new Vector3(0.62, -0.95, 0.65).normalize();
    this.#home = { position: target.clone().addScaledVector(dir, d), target };
    this.#camera.near = radius / 100;
    this.#camera.far = radius * 100;
    this.#camera.updateProjectionMatrix();
    // Keep the user's camera while iterating on similar-sized models; re-frame on big size changes.
    const ratio = this.#lastRadius ? radius / this.#lastRadius : 0;
    if (!hadModel || ratio > 1.6 || ratio < 0.6) this.resetView();
    this.#lastRadius = radius;
    this.#key.position.set(radius * 2, -radius * 3, radius * 4);
    this.#fill.position.set(-radius * 3, radius * 2, -radius);
  }

  dispose(): void {
    this.#renderer.setAnimationLoop(null);
    this.#removeModel();
    this.#grid?.dispose();
    this.#controls.dispose();
    this.#material.dispose();
    this.#edgeMaterial.dispose();
    this.#renderer.dispose();
  }

  #applyTheme(): void {
    const dark = this.#dark;
    this.#scene.background = new Color(dark ? 0x1a1a2e : 0xf0f0f0);
    this.#hemi.groundColor.set(dark ? 0x404060 : 0x909090);
    this.#edgeMaterial.color.set(dark ? 0x000000 : 0x222222);
    this.#rebuildGrid(this.#gridSize);
  }

  #rebuildGrid(size: number): void {
    if (this.#grid) {
      this.#scene.remove(this.#grid);
      this.#grid.dispose();
    }
    const dark = this.#dark;
    const grid = new GridHelper(size, Math.min(100, Math.round(size / 10)), dark ? 0x44446a : 0xbbbbcc, dark ? 0x2a2a48 : 0xdcdce6);
    grid.rotation.x = Math.PI / 2; // XY plane
    grid.visible = this.#showGrid;
    this.#grid = grid;
    this.#gridSize = size;
    this.#scene.add(grid);
  }

  #removeModel(): void {
    if (this.#mesh) {
      this.#scene.remove(this.#mesh);
      this.#mesh.geometry.dispose();
      this.#mesh = null;
    }
    if (this.#edges) {
      this.#scene.remove(this.#edges);
      this.#edges.geometry.dispose();
      this.#edges = null;
    }
    if (this.#axes) {
      this.#scene.remove(this.#axes);
      this.#axes.dispose();
      this.#axes = null;
    }
  }

  #paintColors(): void {
    const mask = this.#defaultMask;
    if (!this.#mesh || !mask) return;
    const col = this.#mesh.geometry.getAttribute("color") as BufferAttribute;
    const { r, g, b } = this.#modelColor;
    for (let t = 0; t < mask.length; t++) {
      if (!mask[t]) continue;
      for (let k = 0; k < 3; k++) col.setXYZ(t * 3 + k, r, g, b);
    }
    col.needsUpdate = true;
  }
}
