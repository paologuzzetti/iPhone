// Logica del puzzle: griglia sulla superficie di un solido fatto di blocchi
// (cubo, L, scala, croce, anello...), generazione dei livelli (sempre
// risolvibili) e regole di movimento.

export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const neg = (a) => [-a[0], -a[1], -a[2]];
const axisOf = (v) => (v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2);
export const vec = { add, scale, neg, axisOf };

// ---------------------------------------------------------------- solidi
// Un solido è un insieme di cubetti unitari dentro un riquadro dims.
export class Shape {
  constructor(dims, fn) {
    this.dims = dims;
    const [X, Y, Z] = dims;
    this.vox = new Uint8Array(X * Y * Z);
    for (let x = 0; x < X; x++) for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) {
      if (fn(x, y, z)) this.vox[(x * Y + y) * Z + z] = 1;
    }
  }
  has(x, y, z) {
    const [X, Y, Z] = this.dims;
    if (x < 0 || y < 0 || z < 0 || x >= X || y >= Y || z >= Z) return false;
    return this.vox[(x * Y + y) * Z + z] === 1;
  }
}

// Forme disponibili. s = lato indicativo, r = generatore casuale.
export const SHAPES = {
  cubo: { label: 'Cubo', make(s, r) {
    const d = [s + rnd(r, -2, 2), s + rnd(r, -2, 2), s + rnd(r, -2, 2)].map((v) => Math.max(3, v));
    return new Shape(d, () => true);
  } },
  lastra: { label: 'Lastra', make(s, r) {
    const t = Math.max(3, Math.round(s / 2.2));
    return new Shape([s + rnd(r, 1, 3), t, s + rnd(r, 2, 5)], () => true);
  } },
  L: { label: 'Elle', make(s, r) {
    const q = thick(s), D = depth(s, r);
    return extrude(s, s + rnd(r, 0, 2), D, (x, y) => x < q || y < q);
  } },
  scala: { label: 'Scala', make(s, r) {
    const steps = s >= 9 ? 4 : 3;
    const W = steps * Math.max(2, Math.round(s / steps)), H = W;
    const sw = W / steps, sh = H / steps;
    return extrude(W, H, depth(s, r), (x, y) => y < (steps - Math.floor(x / sw)) * sh);
  } },
  T: { label: 'Ti', make(s, r) {
    s = Math.max(s, 6);
    const q = thick(s), W = s + 1 - ((s + 1 - q) % 2), D = depth(s, r);
    const m = (W - q) / 2;
    return extrude(W, s, D, (x, y) => y >= s - q || (x >= m && x < m + q));
  } },
  U: { label: 'U', make(s, r) {
    s = Math.max(s, 6);
    const q = thick(s);
    return extrude(s + 1, s, depth(s, r), (x, y) => x < q || x >= s + 1 - q || y < q);
  } },
  croce: { label: 'Croce', make(s, r) {
    s = Math.max(s, 7);
    const q = thick(s) + 1, W = s + ((s - q) % 2), m = (W - q) / 2;
    return extrude(W, W, depth(s, r), (x, y) => (x >= m && x < m + q) || (y >= m && y < m + q));
  } },
  anello: { label: 'Anello', make(s, r) {
    s = Math.max(s, 7);
    const q = thick(s);
    return extrude(s + 1, s, Math.max(3, depth(s, r) - 1),
      (x, y) => !(x >= q && x < s + 1 - q && y >= q && y < s - q));
  } },
  H: { label: 'Acca', make(s, r) {
    s = Math.max(s, 7);
    const q = thick(s), H = s + ((s - q) % 2), m = (H - q) / 2;
    return extrude(s, H, depth(s, r), (x, y) => x < q || x >= s - q || (y >= m && y < m + q));
  } },
  ziggurat: { label: 'Ziggurat', make(s) {
    s = Math.max(s, 7);
    const lv = 3, st = Math.max(1, Math.floor((s - 3) / (2 * lv))), h = Math.max(2, Math.round(s / 4));
    return new Shape([s, lv * h, s], (x, y, z) => {
      const m = Math.floor(y / h) * st;
      return x >= m && x < s - m && z >= m && z < s - m;
    });
  } },
  croce3d: { label: 'Croce 3D', make(s) {
    s = Math.max(s, 7);
    const q = thick(s) + 1, W = s + ((s - q) % 2), m = (W - q) / 2;
    const inn = (v) => v >= m && v < m + q;
    return new Shape([W, W, W], (x, y, z) =>
      (inn(x) && inn(y)) || (inn(y) && inn(z)) || (inn(x) && inn(z)));
  } },
  tacche: { label: 'Cubo intagliato', make(s, r) {
    s = Math.max(s, 6);
    const c = Math.max(2, Math.round(s / 3));
    const corner = (v) => v < c || v >= s - c;
    const pick = Math.floor(r() * 3);
    return new Shape([s, s, s], (x, y, z) => {
      const k = (corner(x) ? 1 : 0) + (corner(y) ? 1 : 0) + (corner(z) ? 1 : 0);
      return pick === 0 ? k < 3 : pick === 1 ? k < 2 : !(corner(x) && corner(z));
    });
  } },
};
const SHAPE_CYCLE = ['cubo', 'L', 'scala', 'lastra', 'T', 'U', 'ziggurat', 'croce', 'tacche', 'anello', 'H', 'croce3d'];

function rnd(r, a, b) { return a + Math.floor(r() * (b - a + 1)); }
function thick(s) { return Math.max(2, Math.round(s / 3.5)); }
function depth(s, r) { return Math.max(3, Math.round(s * (0.6 + r() * 0.35))); }
function extrude(W, H, D, fn) { return new Shape([W, H, D], (x, y) => fn(x, y)); }

// ---------------------------------------------------------------- superficie
// Ogni cella è una casella quadrata 1x1 sulla superficie del solido.
// c = centro, n = normale uscente.
export class Board {
  constructor(shape) {
    this.shape = shape;
    this.dims = shape.dims;
    this.cells = [];
    this.index = new Map();
    const [X, Y, Z] = shape.dims;
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let x = 0; x < X; x++) for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) {
      if (!shape.has(x, y, z)) continue;
      for (const n of dirs) {
        if (shape.has(x + n[0], y + n[1], z + n[2])) continue;
        const c = [x + 0.5 + n[0] * 0.5, y + 0.5 + n[1] * 0.5, z + 0.5 + n[2] * 0.5];
        const id = this.cells.length;
        this.cells.push({ id, c, n, v: [x, y, z] });
        this.index.set(this.key(c, n), id);
      }
    }
  }
  key(c, n) {
    return `${Math.round(c[0] * 2)},${Math.round(c[1] * 2)},${Math.round(c[2] * 2)}|${n.join(',')}`;
  }
  cellAt(c, n) {
    const id = this.index.get(this.key(c, n));
    return id === undefined ? -1 : id;
  }

  // Passo sulla superficie nella direzione d.
  // kind: 'flat' stessa faccia, 'concave' sale su una parete, 'convex' scavalca uno spigolo.
  neighbor(id, d) {
    const { c, n, v } = this.cells[id];
    const s = this.shape;
    const w = add(add(v, n), d);
    if (s.has(w[0], w[1], w[2])) {
      return { id: this.cellAt(add(add(c, scale(d, 0.5)), scale(n, 0.5)), neg(d)), dir: n, kind: 'concave' };
    }
    const f = add(v, d);
    if (s.has(f[0], f[1], f[2])) return { id: this.cellAt(add(c, d), n), dir: d, kind: 'flat' };
    return { id: this.cellAt(add(add(c, scale(d, 0.5)), scale(n, -0.5)), d), dir: neg(n), kind: 'convex' };
  }

  // Strada davanti alla punta: segue la superficie (anche su per le pareti
  // interne) fino al primo spigolo sporgente, da cui la freccia vola via.
  rayPath(id, d) {
    const cells = [];
    let cur = id, dir = d, loop = false;
    for (;;) {
      const nb = this.neighbor(cur, dir);
      if (nb.kind === 'convex') break;
      // dentro un foro si può girare in tondo senza mai uscire
      if (nb.id === id || cells.length > this.cells.length) { loop = true; break; }
      cells.push(nb.id);
      cur = nb.id; dir = nb.dir;
    }
    return { cells, dir, last: cur, loop };
  }
  ray(id, d) { return this.rayPath(id, d).cells; }

  tangents(id) {
    const a = axisOf(this.cells[id].n);
    const out = [];
    for (let k = 0; k < 3; k++) {
      if (k === a) continue;
      const p = [0, 0, 0]; p[k] = 1; out.push(p);
      const m = [0, 0, 0]; m[k] = -1; out.push(m);
    }
    return out;
  }
}

function shuffle(arr, r) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------- generatore
// Generazione "a ritroso": ogni freccia nuova deve avere la strada libera
// rispetto a quelle già piazzate. Togliendole in ordine inverso il livello si
// risolve sempre. Con hard alto, tra più candidate si sceglie quella che
// blocca più frecce esistenti: catene di dipendenze più lunghe, meno frecce
// libere all'inizio, livello più difficile.
export function generate({ shape, seed, minLen, maxLen, turn, hard = 0.3 }) {
  const r = rng(seed);
  const board = new Board(shape);
  const N = board.cells.length;
  const occ = new Int32Array(N).fill(-1);
  const owners = Array.from({ length: N }, () => []); // frecce la cui strada passa sulla cella
  const blockedBy = []; // per ogni freccia: quante frecce successive la bloccano
  const arrows = [];
  // valore di una cella per il corpo di una nuova freccia: bloccare una freccia
  // ancora libera vale molto, una già bloccata poco
  const cellValue = (id) => {
    let v = 0;
    for (const a of owners[id]) v += blockedBy[a] === 0 ? 4 : 0.4;
    return v;
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const K = 1 + Math.round(hard * 16);
  const steer = hard * 0.85;

  // Una freccia con la punta contro lo spigolo non può mai essere bloccata:
  // nei livelli difficili si chiede almeno qualche casella di strada davanti.
  const minRay = Math.round(Math.min(1, hard) * 3);
  function build(h, need = minRay) {
    if (occ[h] >= 0) return null;
    const dirs = shuffle(board.tangents(h), r)
      .map((d) => { const p = board.rayPath(h, d); return { d, ray: p.cells, loop: p.loop }; })
      .filter((o) => !o.loop && o.ray.length >= need && !o.ray.some((c) => occ[c] >= 0))
      .map((o) => ({ ...o, k: o.ray.length + r() * 3 }))
      .sort((a, b) => b.k - a.k);
    for (const { d, ray } of dirs) {
      const forbidden = new Set(ray);
      const own = new Set([h]);
      const body = [h];
      const target = minLen + Math.floor(r() * (maxLen - minLen + 1));
      let cur = h, dir = neg(d), first = true;
      while (body.length < target) {
        let cands;
        if (first) cands = [dir];
        else {
          const side = shuffle(board.tangents(cur).filter((t) => dot(t, dir) === 0), r);
          cands = r() < turn ? [...side, dir] : [dir, ...side];
        }
        first = false;
        const opts = [];
        for (const cd of cands) {
          const nb = board.neighbor(cur, cd);
          if (nb.id < 0 || occ[nb.id] >= 0 || own.has(nb.id) || forbidden.has(nb.id)) continue;
          opts.push(nb);
        }
        if (!opts.length) break;
        // nei livelli difficili il corpo passa di preferenza sopra le strade altrui
        let nb = opts[0];
        if (opts.length > 1 && r() < steer) nb = opts.reduce((a, b) => (cellValue(b.id) > cellValue(a.id) ? b : a));
        body.push(nb.id); own.add(nb.id);
        cur = nb.id; dir = nb.dir;
      }
      if (body.length < 2) continue;
      return { body, d, ray };
    }
    return null;
  }
  function place(c) {
    const idx = arrows.length;
    const cells = c.body.slice().reverse(); // coda -> punta
    const hit = new Set();
    cells.forEach((id) => { occ[id] = idx; owners[id].forEach((a) => hit.add(a)); });
    hit.forEach((a) => blockedBy[a]++);
    c.ray.forEach((id) => owners[id].push(idx));
    blockedBy.push(0);
    arrows.push({ id: idx, cells, dir: c.d });
  }
  function randomFree() {
    for (let t = 0; t < 30; t++) {
      const h = Math.floor(r() * N);
      if (occ[h] < 0) return h;
    }
    return -1;
  }

  let fails = 0;
  while (fails < 25) {
    let best = null, bs = -1;
    for (let k = 0; k < K; k++) {
      const h = randomFree();
      if (h < 0) break;
      const c = build(h);
      if (!c) continue;
      const hit = new Set();
      for (const id of c.body) owners[id].forEach((a) => hit.add(a));
      let s = r() * 0.8;
      hit.forEach((a) => (s += blockedBy[a] === 0 ? 4 : 0.4));
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) { fails++; continue; }
    fails = 0;
    place(best);
  }
  // riempie i buchi rimasti, accettando strade via via più corte
  for (let need = minRay - 1; need >= Math.floor(minRay / 2); need--) {
    let placed = 0;
    for (const h of shuffle([...Array(N).keys()], r)) {
      const c = build(h, need);
      if (c) { place(c); placed++; }
    }
  }
  // Allunga le code nelle caselle vuote: superficie più piena e frecce più
  // intrecciate. Una coda può entrare in una casella solo se ogni freccia la
  // cui strada passa di lì viene tolta dopo (cioè è stata piazzata prima):
  // così la soluzione resta valida.
  const ownRay = arrows.map((a) => new Set(board.ray(a.cells[a.cells.length - 1], a.dir)));
  const cap = maxLen + 4;
  for (let round = 0; round < 40; round++) {
    let grown = 0;
    for (const a of shuffle(arrows.slice(), r)) {
      if (a.cells.length >= cap) continue;
      const tail = a.cells[0];
      const opts = [];
      for (const t of board.tangents(tail)) {
        const nb = board.neighbor(tail, t);
        if (nb.id < 0 || occ[nb.id] >= 0 || ownRay[a.id].has(nb.id)) continue;
        if (owners[nb.id].some((o) => o > a.id)) continue;
        opts.push(nb.id);
      }
      if (!opts.length) continue;
      // preferisce le caselle che bloccano più frecce: più intreccio
      let x = opts[0], bk = -1;
      for (const o of opts) {
        const k = owners[o].length + r();
        if (k > bk) { bk = k; x = o; }
      }
      a.cells.unshift(x);
      occ[x] = a.id;
      grown++;
    }
    if (!grown) break;
  }
  return { board, arrows };
}

// Primo ostacolo sulla traiettoria: null se libera, altrimenti
// { dist: caselle libere prima dell'ostacolo, arrow: id dell'ostacolo }.
export function blocker(board, occ, arrow) {
  const head = arrow.cells[arrow.cells.length - 1];
  const ray = board.ray(head, arrow.dir);
  for (let i = 0; i < ray.length; i++) {
    const o = occ[ray[i]];
    if (o >= 0 && o !== arrow.id) return { dist: i, arrow: o };
  }
  return null;
}

// ---------------------------------------------------------------- livelli
// min/max = lato indicativo del solido; grow = ogni quanti livelli cresce;
// h0/h1 = difficoltà al primo livello e massima; hRate = aumento per livello.
export const DIFFICULTIES = {
  facile:    { label: 'Facile',    min: 6,  max: 11, grow: 3, minLen: 2, maxLen: 7,  turn: 0.5,  h0: 0.25, h1: 0.7, hRate: 0.025 },
  normale:   { label: 'Normale',   min: 10, max: 16, grow: 3, minLen: 2, maxLen: 11, turn: 0.6,  h0: 0.75, h1: 1,   hRate: 0.035 },
  difficile: { label: 'Difficile', min: 12, max: 20, grow: 2, minLen: 3, maxLen: 14, turn: 0.65, h0: 1,    h1: 1,   hRate: 0.03 },
};

export function levelParams(level, diffKey) {
  const d = DIFFICULTIES[diffKey];
  const di = Object.keys(DIFFICULTIES).indexOf(diffKey);
  const seed = level * 7919 + di * 104729 + 17;
  const r = rng(seed ^ 0x5bd1e995);
  const s = Math.min(d.max, d.min + Math.floor((level - 1) / d.grow));
  // prima giro tutte le forme in ordine, poi forme a caso
  const shapeKey = level <= SHAPE_CYCLE.length
    ? SHAPE_CYCLE[level - 1]
    : SHAPE_CYCLE[Math.floor(r() * SHAPE_CYCLE.length)];
  const shape = SHAPES[shapeKey].make(s, r);
  // il bonus "intensità" (fino a 1.25) fa crescere ancora i livelli molto avanzati
  const hard = Math.min(d.h1 * 1.25, d.h0 + (level - 1) * d.hRate);
  return { shape, shapeKey, seed, minLen: d.minLen, maxLen: d.maxLen, turn: d.turn, hard };
}
