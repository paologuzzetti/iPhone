import * as THREE from 'three';
import { generate, levelParams, blocker, DIFFICULTIES, SHAPES, vec } from './logic.js';

// ---------------------------------------------------------------- stato
const STORE_KEY = 'frecce3d.v1';
const save = (() => {
  let s = { diff: 'normale', levels: { facile: 1, normale: 1, difficile: 1 }, sound: true };
  try { Object.assign(s, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { /* vuoto */ }
  return s;
})();
const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) { /* vuoto */ } };

const MAX_HEARTS = 3;
const HINTS_PER_LEVEL = 3;
const COLORS = ['#ff6b5b', '#2bb39a', '#ffb627', '#7c6cf2', '#3a8dde', '#e45fa8', '#5cc35a', '#ff8f3d', '#21a0b8', '#b55de0'];

let game = null; // { board, arrows, occ, items, remaining, hearts, hints, playing }

// ---------------------------------------------------------------- three.js
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-3, 5, 6);
camera.add(sun);
scene.add(camera);

const pivot = new THREE.Group(); // ruota con le dita
scene.add(pivot);
let content = null; // figlio di pivot, contiene solido + frecce, spostato di -dims/2
let boxMesh = null;
const DEFAULT_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, -0.65, 0, 'XYZ'));
let baseDist = 12, zoom = 1, zoomMin = 0.3;
let panGoal = null; // spostamento automatico della vista
const ZOOM_MAX = 1.6;
let targetQ = null; // rotazione automatica (suggerimento / riallinea)

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  fitCamera();
}
function fitCamera() {
  if (!game) return;
  const [X, Y, Z] = game.board.dims;
  const radius = 0.5 * Math.hypot(X, Y, Z);
  const vf = THREE.MathUtils.degToRad(camera.fov);
  const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  baseDist = (radius / Math.sin(Math.min(vf, hf) / 2)) * 1.08;
  // da vicino la faccia più grande riempie lo schermo: le frecce si toccano facilmente
  zoomMin = Math.min(0.6, (radius + 2) / baseDist);
}
window.addEventListener('resize', resize);

// ---------------------------------------------------------------- texture casella
// Una sola mattonella ripetuta su ogni casella della superficie.
function tileTexture() {
  const px = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const g = cv.getContext('2d');
  g.fillStyle = '#efe6d6';
  g.fillRect(0, 0, px, px);
  g.strokeStyle = 'rgba(70, 90, 95, 0.13)';
  g.lineWidth = 3;
  g.strokeRect(0, 0, px, px);
  g.fillStyle = 'rgba(70, 90, 95, 0.22)';
  g.beginPath(); g.arc(px / 2, px / 2, 7, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
let TILE = null;

// Superficie del solido: un quadrato per ogni casella.
function buildSurface(board) {
  const pos = [], nor = [], uv = [], idx = [];
  for (const cell of board.cells) {
    const a = vec.axisOf(cell.n);
    const u = [0, 0, 0]; u[(a + 1) % 3] = 0.5;
    const n = cell.n;
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const base = pos.length / 3;
    for (const [su, sv, tu, tv] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) {
      pos.push(cell.c[0] + u[0] * su + v[0] * sv, cell.c[1] + u[1] * su + v[1] * sv, cell.c[2] + u[2] * su + v[2] * sv);
      nor.push(n[0], n[1], n[2]);
      uv.push(tu, tv);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// ---------------------------------------------------------------- geometria frecce
const W = 0.26;     // larghezza del corpo
const LIFT = 0.012; // distacco dalla superficie

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const sameN = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// Percorso completo: corpo della freccia + strada fino al bordo + uscita nel vuoto.
function buildTrack(board, arrow) {
  const segs = [];
  const cs = arrow.cells.map((id) => board.cells[id]);
  const push = (a, b, n, edgeA = false, edgeB = false) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    segs.push({ a: V(a), b: V(b), n: V(n), len, edgeA, edgeB });
  };
  const H = cs[cs.length - 1];
  const rp = board.rayPath(H.id, arrow.dir);
  const path = cs.concat(rp.cells.map((id) => board.cells[id]));
  for (let i = 0; i < path.length - 1; i++) {
    const A = path[i], B = path[i + 1];
    if (sameN(A.n, B.n)) push(A.c, B.c, A.n);
    else {
      // spigolo (sporgente o rientrante): il punto d'incontro è sullo spigolo
      const d = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]];
      d[vec.axisOf(A.n)] = 0;
      const e = vec.add(A.c, d);
      push(A.c, e, A.n, false, true);
      push(e, B.c, B.n, true, false);
    }
  }
  const L = path[path.length - 1];
  const edgeP = vec.add(L.c, vec.scale(rp.dir, 0.5));
  push(L.c, edgeP, L.n);
  const bodyLen = cs.length - 1;
  push(edgeP, vec.add(edgeP, vec.scale(rp.dir, bodyLen + 6)), L.n);
  let s = 0;
  for (const sg of segs) { sg.s0 = s; s += sg.len; }
  return { segs, bodyLen, exitDist: rp.cells.length + 0.5 };
}

const _d = new THREE.Vector3(), _side = new THREE.Vector3(), _lift = new THREE.Vector3();
function buildArrowGeometry(track, s) {
  const s1 = s, s2 = s + track.bodyLen;
  const pos = [];
  let head = null;
  const quad = (p1, p2, p3, p4) => pos.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z,
    p1.x, p1.y, p1.z, p3.x, p3.y, p3.z, p4.x, p4.y, p4.z);
  for (const sg of track.segs) {
    const a0 = Math.max(s1, sg.s0), b0 = Math.min(s2, sg.s0 + sg.len);
    if (b0 < a0 - 1e-9) continue;
    _d.subVectors(sg.b, sg.a).normalize();
    const pa = sg.a.clone().addScaledVector(_d, a0 - sg.s0);
    const pb = sg.a.clone().addScaledVector(_d, b0 - sg.s0);
    const capA = a0 > sg.s0 + 1e-6 ? true : !sg.edgeA;
    const capB = b0 < sg.s0 + sg.len - 1e-6 ? true : !sg.edgeB;
    _side.crossVectors(_d, sg.n).multiplyScalar(W / 2);
    _lift.copy(sg.n).multiplyScalar(LIFT);
    const A = pa.clone().addScaledVector(_d, capA ? -W / 2 : 0).add(_lift);
    const B = pb.clone().addScaledVector(_d, capB ? W / 2 : 0).add(_lift);
    quad(A.clone().sub(_side), A.clone().add(_side), B.clone().add(_side), B.clone().sub(_side));
    head = { p: pb, d: _d.clone(), n: sg.n };
  }
  if (head) {
    const { p, d, n } = head;
    const side = new THREE.Vector3().crossVectors(d, n).multiplyScalar(0.3);
    const l = n.clone().multiplyScalar(LIFT * 1.6);
    const tip = p.clone().addScaledVector(d, 0.4).add(l);
    const base = p.clone().addScaledVector(d, -0.1).add(l);
    const b1 = base.clone().add(side), b2 = base.clone().sub(side);
    pos.push(tip.x, tip.y, tip.z, b1.x, b1.y, b1.z, b2.x, b2.y, b2.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- livello
// I livelli grandi richiedono un attimo: si mostra "Costruisco il livello…"
// e l'ultimo livello generato resta in memoria (ricomincia = istantaneo).
let genCache = { key: null, data: null };
let loadToken = 0;
function loadLevel(z = 1) {
  const level = save.levels[save.diff];
  const key = `${save.diff}:${level}`;
  const token = ++loadToken;
  if (genCache.key === key) { buildLevel(level, genCache.data, z); return; }
  $('loading').classList.add('show');
  setTimeout(() => {
    const p = levelParams(level, save.diff);
    const data = { p, ...generate(p) };
    genCache = { key, data };
    if (token === loadToken) buildLevel(level, data, z);
    $('loading').classList.remove('show');
  }, 50);
}

function buildLevel(level, { p, board, arrows }, z) {
  const occ = new Int32Array(board.cells.length).fill(-1);
  arrows.forEach((a) => a.cells.forEach((c) => (occ[c] = a.id)));

  if (content) {
    pivot.remove(content);
    content.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
  }
  content = new THREE.Group();
  const [X, Y, Z] = board.dims;
  content.position.set(-X / 2, -Y / 2, -Z / 2);
  pivot.add(content);

  TILE = TILE || tileTexture();
  const surf = buildSurface(board);
  boxMesh = new THREE.Mesh(surf, new THREE.MeshLambertMaterial({ map: TILE }));
  content.add(boxMesh);
  // spigoli del solido in evidenza
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(surf, 30),
    new THREE.LineBasicMaterial({ color: 0x3a4b4f, transparent: true, opacity: 0.45 }));
  content.add(edges);

  const r = Math.random;
  const items = arrows.map((a, i) => {
    const track = buildTrack(board, a);
    const color = new THREE.Color(COLORS[(i * 7 + Math.floor(r() * 3)) % COLORS.length]);
    const mat = new THREE.MeshLambertMaterial({
      color, side: THREE.DoubleSide, transparent: true, emissive: new THREE.Color(0x000000),
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(buildArrowGeometry(track, 0), mat);
    content.add(mesh);
    return { a, track, mesh, mat, base: color.clone(), s: 0, state: 'idle', anim: null, flash: 0, hint: false };
  });

  game = { level, shapeName: SHAPES[p.shapeKey].label, board, arrows, occ, items, remaining: arrows.length, hearts: MAX_HEARTS, hints: HINTS_PER_LEVEL, playing: true, moving: 0 };
  pivot.quaternion.copy(DEFAULT_Q);
  zoom = z; targetQ = null; panGoal = null;
  camera.position.x = 0; camera.position.y = 0;
  fitCamera();
  camera.position.z = baseDist * zoom;
  updateHud();
}

// ---------------------------------------------------------------- input
const pointers = new Map();
let drag = null;
let velocity = { x: 0, y: 0 };
const qTmp = new THREE.Quaternion();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);

function rotateBy(dx, dy) {
  // più lenta quando si è vicini, per una rotazione precisa
  const k = 0.0085 * THREE.MathUtils.clamp(camera.position.z / baseDist, 0.3, 1);
  qTmp.setFromAxisAngle(AY, dx * k); pivot.quaternion.premultiply(qTmp);
  qTmp.setFromAxisAngle(AX, dy * k); pivot.quaternion.premultiply(qTmp);
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  targetQ = null;
  velocity = { x: 0, y: 0 };
  if (pointers.size === 1) drag = { x0: e.clientX, y0: e.clientY, moved: false, t: performance.now() };
  else if (pointers.size === 2) {
    const m = midpoint();
    drag = { pinch: pinchDist(), zoom0: camera.position.z / baseDist, mx: m.x, my: m.y, moved: true };
    panGoal = null;
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || !drag) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size >= 2 && drag.pinch) {
    // zoom verso il punto tra le due dita + spostamento della vista
    const m = midpoint();
    zoomAt(m.x, m.y, drag.zoom0 * (drag.pinch / pinchDist()));
    panBy(m.x - drag.mx, m.y - drag.my);
    drag.mx = m.x; drag.my = m.y;
    return;
  }
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 7) drag.moved = true;
  if (drag.moved) {
    rotateBy(dx, dy);
    velocity = { x: dx, y: dy };
  }
});
const endPointer = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (drag && !drag.moved && pointers.size === 0 && e.type === 'pointerup') tap(e.clientX, e.clientY);
  if (pointers.size === 0) drag = null;
  else if (pointers.size === 1) { const [q] = pointers.values(); drag = { x0: q.x, y0: q.y, moved: true }; velocity = { x: 0, y: 0 }; }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  panGoal = null;
  zoomAt(e.clientX, e.clientY, (camera.position.z / baseDist) * Math.exp(e.deltaY * 0.0015));
}, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

function midpoint() {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
// Profondità indicativa della superficie verso la telecamera.
const surfaceDepth = () => (game ? Math.min(...game.board.dims) / 2 : 0);
function zoomAt(px, py, z) {
  zoom = THREE.MathUtils.clamp(z, zoomMin, ZOOM_MAX);
  const oldD = camera.position.z, newD = baseDist * zoom;
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const nx = (px / window.innerWidth) * 2 - 1, ny = -(py / window.innerHeight) * 2 + 1;
  camera.position.x += nx * t * camera.aspect * (oldD - newD);
  camera.position.y += ny * t * (oldD - newD);
  camera.position.z = newD;
  clampPan();
}
function panBy(dx, dy) {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const k = (Math.max(0.5, camera.position.z - surfaceDepth()) * t) / (window.innerHeight / 2);
  camera.position.x -= dx * k;
  camera.position.y += dy * k;
  clampPan();
}
function clampPan() {
  if (!game) return;
  const r = 0.5 * Math.hypot(...game.board.dims);
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -r, r);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, -r, r);
}
function pinchDist() {
  const [a, b] = [...pointers.values()];
  return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
}

const raycaster = new THREE.Raycaster();
function tap(x, y) {
  if (!game || !game.playing || isHome()) return;
  const cell = pickCell(x, y);
  if (cell < 0) return;
  const id = game.occ[cell];
  if (id < 0) return;
  activate(game.items[id]);
}
// Casella della superficie sotto il punto (x, y) dello schermo, o -1.
function pickCell(x, y) {
  const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(boxMesh, false)[0];
  if (!hit) return -1;
  const p = content.worldToLocal(hit.point.clone());
  const n = hit.face.normal.toArray().map(Math.round);
  const c = [0, 1, 2].map((k) => n[k] !== 0 ? Math.round(p.getComponent(k)) : Math.floor(p.getComponent(k)) + 0.5);
  return game.board.cellAt(c, n);
}

// ---------------------------------------------------------------- regole
function activate(it) {
  if (it.state !== 'idle') return;
  unlockAudio();
  clearHint();
  const b = blocker(game.board, game.occ, it.a);
  if (!b) {
    it.a.cells.forEach((c) => (game.occ[c] = -1));
    it.state = 'leaving';
    it.anim = { v: 7 };
    game.remaining--;
    game.moving++;
    sfx('ok');
    updateHud();
  } else {
    it.state = 'bumping';
    it.anim = { t: 0, reach: b.dist + 0.3 };
    game.moving++;
    const other = game.items[b.arrow];
    other.flash = 1;
    it.flash = 1;
    game.hearts--;
    sfx('bad');
    buzz();
    updateHud(true);
    if (game.hearts <= 0) {
      game.playing = false;
      setTimeout(() => showModal('Vite finite', 'Le frecce si sono scontrate troppe volte.\nRiprova il livello!', [
        { label: 'Riprova', cls: 'primary', fn: () => { hideModal(); loadLevel(); } },
        { label: 'Menu', cls: 'ghost', fn: () => { hideModal(); goHome(); } },
      ], true), 700);
    }
  }
}

function checkWin() {
  if (game.remaining === 0 && game.moving === 0 && game.playing) {
    game.playing = false;
    sfx('win');
    const lost = MAX_HEARTS - game.hearts;
    const stars = '★'.repeat(3 - lost) + '☆'.repeat(lost);
    const lv = game.level;
    save.levels[save.diff] = lv + 1;
    persist();
    setTimeout(() => showModal(`Livello ${lv} completato!`, `${stars}\n${game.arrows.length} frecce liberate`, [
      { label: 'Livello successivo', cls: 'primary', fn: () => { hideModal(); loadLevel(); } },
      { label: 'Menu', cls: 'ghost', fn: () => { hideModal(); goHome(); } },
    ], true), 350);
  }
}

// ---------------------------------------------------------------- suggerimento
function useHint() {
  if (!game || !game.playing || game.hints <= 0) return;
  const free = game.items.filter((it) => it.state === 'idle' && !blocker(game.board, game.occ, it.a));
  if (!free.length) return;
  // preferisce una freccia già visibile verso la telecamera
  const camDir = new THREE.Vector3(0, 0, 1);
  const score = (it) => {
    const head = game.board.cells[it.a.cells[it.a.cells.length - 1]];
    return V(head.n).applyQuaternion(pivot.quaternion).dot(camDir);
  };
  free.sort((x, y) => score(y) - score(x));
  const it = free[0];
  clearHint();
  it.hint = true;
  game.hints--;
  updateHud();
  // ruota il solido per mostrare la faccia con la punta
  const head = game.board.cells[it.a.cells[it.a.cells.length - 1]];
  const nWorld = V(head.n).applyQuaternion(pivot.quaternion).normalize();
  const want = new THREE.Vector3(0.15, 0.35, 1).normalize();
  zoom = 1; panGoal = { x: 0, y: 0 };
  if (nWorld.dot(want) < 0.8) {
    targetQ = new THREE.Quaternion().setFromUnitVectors(nWorld, want).multiply(pivot.quaternion);
  }
}
function clearHint() { game?.items.forEach((it) => (it.hint = false)); }

// ---------------------------------------------------------------- loop
let last = performance.now();
const RED = new THREE.Color('#ff2d3d');
const WHITE = new THREE.Color('#ffffff');
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  // inerzia e rotazioni automatiche
  if (!drag) {
    if (targetQ) {
      pivot.quaternion.slerp(targetQ, 1 - Math.pow(0.002, dt));
      if (pivot.quaternion.angleTo(targetQ) < 0.002) targetQ = null;
    } else if (Math.abs(velocity.x) + Math.abs(velocity.y) > 0.05) {
      rotateBy(velocity.x, velocity.y);
      const f = Math.pow(0.02, dt);
      velocity.x *= f; velocity.y *= f;
    } else if (isHome()) {
      qTmp.setFromAxisAngle(AY, dt * 0.35); pivot.quaternion.premultiply(qTmp);
    }
  }
  const dist = baseDist * zoom;
  const yOff = isHome() ? -baseDist * 0.16 : 0;
  pivot.position.y += (-yOff - pivot.position.y) * (1 - Math.pow(0.001, dt));
  if (pointers.size < 2) camera.position.z += (dist - camera.position.z) * (1 - Math.pow(0.0005, dt));
  if (panGoal) {
    const f = 1 - Math.pow(0.0005, dt);
    camera.position.x += (panGoal.x - camera.position.x) * f;
    camera.position.y += (panGoal.y - camera.position.y) * f;
  }

  if (game) {
    for (const it of game.items) {
      if (it.state === 'leaving') {
        it.anim.v = Math.min(38, it.anim.v + 60 * dt);
        it.s += it.anim.v * dt;
        const t = it.track;
        const fade = (it.s - t.exitDist) / (t.bodyLen + 2.5);
        it.mat.opacity = 1 - THREE.MathUtils.clamp(fade, 0, 1);
        rebuild(it);
        if (fade >= 1) {
          it.state = 'gone';
          it.mesh.visible = false;
          game.moving--;
          checkWin();
        }
      } else if (it.state === 'bumping') {
        const a = it.anim;
        a.t += dt;
        const go = Math.max(0.12, a.reach / 14);
        const ret = 0.28;
        if (a.t < go) { const u = a.t / go; it.s = a.reach * u * u; }
        else if (a.t < go + ret) { const u = (a.t - go) / ret; it.s = a.reach * (1 - (1 - (1 - u) * (1 - u))); }
        else { it.s = 0; it.state = 'idle'; it.anim = null; game.moving--; }
        rebuild(it);
      }
      // colore: lampeggio rosso / pulsazione suggerimento
      if (it.flash > 0) it.flash = Math.max(0, it.flash - dt * 1.6);
      if (it.state !== 'gone') {
        it.mat.color.copy(it.base).lerp(RED, Math.min(1, it.flash * 1.4));
        if (it.hint) {
          const k = 0.5 + 0.5 * Math.sin(now / 160);
          it.mat.emissive.copy(WHITE).multiplyScalar(0.55 * k);
        } else it.mat.emissive.setRGB(0, 0, 0);
      }
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function rebuild(it) {
  it.mesh.geometry.dispose();
  it.mesh.geometry = buildArrowGeometry(it.track, it.s);
}

// ---------------------------------------------------------------- audio
let actx = null;
function unlockAudio() {
  if (actx || !save.sound) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
}
function tone(freq, start, dur, type = 'sine', vol = 0.18, slide = 0) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, actx.currentTime + start);
  if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, actx.currentTime + start + dur);
  g.gain.setValueAtTime(0.0001, actx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, actx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + start + dur);
  o.connect(g).connect(actx.destination);
  o.start(actx.currentTime + start); o.stop(actx.currentTime + start + dur + 0.02);
}
function sfx(kind) {
  if (!save.sound) return;
  unlockAudio();
  if (!actx) return;
  if (actx.state === 'suspended') actx.resume();
  if (kind === 'ok') tone(520 + Math.random() * 80, 0, 0.16, 'triangle', 0.16, 1.9);
  else if (kind === 'bad') { tone(150, 0, 0.22, 'sawtooth', 0.12, 0.6); }
  else if (kind === 'win') [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.11, 0.3, 'triangle', 0.15));
}
function buzz() { try { navigator.vibrate?.(60); } catch (e) { /* vuoto */ } }

// ---------------------------------------------------------------- UI
const $ = (id) => document.getElementById(id);
const HEART = '<svg viewBox="0 0 24 24" class="heart"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.6 1.2 5.2 3 1.6-1.8 3.1-3 5.2-3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>';

function updateHud(lostHeart = false) {
  if (!game) return;
  $('level-name').textContent = `Livello ${game.level}`;
  $('shape-name').textContent = game.shapeName;
  $('remaining').textContent = game.remaining;
  $('diff-label').textContent = DIFFICULTIES[save.diff].label;
  const hearts = $('hearts');
  hearts.innerHTML = HEART.repeat(MAX_HEARTS);
  [...hearts.children].forEach((h, i) => {
    if (i >= game.hearts) h.classList.add('lost');
    if (lostHeart && i === game.hearts) h.classList.add('pop');
  });
  $('hint-count').textContent = game.hints;
  $('hint').disabled = game.hints <= 0;
}

function showModal(title, text, actions, center = false) {
  $('modal-title').textContent = title;
  const p = $('modal-text');
  p.textContent = text;
  p.classList.toggle('center', center);
  const box = $('modal-actions');
  box.innerHTML = '';
  for (const a of actions) {
    if (a.node) { box.appendChild(a.node); continue; }
    const b = document.createElement('button');
    b.className = `btn ${a.cls || ''}`;
    b.textContent = a.label;
    b.onclick = a.fn;
    box.appendChild(b);
  }
  $('modal').classList.remove('hidden');
}
function hideModal() { $('modal').classList.add('hidden'); }

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

const isHome = () => !$('home').classList.contains('hidden');
function goHome() {
  $('hud').classList.add('hidden');
  $('home').classList.remove('hidden');
  refreshHome();
  loadLevel(1.25);
}
function startGame() {
  unlockAudio();
  $('home').classList.add('hidden');
  $('hud').classList.remove('hidden');
  loadLevel();
}
function refreshHome() {
  document.querySelectorAll('.diff-picker button').forEach((b) => b.classList.toggle('on', b.dataset.diff === save.diff));
  $('play').textContent = `Gioca · Livello ${save.levels[save.diff]}`;
}

document.querySelectorAll('.diff-picker button').forEach((b) => b.addEventListener('click', () => {
  save.diff = b.dataset.diff; persist(); refreshHome(); loadLevel(1.25);
}));
$('play').onclick = startGame;
$('back').onclick = goHome;
$('hint').onclick = useHint;
$('recenter').onclick = () => { targetQ = DEFAULT_Q.clone(); zoom = 1; panGoal = { x: 0, y: 0 }; };
$('restart').onclick = () => { loadLevel(); toast('Livello ricominciato'); };

const HOWTO = 'Ogni freccia scorre solo nel verso in cui punta.\n\n' +
  '• Trascina con un dito per ruotare il solido.\n' +
  '• Pizzica con due dita per ingrandire e trascina con due dita per spostare la vista.\n' +
  '• Tocca una freccia: scorre sulla superficie (salendo anche sulle pareti interne) e vola via dal primo spigolo sporgente, se la strada è libera.\n' +
  '• Se incontra un\'altra freccia si scontra e perdi una vita.\n' +
  '• Le frecce possono piegarsi e girare attorno agli spigoli.\n' +
  '• Libera tutte le frecce per completare il livello. Ogni livello ha sempre una soluzione.\n' +
  '• Andando avanti i solidi cambiano forma e i livelli diventano più difficili.';
$('howto-btn').onclick = () => showModal('Come si gioca', HOWTO, [{ label: 'Ho capito', cls: 'primary', fn: hideModal }]);

$('settings-btn').onclick = () => {
  const row = document.createElement('div');
  row.className = 'row';
  row.innerHTML = '<span>Suoni</span>';
  const sw = document.createElement('button');
  sw.className = `switch ${save.sound ? 'on' : ''}`;
  sw.setAttribute('aria-label', 'Suoni');
  sw.onclick = () => { save.sound = !save.sound; persist(); sw.classList.toggle('on', save.sound); if (save.sound) unlockAudio(); };
  row.appendChild(sw);
  showModal('Impostazioni', '', [
    { node: row },
    { label: 'Come si gioca', fn: () => showModal('Come si gioca', HOWTO, [{ label: 'Chiudi', cls: 'primary', fn: hideModal }]) },
    { label: 'Azzera progressi', cls: 'ghost', fn: () => {
      save.levels = { facile: 1, normale: 1, difficile: 1 }; persist(); hideModal(); loadLevel(); toast('Progressi azzerati');
    } },
    { label: 'Chiudi', cls: 'primary', fn: hideModal },
  ]);
};

// accesso per test automatici
window.__frecce = { get game() { return game; }, camera, get content() { return content; }, tapCell(id) { activate(game.items[game.occ[id]]); }, pickCell };

// ---------------------------------------------------------------- avvio
resize();
goHome();
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
