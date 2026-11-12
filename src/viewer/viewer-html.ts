/**
 * Self-contained viewer page. three.js is served locally by the viewer server
 * (no CDN, works offline). OpenSCAD is Z-up, so the scene is too.
 */

export function generateViewerHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenSCAD MCP — 3D Viewer</title>
<style>
  :root {
    --bg: #1a1a2e; --panel: #16162a; --border: #2a2a44; --text: #aaa; --muted: #666; --heading: #888;
    --accent: #4a9eff; --accent-bg: rgba(74,158,255,0.15); --accent-border: rgba(74,158,255,0.3);
    --btn-bg: rgba(255,255,255,0.08); --btn-border: rgba(255,255,255,0.15); --btn-hover: rgba(255,255,255,0.15);
  }
  body.light {
    --bg: #f0f0f0; --panel: #e8e8e8; --border: #d0d0d0; --text: #444; --muted: #888; --heading: #666;
    --accent: #2a7de1; --btn-bg: rgba(0,0,0,0.06); --btn-border: rgba(0,0,0,0.12); --btn-hover: rgba(0,0,0,0.12);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body { width: 100%; height: 100%; }
  body { background: var(--bg); color: var(--text); overflow: hidden; font-family: system-ui, sans-serif; display: flex; }
  #viewport { flex: 1; position: relative; min-width: 0; }
  canvas { display: block; }
  #sidebar { width: 250px; background: var(--panel); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; }
  .section { padding: 14px 16px; border-bottom: 1px solid var(--border); }
  .section h4 { color: var(--heading); font-size: 10px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
  #title { font-size: 13px; color: var(--text); font-weight: 600; word-break: break-word; }
  .history-item { padding: 6px 8px; border-radius: 4px; margin-bottom: 3px; font-size: 11px; cursor: pointer; color: var(--muted); display: flex; justify-content: space-between; gap: 8px; }
  .history-item:hover { background: var(--btn-bg); }
  .history-item.active { background: var(--accent-bg); color: var(--accent); }
  .history-item .ago { font-size: 10px; opacity: 0.7; white-space: nowrap; }
  .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
  .row .val { font-family: ui-monospace, monospace; }
  .btn, #controls button, .toggle { background: var(--btn-bg); border: 1px solid var(--btn-border); color: var(--text); border-radius: 5px; cursor: pointer; font-size: 11px; }
  .btn:hover, #controls button:hover, .toggle:hover { background: var(--btn-hover); }
  .export { display: block; width: 100%; padding: 8px; margin-top: 6px; background: var(--accent-bg); border: 1px solid var(--accent-border); color: var(--accent); border-radius: 6px; font-size: 12px; text-align: center; text-decoration: none; cursor: pointer; }
  .export:hover { filter: brightness(1.2); }
  select { width: 100%; margin-top: 6px; padding: 6px; background: var(--btn-bg); color: var(--text); border: 1px solid var(--btn-border); border-radius: 5px; font-size: 12px; }
  .toggle { padding: 3px 10px; }
  input[type="color"] { width: 28px; height: 22px; border: 1px solid var(--btn-border); border-radius: 4px; background: none; cursor: pointer; padding: 0; }
  #controls { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; }
  #controls button { padding: 5px 12px; }
  #controls button.on { color: var(--accent); border-color: var(--accent-border); }
  #status { position: absolute; top: 8px; right: 10px; font-size: 11px; color: #4aff9f; }
  #status.off { color: #ff4a4a; }
  #hint { position: absolute; top: 8px; left: 10px; color: var(--muted); font-size: 11px; pointer-events: none; }
  #empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 14px; }
</style>
<script type="importmap">
{ "imports": { "three": "/vendor/three/three.module.js", "three/addons/": "/vendor/three/addons/" } }
</script>
</head>
<body>
<div id="viewport">
  <div id="hint">Drag to rotate · Scroll to zoom · Right-drag to pan</div>
  <div id="status">● Connecting…</div>
  <div id="empty">Waiting for a model — render something from your AI assistant.</div>
  <div id="controls" hidden>
    <button data-action="reset">Reset view</button>
    <button data-action="edges" class="on">Edges</button>
    <button data-action="wireframe">Wireframe</button>
    <button data-action="rotate">Auto-rotate</button>
    <button data-action="grid" class="on">Grid</button>
  </div>
</div>
<div id="sidebar">
  <div class="section"><h4>Model</h4><div id="title">—</div></div>
  <div class="section">
    <h4>Dimensions</h4>
    <div class="row"><span>Width (X)</span><span class="val" id="dim-x">—</span></div>
    <div class="row"><span>Depth (Y)</span><span class="val" id="dim-y">—</span></div>
    <div class="row"><span>Height (Z)</span><span class="val" id="dim-z">—</span></div>
    <div class="row"><span>Volume</span><span class="val" id="dim-v">—</span></div>
    <div class="row"><span>Triangles</span><span class="val" id="dim-t">—</span></div>
  </div>
  <div class="section">
    <h4>History</h4>
    <div id="history" style="max-height:220px;overflow-y:auto;"><div class="row">No models yet</div></div>
  </div>
  <div class="section">
    <h4>Appearance</h4>
    <div class="row"><span>Theme</span><button class="toggle" id="theme">Light</button></div>
    <div class="row"><span>Model colour</span><input type="color" id="color" value="#ff8c00" title="Used for parts without color()"></div>
  </div>
  <div class="section" id="export-section" hidden>
    <h4>Export</h4>
    <a id="dl-stl" class="export">↓ Download STL</a>
    <a id="dl-3mf" class="export">↓ Download 3MF (with colours)</a>
    <select id="slicer">
      <option value="default">System default app</option>
      <option value="bambu">Bambu Studio</option>
      <option value="orca">OrcaSlicer</option>
      <option value="prusa">PrusaSlicer</option>
      <option value="cura">UltiMaker Cura</option>
      <option value="creality">Creality Print</option>
    </select>
    <button class="export" id="open-slicer">Open in slicer</button>
  </div>
</div>

<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1); // OpenSCAD is Z-up

const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotateSpeed = 1.5;

const hemi = new THREE.HemisphereLight(0xffffff, 0x404060, 1.2);
hemi.position.set(0, 0, 1);
scene.add(hemi);
const key = new THREE.DirectionalLight(0xffffff, 1.6);
scene.add(key);
const fill = new THREE.DirectionalLight(0x8899ff, 0.5);
scene.add(fill);

const SRGB_TO_LINEAR = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const material = new THREE.MeshPhongMaterial({
  vertexColors: true, flatShading: true, shininess: 40, specular: 0x222222, side: THREE.DoubleSide,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // keep edge lines on top
});
const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 });

let isDark = true, showEdges = true, showGrid = true;
let grid = null, axes = null, mesh = null, edges = null;
let current = null;          // { version, title, stats }
let defaultMask = null;      // Uint8Array per triangle: 1 = uses picker colour
let modelColor = new THREE.Color('#ff8c00');
let home = null;             // { position, target }
let lastRadius = 0;

function applyTheme() {
  document.body.classList.toggle('light', !isDark);
  $('theme').textContent = isDark ? 'Light' : 'Dark';
  scene.background = new THREE.Color(isDark ? 0x1a1a2e : 0xf0f0f0);
  hemi.groundColor.set(isDark ? 0x404060 : 0x909090);
  edgeMaterial.color.set(isDark ? 0x000000 : 0x222222);
  rebuildGrid();
}

function rebuildGrid(size) {
  if (grid) scene.remove(grid);
  const s = size ?? grid?.userData.size ?? 200;
  grid = new THREE.GridHelper(s, Math.min(100, Math.round(s / 10)), isDark ? 0x44446a : 0xbbbbcc, isDark ? 0x2a2a48 : 0xdcdce6);
  grid.rotation.x = Math.PI / 2; // XY plane
  grid.userData.size = s;
  grid.visible = showGrid;
  scene.add(grid);
}

function paintColors(geo) {
  if (!defaultMask) return;
  const col = geo.getAttribute('color');
  const r = modelColor.r, g = modelColor.g, b = modelColor.b;
  for (let t = 0; t < defaultMask.length; t++) {
    if (!defaultMask[t]) continue;
    for (let k = 0; k < 3; k++) col.setXYZ(t * 3 + k, r, g, b);
  }
  col.needsUpdate = true;
}

function loadMesh(buf, info) {
  const dv = new DataView(buf);
  if (String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)) !== 'S3DM') throw new Error('bad mesh');
  const n = dv.getUint32(8, true);
  const hasColors = dv.getUint32(12, true) & 1;
  const positions = new Float32Array(buf, 16, n * 9);
  const colors = new Float32Array(n * 9);
  defaultMask = new Uint8Array(n);
  const rgba = hasColors ? new Uint8Array(buf, 16 + n * 36, n * 4) : null;
  for (let t = 0; t < n; t++) {
    if (!rgba || rgba[t * 4 + 3] === 0) { defaultMask[t] = 1; continue; }
    const r = SRGB_TO_LINEAR[rgba[t * 4]], g = SRGB_TO_LINEAR[rgba[t * 4 + 1]], b = SRGB_TO_LINEAR[rgba[t * 4 + 2]];
    for (let k = 0; k < 3; k++) { colors[t * 9 + k * 3] = r; colors[t * 9 + k * 3 + 1] = g; colors[t * 9 + k * 3 + 2] = b; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  paintColors(geo);

  if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
  if (edges) { scene.remove(edges); edges.geometry.dispose(); }
  mesh = new THREE.Mesh(geo, material);
  const box = geo.boundingBox;
  const c = box.getCenter(new THREE.Vector3());
  // Sit the model on the grid, centred in X/Y.
  const offset = new THREE.Vector3(-c.x, -c.y, -box.min.z);
  mesh.position.copy(offset);
  scene.add(mesh);
  edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 35), edgeMaterial);
  edges.position.copy(offset);
  edges.visible = showEdges;
  scene.add(edges);

  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 0.5);
  rebuildGrid(Math.max(50, Math.ceil(Math.max(size.x, size.y) * 2 / 50) * 50));
  if (axes) scene.remove(axes);
  axes = new THREE.AxesHelper(Math.max(size.x, size.y, size.z) * 0.6);
  axes.position.set(offset.x + box.min.x, offset.y + box.min.y, 0.01);
  scene.add(axes);

  const target = new THREE.Vector3(0, 0, size.z / 2);
  const d = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.3;
  const dir = new THREE.Vector3(0.62, -0.95, 0.65).normalize();
  home = { position: target.clone().addScaledVector(dir, d), target };
  camera.near = radius / 100; camera.far = radius * 100; camera.updateProjectionMatrix();
  // Keep the user's camera while iterating on similar-sized models; re-frame on big size changes.
  const ratio = lastRadius ? radius / lastRadius : 0;
  if (!current || ratio > 1.6 || ratio < 0.6) { camera.position.copy(home.position); controls.target.copy(home.target); }
  lastRadius = radius;
  key.position.set(radius * 2, -radius * 3, radius * 4);
  fill.position.set(-radius * 3, radius * 2, -radius);

  current = info;
  $('empty').hidden = true;
  $('controls').hidden = false;
  $('export-section').hidden = false;
  $('title').textContent = info.title + (info.is2D ? ' (2D, shown 1 mm thick)' : '');
  const s = info.stats;
  const mm = (v) => (Math.round(v * 100) / 100) + ' mm';
  $('dim-x').textContent = mm(s.size[0]);
  $('dim-y').textContent = mm(s.size[1]);
  $('dim-z').textContent = info.is2D ? '—' : mm(s.size[2]);
  $('dim-v').textContent = info.is2D ? (s.volume / 100).toFixed(2) + ' cm²' : (s.volume / 1000).toFixed(2) + ' cm³';
  $('dim-t').textContent = s.triangles.toLocaleString();
  $('dl-stl').href = '/model/' + info.version + '.stl';
  $('dl-3mf').href = '/model/' + info.version + '.3mf';
  renderHistory();
}

let history = [];
function renderHistory() {
  const list = $('history');
  list.textContent = '';
  if (history.length === 0) { const d = document.createElement('div'); d.className = 'row'; d.textContent = 'No models yet'; list.appendChild(d); return; }
  for (const h of history.slice().reverse()) {
    const div = document.createElement('div');
    div.className = 'history-item' + (current && h.version === current.version ? ' active' : '');
    const name = document.createElement('span'); name.textContent = 'v' + h.version + ' · ' + h.title;
    const ago = document.createElement('span'); ago.className = 'ago'; ago.textContent = timeAgo(h.timestamp);
    div.append(name, ago);
    div.onclick = () => ws && ws.readyState === 1 && ws.send(JSON.stringify({ type: 'request-model', version: h.version }));
    list.appendChild(div);
  }
}
function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago';
}
setInterval(renderHistory, 20000);

let ws = null;
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  const status = $('status');
  ws.onopen = () => { status.textContent = '● Connected'; status.className = ''; };
  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'model-history') { history = msg.versions; renderHistory(); }
    else if (msg.type === 'model-update') {
      if (!history.find((h) => h.version === msg.version)) history.push({ version: msg.version, title: msg.title, timestamp: msg.timestamp });
      else history = history.map((h) => h.version === msg.version ? { ...h, title: msg.title } : h);
      const res = await fetch('/mesh/' + msg.version);
      if (res.ok) loadMesh(await res.arrayBuffer(), msg);
    }
  };
  ws.onclose = () => { status.textContent = '● Disconnected — retrying'; status.className = 'off'; setTimeout(connect, 2000); };
  ws.onerror = () => ws.close();
}
connect();

$('controls').addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  const a = btn.dataset.action;
  if (a === 'reset' && home) { camera.position.copy(home.position); controls.target.copy(home.target); }
  if (a === 'edges') { showEdges = !showEdges; if (edges) edges.visible = showEdges; btn.classList.toggle('on', showEdges); }
  if (a === 'wireframe') { material.wireframe = !material.wireframe; btn.classList.toggle('on', material.wireframe); }
  if (a === 'rotate') { controls.autoRotate = !controls.autoRotate; btn.classList.toggle('on', controls.autoRotate); }
  if (a === 'grid') { showGrid = !showGrid; grid.visible = showGrid; if (axes) axes.visible = showGrid; btn.classList.toggle('on', showGrid); }
});
$('theme').onclick = () => { isDark = !isDark; applyTheme(); };
$('color').oninput = (e) => { modelColor = new THREE.Color(e.target.value); if (mesh) paintColors(mesh.geometry); };
$('open-slicer').onclick = async () => {
  if (!current) return;
  const btn = $('open-slicer');
  btn.textContent = 'Opening…';
  try {
    const res = await fetch('/open-in-slicer/' + current.version + '?slicer=' + encodeURIComponent($('slicer').value), { method: 'POST' });
    btn.textContent = res.ok ? '✓ Opened' : 'Failed — is the slicer installed?';
  } catch { btn.textContent = 'Failed'; }
  setTimeout(() => { btn.textContent = 'Open in slicer'; }, 3000);
};

function onResize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h);
}
new ResizeObserver(onResize).observe(viewport);
applyTheme();
onResize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
</script>
</body>
</html>`;
}
