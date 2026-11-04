// Live2D-style deformer rig over a flat illustration.
// Each vertex gets precomputed soft weights for a set of "deformers" (head, ears,
// hair strands, tail, breath, body, skirt). Every frame the parameter state is
// applied to rest positions, so the sprite mesh and the expression-patch mesh
// (which share this rig) always move together.

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function ellipseW(px, py, e, feather) {
  const dx = (px - e.c[0]) / e.rx, dy = (py - e.c[1]) / e.ry;
  const d = Math.sqrt(dx * dx + dy * dy);
  const f = (feather || 0) / Math.min(e.rx, e.ry);
  return f > 0 ? 1 - smooth(1, 1 + f, d) : (d <= 1 ? 1 : 0);
}

// nearest point on polyline: returns {d, s} (s = normalized arc length)
function polyNearest(px, py, pts, lens, total) {
  let best = 1e9, bs = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
    let t = ((px - ax) * vx + (py - ay) * vy) / L2; t = clamp(t, 0, 1);
    const qx = ax + vx * t - px, qy = ay + vy * t - py, d = qx * qx + qy * qy;
    if (d < best) { best = d; bs = (acc + lens[i] * t) / total; }
    acc += lens[i];
  }
  return { d: Math.sqrt(best), s: bs };
}
const inPoly = (x, y, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
// distance from a point to the outline of a closed polygon
function polyEdge(px, py, poly) {
  let best = 1e18;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i], vx = bx - ax, vy = by - ay;
    const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1), qx = ax + vx * t - px, qy = ay + vy * t - py;
    best = Math.min(best, qx * qx + qy * qy);
  }
  return Math.sqrt(best);
}
// soft membership of a closed polygon, feathered by f px on either side of the outline
function polySoft(px, py, poly, f) {
  const d = smooth(0, f, polyEdge(px, py, poly)) * 0.5;
  return inPoly(px, py, poly) ? 0.5 + d : 0.5 - d;
}
function prepPoly(pts) {
  const lens = []; let total = 0;
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); lens.push(l); total += l; }
  return { pts, lens, total };
}
// capsule weight along a polyline, extended slightly past the tip so loose ends are covered
function strandW(px, py, P, r, f) {
  const n = polyNearest(px, py, P.pts, P.lens, P.total);
  return { w: 1 - smooth(r, r + f, n.d), s: n.s };
}
// how far (px) a point lies outward of a closed outline's inner edge on its row; out = +1 when
// "outward" is to the right. Negative just outside the inner edge, null if the row misses the outline.
function innerOffset(px, py, poly, out) {
  let near = null, far = null;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) === (yj > py)) continue;
    const d = (px - (xi + (py - yi) * (xj - xi) / (yj - yi))) * out;
    if (d >= 0) { if (near == null || d < near) near = d; } else if (far == null || -d < far) far = -d;
  }
  return near != null ? near : far != null ? -far : null;
}

class Rig {
  constructor(cfg) {
    this.cfg = cfg;
    this.strands = cfg.strands.map(s => ({ ...s, P: prepPoly(s.pts), out: Math.sign(s.pts[0][0] - cfg.dome.c[0]) || 1 }));
    this.tailP = prepPoly(cfg.tail.pts);
    this.tailRoot = this.pointAt(this.tailP, cfg.tail.s0 || 0);
    // the tail leaves the body under the hem: its root rides along when the cloth sways or is lifted
    this.tailHem = { x: this.tailRoot[0], y: this.tailRoot[1], ...this.hemAt(this.tailRoot[0], this.tailRoot[1]) };
    this.ears = cfg.ears.map(e => ({ ...e, len: Math.hypot(e.tip[0] - e.pivot[0], e.tip[1] - e.pivot[1]), P: prepPoly([e.pivot, e.tip]) }));
  }

  // skirt weights at a sprite pixel: w = sway with the body, p = give when the hem is pulled
  hemAt(x, y) {
    const sk = this.cfg.skirt, skx = smooth(sk.x[0], sk.x[0] + 60, x) * (1 - smooth(sk.x[1] - 60, sk.x[1], x));
    return { w: smooth(sk.y[0], sk.y[1], y) * (1 - smooth(sk.y[2], sk.y[3], y)) * skx,
      // the cloth gives more the lower it is, right down to the frill's edge
      p: smooth(sk.y[0], sk.y[2], y) * (1 - smooth(sk.y[3] - 6, sk.y[3] + 10, y)) * skx };
  }

  // 0..1 "is this hair" at a sprite pixel (baked from colours; 1 when no map)
  hairAt(x, y) {
    const H = this.hair; if (!H) return 1;
    const fx = Math.min(H.w - 1.001, Math.max(0, x / H.step - 0.5)), fy = Math.min(H.h - 1.001, Math.max(0, y / H.step - 0.5));
    const i = fx | 0, j = fy | 0, u = fx - i, v = fy - j, d = H.data, w = H.w;
    return (d[j * w + i] * (1 - u) + d[j * w + i + 1] * u) * (1 - v) + (d[(j + 1) * w + i] * (1 - u) + d[(j + 1) * w + i + 1] * u) * v;
  }

  pointAt(P, s) {
    let d = s * P.total;
    for (let i = 0; i < P.lens.length; i++) {
      if (d <= P.lens[i] || i === P.lens.length - 1) { const t = Math.min(1, d / P.lens[i]); const [a, b] = [P.pts[i], P.pts[i + 1]]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
      d -= P.lens[i];
    }
  }

  // Soft mask (0..1) of the tail layer at a sprite pixel
  tailMask(x, y) {
    const t = this.cfg.tail, n = polyNearest(x, y, this.tailP.pts, this.tailP.lens, this.tailP.total);
    let m = 1 - smooth(t.mr, t.mr + 3, n.d);
    for (const e of t.extra) m = Math.max(m, ellipseW(x, y, e, 3));
    if (t.cut.y != null) m *= smooth(t.cut.y - 1.5, t.cut.y + 1.5, y);
    if (t.cut.x != null) m *= 1 - smooth(t.cut.x - 1.5, t.cut.x + 1.5, x) * (1 - smooth(t.cut.yMax - 4, t.cut.yMax + 4, y));
    return m;
  }

  // Precompute weights for an array of rest positions [x0,y0,x1,y1,...]
  // layer: 'body' (tail excluded) | 'tail' (tail only) | 'locks' (twin tails) | 'skirt' (lower skirt) | 'face'
  weights(rest, layer = 'body') {
    if (layer === 'tail') return this.tailWeights(rest);
    const n = rest.length / 2, c = this.cfg, S = this.strands.length;
    const W = {
      n, head: new Float32Array(n), back: new Float32Array(n), dome: new Float32Array(n), upper: new Float32Array(n), body: new Float32Array(n),
      skirt: new Float32Array(n), skirtP: new Float32Array(n), tailW: new Float32Array(n), tailS: new Float32Array(n),
      earW: this.ears.map(() => new Float32Array(n)), earS: this.ears.map(() => new Float32Array(n)),
      stW: this.strands.map(() => new Float32Array(n)), stS: this.strands.map(() => new Float32Array(n)),
      stIn: this.strands.map(() => new Float32Array(n).fill(1)),
    };
    for (let i = 0; i < n; i++) {
      const x = rest[i * 2], y = rest[i * 2 + 1];
      let head = ellipseW(x, y, c.head, c.head.feather);
      // never drag anything below the chin/neck line
      head *= 1 - smooth(c.neck[1] - 30, c.neck[1] + 5, y);
      const dx = (x - c.dome.c[0]) / c.dome.rx, dy = (y - c.dome.c[1]) / c.dome.ry;
      const r2 = dx * dx + dy * dy;
      W.dome[i] = r2 < 1 ? (1 - r2) * (1 - r2) : 0;
      for (let k = 0; k < this.ears.length; k++) {
        const e = this.ears[k], sw = strandW(x, y, e.P, e.r, 28);
        // only the part of the ear beyond the pivot moves
        const along = ((x - e.pivot[0]) * (e.tip[0] - e.pivot[0]) + (y - e.pivot[1]) * (e.tip[1] - e.pivot[1])) / (e.len * e.len);
        W.earW[k][i] = sw.w * smooth(-0.15, 0.25, along);
        W.earS[k][i] = clamp(along, 0, 1.2);
        head = Math.max(head, sw.w);
      }
      // strands only own hair-coloured pixels, so arms/hands lying under a lock stay put.
      // With a split rig the twin tails (layer) live on their own 'locks' layer, which swings as a whole
      // (everything inside the traced outline, `poly`), while the rest of the hair stays on the body.
      const locks = layer === 'locks', hairK = S && !locks ? this.hairAt(x, y) : 1;
      let back = 0;
      for (let k = 0; k < S; k++) {
        const st = this.strands[k];
        if (this.split && st.layer) {
          // how far a tail follows the head (and the back-hair parallax) is the same function on both
          // layers, and off the torso so the sleeve stays put; otherwise the cut opens up beside the
          // head when she turns or tilts it
          const cw = strandW(x, y, st.P, st.r, st.f), off = c.torso ? 1 - polySoft(x, y, c.torso, 12) : 1;
          head = Math.max(head, cw.w * (1 - 0.55 * cw.s) * off);
          if (st.back) back = Math.max(back, cw.w * off);
          if (!locks) { W.stS[k][i] = 0; continue; }
          // every vertex of a cell that holds tail pixels moves fully (cells are 8 px, so 12 px out)
          const sw = st.poly ? { w: inPoly(x, y, st.poly) ? 1 : 1 - smooth(12, 24, polyEdge(x, y, st.poly)), s: polyNearest(x, y, st.P.pts, st.P.lens, st.P.total).s }
            : strandW(x, y, st.P, st.r + st.f + 16, 12);
          W.stW[k][i] = sw.w; W.stS[k][i] = sw.s;
          // (a tail without `bend`) swung or pulled away from her head, its inner edge only goes part of
          // the way and the strand fans out, so it stays joined to the side hair beside it
          const lat = st.poly && !st.bend ? innerOffset(x, y, st.poly, st.out) : null;
          if (lat != null) W.stIn[k][i] = 0.08 + 0.92 * smooth(0, 80, lat);
          continue;
        }
        if (this.split && locks) { W.stS[k][i] = 0; continue; }
        const sw = strandW(x, y, st.P, st.r, st.f);
        if (!st.anyColor) sw.w *= hairK;
        W.stW[k][i] = sw.w; W.stS[k][i] = sw.s;
        // hair hanging from the head follows head roll, fading towards the tips
        head = Math.max(head, sw.w * (1 - 0.55 * sw.s));
        if (st.back) back = Math.max(back, sw.w);
      }
      W.head[i] = head; W.back[i] = back;
      W.upper[i] = 1 - smooth(c.upper[0], c.upper[1], y);
      W.body[i] = 1 - smooth(c.body[0], c.body[1], y);
      // with the hem cut out into its own layer only that layer sways (the tail follows it, see
      // tailWeights) and the legs under it stay put; on a single layer the tail is kept out of it
      const hm = this.hemAt(x, y), skx = this.splitSkirt ? (layer === 'skirt' ? 1 : 0) : 1 - strandW(x, y, this.tailP, c.tail.mr, 20).w;
      W.skirt[i] = hm.w * skx; W.skirtP[i] = hm.p * skx;
    }
    return W;
  }

  tailWeights(rest) {
    const n = rest.length / 2, z = () => new Float32Array(n);
    const W = { n, head: z(), back: z(), dome: z(), upper: z(), body: z(), skirt: z(), skirtP: z(), tailW: z(), tailS: z(), tailHem: z(),
      earW: this.ears.map(z), earS: this.ears.map(z), stW: this.strands.map(z), stS: this.strands.map(z) };
    // Soft-min arc parameter: blends between nearby centreline samples so that
    // points on the inside of a bend don't snap between distant parts of the tail.
    const P = this.tailP, samples = [], step = 3;
    for (let d = 0; d <= P.total; d += step) samples.push([...this.pointAt(P, d / P.total), d / P.total]);
    const sig2 = 2 * 14 * 14;
    for (let i = 0; i < n; i++) {
      const x = rest[i * 2], y = rest[i * 2 + 1];
      let dmin = 1e9; const ds = samples.map(([sx, sy]) => { const d = Math.hypot(x - sx, y - sy); if (d < dmin) dmin = d; return d; });
      let sw = 0, ss = 0;
      for (let k = 0; k < samples.length; k++) { const w = Math.exp(-((ds[k] - dmin) ** 2) / sig2); sw += w; ss += w * samples[k][2]; }
      W.tailW[i] = 1; W.tailS[i] = ss / sw;
      // the first part of the tail bends after the hem it comes out from under
      const s0 = this.cfg.tail.s0 || 0;
      W.tailHem[i] = 1 - smooth(0, 0.4, Math.max(0, (W.tailS[i] - s0) / (1 - s0)));
    }
    return W;
  }

  // Apply parameter state. out may alias nothing; rest/out are Float32Array.
  deform(rest, W, P, out) {
    const c = this.cfg, n = W.n;
    const [nx, ny] = c.neck, [hx, hy] = c.hips;
    const cr = Math.cos(P.roll), sr = Math.sin(P.roll);
    const cb = Math.cos(P.bodyRoll), sb = Math.sin(P.bodyRoll);
    const ears = this.ears, strands = this.strands;
    const tailRoot = this.tailRoot, s0 = c.tail.s0 || 0;
    const pokes = P.pokes;
    const dg = P.hairDrag, bend = dg && strands[dg.k] && strands[dg.k].bend ? this.bendFor(strands[dg.k], dg) : null;
    const breathY = -P.breath * 3.2, breathX = P.breath * 0.006;
    const sq = P.squash, feet = c.feetY;
    for (let i = 0; i < n; i++) {
      let x = rest[i * 2], y = rest[i * 2 + 1];
      // --- tail: progressive bend around its root + drag
      const tw = W.tailW[i];
      if (tw > 0.001) {
        // s measured from where the tail leaves the body layer
        const s = Math.max(0, (W.tailS[i] - s0) / (1 - s0));
        const a = tw * (P.tailAngle * s * 1.2 + P.tailWave * Math.sin((P.tailPhase != null ? P.tailPhase : P.t * 5.0) - s * 4.0) * s);
        const ca = Math.cos(a), sa = Math.sin(a), rx = x - tailRoot[0], ry = y - tailRoot[1];
        x = tailRoot[0] + rx * ca - ry * sa; y = tailRoot[1] + rx * sa + ry * ca;
        if (P.tailDrag) { const sg = Math.max(0.2, (P.tailDrag.s - s0) / (1 - s0)); const inf = tw * smooth(0, sg, s); x += P.tailDrag.x * inf; y += P.tailDrag.y * inf; }
        // carried along by the hem over its root, so lifting the skirt never bares the cut end
        const hk = W.tailHem ? W.tailHem[i] : 0, R = this.tailHem;
        if (hk > 0.001) {
          let ox = (P.skirt || 0) * R.w, oy = 0;
          const sp = P.skirtPull;
          if (sp && R.p > 0.001) { const ddx = R.x - sp.px, ddy = R.y - sp.py, g = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * 120 * 120)) * R.p; ox += sp.x * g; oy += sp.y * g; }
          x += ox * hk; y += oy * hk;
        }
      }
      // --- ears: rotate about base + stretch towards a pull
      for (let k = 0; k < ears.length; k++) {
        const w = W.earW[k][i]; if (w < 0.001) continue;
        const e = ears[k], s = W.earS[k][i], a = P.ear[k] * w * (0.4 + 0.6 * s);
        const ca = Math.cos(a), sa = Math.sin(a), rx = x - e.pivot[0], ry = y - e.pivot[1];
        x = e.pivot[0] + rx * ca - ry * sa; y = e.pivot[1] + rx * sa + ry * ca;
        const pull = P.earPull[k];
        if (pull) { const f = w * s * s; x += pull[0] * f; y += pull[1] * f; }
      }
      // --- hair strands: pendulum swing around their root
      for (let k = 0; k < strands.length; k++) {
        const w = W.stW[k][i]; if (w < 0.001) continue;
        const st = strands[k], s = W.stS[k][i], root = st.pts[0], x0 = x;
        const a = P.hair[k] * w * Math.pow(s, 1.4);
        const ca = Math.cos(a), sa = Math.sin(a), rx = x - root[0], ry = y - root[1];
        x = root[0] + rx * ca - ry * sa; y = root[1] + rx * sa + ry * ca;
        const d = dg && dg.k === k ? dg : null;
        if (d && bend) {
          // a twin tail turns about its tie, more the further down, so it bends as one piece and stays
          // tied on; below the grabbed point it hangs on rigidly
          const b = w * smooth(0.03, bend.sg, s), ab = bend.a * b, cb2 = Math.cos(ab), sb2 = Math.sin(ab), m = 1 + bend.k * b;
          const qx = x - root[0], qy = y - root[1];
          x = root[0] + (qx * cb2 - qy * sb2) * m; y = root[1] + (qx * sb2 + qy * cb2) * m;
        } else if (d) {
          // the tie itself stays put (the body keeps the original pixels there)
          const f = w * smooth(0.1, Math.max(0.3, d.s), s); x += d.x * f; y += d.y * f;
        }
        const g = W.stIn ? W.stIn[k][i] : 1;
        if (g < 1 && (x - x0) * st.out > 0) x = x0 + (x - x0) * g;
      }
      x -= P.angleX * 5 * W.back[i];                   // back hair parallax opposite to the face
      // --- cheek pokes: soft pinch towards the poke point
      for (let k = 0; k < pokes.length; k++) {
        const pk = pokes[k], ddx = x - pk.x, ddy = y - pk.y, g = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * 22 * 22)) * pk.a;
        x -= ddx * 0.35 * g; y -= ddy * 0.35 * g;
      }
      // --- head: fake 3D turn (dome parallax) + translate + roll about the neck
      const hw = W.head[i];
      if (hw > 0.001) {
        const dm = W.dome[i];
        x += (P.angleX * 13 * dm + P.angleX * 4 + P.headDX) * hw;
        y += (P.angleY * 10 * dm + P.angleY * 3 + P.headDY) * hw;
        const a = P.roll * hw, ca = Math.cos(a), sa = Math.sin(a), rx = x - nx, ry = y - ny;
        x = nx + rx * ca - ry * sa; y = ny + rx * sa + ry * ca;
      }
      // --- breathing: upper body rises, shoulders widen slightly
      const uw = W.upper[i];
      y += breathY * uw; x += (x - nx) * breathX * uw;
      // --- body sway around the hips
      const bw = W.body[i];
      if (bw > 0.001) {
        const ca = 1 + (cb - 1) * bw, sa = sb * bw, rx = x - hx, ry = y - hy;
        x = hx + rx * ca - ry * sa + P.bodyX * 7 * bw; y = hy + rx * sa + ry * ca;
      }
      x += P.skirt * W.skirt[i];
      // --- skirt pulled at a point: a soft bulge of cloth follows the hand
      const sp = P.skirtPull, kw = W.skirtP[i];
      if (sp && kw > 0.001) {
        const ddx = rest[i * 2] - sp.px, ddy = rest[i * 2 + 1] - sp.py, g = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * 120 * 120)) * kw;
        x += sp.x * g; y += sp.y * g;
      }
      // --- global hop / squash & stretch anchored at the feet
      y = feet - (feet - y) * (1 + sq) - P.hop;
      x = 512 + (x - 512) * (1 - sq * 0.5);
      out[i * 2] = x; out[i * 2 + 1] = y;
    }
    return out;
  }

  // A pull on a twin tail as a turn about its tie: the angle that brings the grabbed point (rest
  // position on the centre line) to the hand, and how much the tail gives along its length
  bendFor(st, d) {
    const R = st.pts[0], G = this.pointAt(st.P, d.s), vx = G[0] - R[0], vy = G[1] - R[1], ux = vx + d.x, uy = vy + d.y;
    return { a: Math.atan2(vx * uy - vy * ux, vx * ux + vy * uy), k: clamp(Math.hypot(ux, uy) / (Math.hypot(vx, vy) || 1) - 1, -0.06, 0.1), sg: Math.max(0.35, d.s) };
  }

  // Deform a single rest point (used for UI anchors / particles)
  point(x, y, P) {
    const rest = new Float32Array([x, y]);
    const W = this.weights(rest);
    return this.deform(rest, W, P, new Float32Array(2));
  }
}
