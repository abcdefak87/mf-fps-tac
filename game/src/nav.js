// The bots' road map. At build time the world colliders are rasterised into a coarse
// walkable grid (one cell per metre, blocked where a standing body would not fit), then a
// grid A* answers path requests and a Bresenham smoothing pass cuts loose corners. Bots ask
// for a path at most a few times a second; the grid is built exactly once.
const CELL = 1.0;               // metres per cell
const BODY_RADIUS = 0.38;       // a little wider than a bot, so paths keep off walls
const BODY_HEIGHT = 1.7;
const MAX_POPS = 6000;          // A* safety bound; the map is ~3000 cells

const scratch = new Float32Array(9); // reused per pop: nothing allocates inside the search

export function createNav(bounds, colliders) {
  const w = Math.floor((bounds.maxX - bounds.minX) / CELL);
  const h = Math.floor((bounds.maxZ - bounds.minZ) / CELL);
  const grid = new Uint8Array(w * h);

  // A cell is walkable when a standing box at its centre clears every collider.
  const test = { min: [0, 0, 0], max: [0, 0, 0] };
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = bounds.minX + (i + 0.5) * CELL;
      const z = bounds.minZ + (j + 0.5) * CELL;
      test.min[0] = x - BODY_RADIUS; test.max[0] = x + BODY_RADIUS;
      test.min[1] = 0.12;            test.max[1] = BODY_HEIGHT;
      test.min[2] = z - BODY_RADIUS; test.max[2] = z + BODY_RADIUS;
      let blocked = 0;
      for (const c of colliders) {
        if (test.min[0] < c.max.x && test.max[0] > c.min.x &&
            test.min[1] < c.max.y && test.max[1] > c.min.y &&
            test.min[2] < c.max.z && test.max[2] > c.min.z) { blocked = 1; break; }
      }
      grid[j * w + i] = blocked;
    }
  }

  const toCellX = (x) => Math.max(0, Math.min(w - 1, Math.floor((x - bounds.minX) / CELL)));
  const toCellZ = (z) => Math.max(0, Math.min(h - 1, Math.floor((z - bounds.minZ) / CELL)));
  const toWorldX = (i) => bounds.minX + (i + 0.5) * CELL;
  const toWorldZ = (j) => bounds.minZ + (j + 0.5) * CELL;
  const open = (i, j) => i >= 0 && i < w && j >= 0 && j < h && grid[j * w + i] === 0;

  // Nearest walkable cell to a point — spawn markers are authored, but goals like "beside the
  // bomb" land wherever the bomb fell, so goals snap to the closest open ring.
  function snap(i, j) {
    if (open(i, j)) return [i, j];
    for (let r = 1; r <= 6; r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          if (open(i + di, j + dj)) return [i + di, j + dj];
        }
      }
    }
    return null;
  }

  // Straight-line walkability between two cells, for the smoothing pass.
  function lineClear(i0, j0, i1, j1) {
    const di = Math.abs(i1 - i0), dj = Math.abs(j1 - j0);
    const steps = Math.max(di, dj);
    for (let s = 0; s <= steps; s++) {
      const t = steps === 0 ? 0 : s / steps;
      if (!open(Math.round(i0 + (i1 - i0) * t), Math.round(j0 + (j1 - j0) * t))) return false;
    }
    return true;
  }

  const cameFrom = new Int32Array(w * h);
  const gScore = new Float32Array(w * h);
  const closed = new Uint8Array(w * h);
  const heap = new Int32Array(w * h * 2);
  const fScore = new Float32Array(w * h);

  function heapPush(heapLen, node, f) {
    let i = heapLen;
    heap[i] = node;
    fScore[node] = f;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (fScore[heap[parent]] <= fScore[heap[i]]) break;
      const t = heap[parent]; heap[parent] = heap[i]; heap[i] = t;
      i = parent;
    }
    return heapLen + 1;
  }
  function heapPop(heapLen) {
    const top = heap[0];
    heapLen -= 1;
    heap[0] = heap[heapLen];
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      if (l < heapLen && fScore[heap[l]] < fScore[heap[m]]) m = l;
      if (r < heapLen && fScore[heap[r]] < fScore[heap[m]]) m = r;
      if (m === i) break;
      const t = heap[m]; heap[m] = heap[i]; heap[i] = t;
      i = m;
    }
    return { top, heapLen };
  }

  // World-space path from (ax,az) to (bx,bz), or null. Returns an array of {x,z} with the
  // start cell's centre first and the snapped goal last; callers keep the array.
  function findPath(ax, az, bx, bz) {
    let s = snap(toCellX(ax), toCellZ(az));
    const g0 = snap(toCellX(bx), toCellZ(bz));
    if (!s || !g0) return null;
    const start = s[1] * w + s[0];
    const goal = g0[1] * w + g0[0];
    if (start === goal) return [{ x: toWorldX(g0[0]), z: toWorldZ(g0[1]) }];

    cameFrom.fill(-1);
    closed.fill(0);
    gScore.fill(Infinity);
    gScore[start] = 0;
    let heapLen = heapPush(0, start, 0);
    let pops = 0;

    while (heapLen > 0 && pops < MAX_POPS) {
      const { top, heapLen: nl } = heapPop(heapLen);
      heapLen = nl;
      if (closed[top]) continue;
      closed[top] = 1;
      pops += 1;
      if (top === goal) break;
      const ci = top % w, cj = (top / w) | 0;
      for (let n = 0; n < 9; n++) {
        const di = (n % 3) - 1, dj = ((n / 3) | 0) - 1;
        if (di === 0 && dj === 0) continue;
        const ni = ci + di, nj = cj + dj;
        if (!open(ni, nj)) continue;
        if (di !== 0 && dj !== 0 && (!open(ci + di, cj) || !open(ci, cj + dj))) continue; // no corner cuts
        const nn = nj * w + ni;
        const cost = gScore[top] + (di === 0 || dj === 0 ? 1 : 1.4142);
        if (cost < gScore[nn]) {
          gScore[nn] = cost;
          cameFrom[nn] = top;
          const hi = Math.abs(ni - g0[0]), hj = Math.abs(nj - g0[1]);
          heapLen = heapPush(heapLen, nn, cost + Math.max(hi, hj) + 0.4142 * Math.min(hi, hj));
        }
      }
    }
    if (cameFrom[goal] === -1 && start !== goal && !closed[goal]) return null;

    // Rebuild the cell chain, then greedily drop nodes a straight run reaches.
    const cells = [];
    for (let n = goal; n !== -1; n = cameFrom[n]) cells.push(n);
    cells.reverse();
    const path = [];
    let anchor = 0;
    for (let k = 1; k < cells.length; k++) {
      const ci = cells[anchor] % w, cj = (cells[anchor] / w) | 0;
      const ni = cells[k] % w, nj = (cells[k] / w) | 0;
      if (!lineClear(ci, cj, ni, nj)) {
        const prev = cells[k - 1];
        path.push({ x: toWorldX(prev % w), z: toWorldZ((prev / w) | 0) });
        anchor = k - 1;
      }
    }
    path.push({ x: toWorldX(g0[0]), z: toWorldZ(g0[1]) });
    return path;
  }

  return { findPath, open: (x, z) => open(toCellX(x), toCellZ(z)) };
}
