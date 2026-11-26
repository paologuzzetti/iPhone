// Logica del puzzle: griglia sulla superficie di un parallelepipedo,
// generazione dei livelli (sempre risolvibili) e regole di movimento.

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

// Ogni cella è una casella quadrata 1x1 su una faccia del solido.
// c = centro (coordinate reali), n = normale uscente della faccia.
export class Board {
  constructor(dims) {
    this.dims = dims;
    this.cells = [];
    this.index = new Map();
    for (let a = 0; a < 3; a++) {
      const u = (a + 1) % 3, v = (a + 2) % 3;
      for (const s of [-1, 1]) {
        for (let i = 0; i < dims[u]; i++) {
          for (let j = 0; j < dims[v]; j++) {
            const c = [0, 0, 0];
            c[a] = s > 0 ? dims[a] : 0;
            c[u] = i + 0.5; c[v] = j + 0.5;
            const n = [0, 0, 0]; n[a] = s;
            const id = this.cells.length;
            this.cells.push({ id, c, n });
            this.index.set(this.key(c, n), id);
          }
        }
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
  inside(c, k) { return c[k] >= 0 && c[k] <= this.dims[k]; }

  // Passo sulla superficie (con scavalcamento degli spigoli).
  neighbor(id, d) {
    const cell = this.cells[id];
    const k = axisOf(d);
    const c2 = add(cell.c, d);
    if (this.inside(c2, k)) return { id: this.cellAt(c2, cell.n), dir: d };
    const c3 = add(add(cell.c, scale(d, 0.5)), scale(cell.n, -0.5));
    return { id: this.cellAt(c3, d), dir: neg(cell.n) };
  }

  // Caselle davanti alla punta, fino al bordo della faccia.
  ray(id, d) {
    const out = [];
    const cell = this.cells[id];
    const k = axisOf(d);
    let c = cell.c;
    for (;;) {
      c = add(c, d);
      if (!this.inside(c, k)) break;
      out.push(this.cellAt(c, cell.n));
    }
    return out;
  }

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

// Generazione "a ritroso": ogni freccia nuova deve avere la strada libera
// rispetto a quelle già piazzate. Togliendole in ordine inverso il livello
// si risolve sempre, quindi esiste sempre almeno una soluzione.
export function generate({ dims, seed, minLen, maxLen, turn }) {
  const r = rng(seed);
  const board = new Board(dims);
  const N = board.cells.length;
  const occ = new Int32Array(N).fill(-1);
  const arrows = [];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  for (let pass = 0; pass < 6; pass++) {
    let placed = 0;
    const order = shuffle([...Array(N).keys()], r);
    for (const h of order) {
      if (occ[h] >= 0) continue;
      // Preferisce le direzioni con la strada più lunga: frecce che
      // attraversano la faccia creano più dipendenze e livelli più ricchi.
      const dirs = shuffle(board.tangents(h), r)
        .map((d) => ({ d, ray: board.ray(h, d) }))
        .filter((o) => !o.ray.some((c) => occ[c] >= 0))
        .sort((a, b) => b.ray.length + r() * 2 - (a.ray.length + r() * 2));
      for (const { d, ray } of dirs) {
        const forbidden = new Set(ray);
        const own = new Set([h]);
        const body = [h];
        const target = minLen + Math.floor(r() * (maxLen - minLen + 1));
        let cur = h;
        let dir = neg(d);
        let first = true;
        while (body.length < target) {
          let cands;
          if (first) cands = [dir];
          else {
            const side = board.tangents(cur).filter((t) => dot(t, dir) === 0);
            shuffle(side, r);
            cands = r() < turn ? [...side, dir] : [dir, ...side];
          }
          first = false;
          let moved = false;
          for (const cd of cands) {
            const nb = board.neighbor(cur, cd);
            if (nb.id < 0 || occ[nb.id] >= 0 || own.has(nb.id) || forbidden.has(nb.id)) continue;
            body.push(nb.id); own.add(nb.id);
            cur = nb.id; dir = nb.dir; moved = true;
            break;
          }
          if (!moved) break;
        }
        if (body.length < 2) continue;
        const idx = arrows.length;
        const cells = body.slice().reverse(); // coda -> punta
        cells.forEach((c) => (occ[c] = idx));
        arrows.push({ id: idx, cells, dir: d });
        placed++;
        break;
      }
    }
    if (!placed) break;
  }
  return { board, arrows };
}

// Primo ostacolo sulla traiettoria: -1 se libera, altrimenti
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

export const DIFFICULTIES = {
  facile:    { label: 'Facile',    min: 3, max: 5, grow: 6, minLen: 2, maxLen: 4,  turn: 0.35 },
  normale:   { label: 'Normale',   min: 4, max: 7, grow: 5, minLen: 2, maxLen: 7,  turn: 0.45 },
  difficile: { label: 'Difficile', min: 5, max: 9, grow: 4, minLen: 3, maxLen: 10, turn: 0.55 },
};

export function levelParams(level, diffKey) {
  const d = DIFFICULTIES[diffKey];
  const di = Object.keys(DIFFICULTIES).indexOf(diffKey);
  const seed = level * 7919 + di * 104729 + 17;
  const r = rng(seed ^ 0x5bd1e995);
  const base = Math.min(d.max, d.min + Math.floor((level - 1) / d.grow));
  const dims = [0, 0, 0].map(() => {
    const v = base + Math.floor(r() * 3) - 1;
    return Math.max(2, Math.min(d.max + 1, v));
  });
  return { dims, seed, minLen: d.minLen, maxLen: d.maxLen, turn: d.turn };
}
