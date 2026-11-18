'use strict';
// ============================================================================
//  Utilities
// ============================================================================
const $ = s => document.querySelector(s);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const now = () => performance.now() / 1000;
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load ' + src)); i.src = src; });
const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function ctx2d(c) { return c.getContext('2d', { willReadFrequently: true }); }

// separable max filter (dilation) and box blur on a float mask
function dilate(m, w, h, r) {
  const t = new Float32Array(m.length), o = new Float32Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = Math.max(v, m[y * w + k]); t[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0; for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = Math.max(v, t[k * w + x]); o[y * w + x] = v;
  }
  return o;
}
function boxBlur(m, w, h, r, passes = 2) {
  let a = m, b = new Float32Array(m.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) { let acc = 0; const row = y * w;
      for (let x = -r; x < w + r; x++) {
        if (x + r < w && x + r >= 0) acc += a[row + Math.min(w - 1, x + r)];
        const o = x - r - 1; if (o >= 0) acc -= a[row + o];
        if (x >= 0 && x < w) b[row + x] = acc / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      } }
    const c = new Float32Array(m.length);
    for (let x = 0; x < w; x++) { let acc = 0;
      for (let y = -r; y < h + r; y++) {
        if (y + r < h && y + r >= 0) acc += b[(y + r) * w + x];
        const o = y - r - 1; if (o >= 0) acc -= b[o * w + x];
        if (y >= 0 && y < h) c[y * w + x] = acc / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
      } }
    a = c;
  }
  return a;
}

// ============================================================================
//  Baking: turn chc expression diffs into feathered patches aligned to the sprite
// ============================================================================
async function bakePose(cfg) {
  const ids = new Set([cfg.ref, cfg.blink.half, cfg.blink.closed]);
  for (const k in cfg.sem) { ids.add(cfg.sem[k][0]); if (cfg.sem[k][1]) ids.add(cfg.sem[k][1]); }
  const [sprite, base] = await Promise.all([loadImg(cfg.sprite), loadImg(`chc/${cfg.set}_base.png`)]);
  const imgs = {};
  await Promise.all([...ids].map(async id => { imgs[id] = await loadImg(`chc/${cfg.set}_${id}.png`); }));

  // sprite alpha (for mesh culling & hit testing)
  const SW = sprite.width, SH = sprite.height;
  const sc = mkCanvas(SW, SH), sx = ctx2d(sc); sx.drawImage(sprite, 0, 0);
  const spriteData = sx.getImageData(0, 0, SW, SH), sd = spriteData.data, spriteAlpha = new Uint8Array(SW * SH);
  for (let i = 0; i < SW * SH; i++) spriteAlpha[i] = sd[i * 4 + 3];
  const hair = hairMap(sd, SW, SH, cfg.strands);
  // split the tail into its own layer so it can swing/drag freely
  const rig = new Rig(cfg), tc = cfg.tail, pad = tc.mr + 4;
  rig.hair = hair;
  let tx0 = 1e9, ty0 = 1e9, tx1 = -1e9, ty1 = -1e9;
  for (const [x, y] of tc.pts) { tx0 = Math.min(tx0, x - pad); ty0 = Math.min(ty0, y - pad); tx1 = Math.max(tx1, x + pad); ty1 = Math.max(ty1, y + pad); }
  for (const e of tc.extra) { tx0 = Math.min(tx0, e.c[0] - e.rx - 4); ty0 = Math.min(ty0, e.c[1] - e.ry - 4); tx1 = Math.max(tx1, e.c[0] + e.rx + 4); ty1 = Math.max(ty1, e.c[1] + e.ry + 4); }
  tx0 = Math.max(0, Math.floor(tx0)); ty0 = Math.max(0, Math.floor(ty0)); tx1 = Math.min(SW, Math.ceil(tx1)); ty1 = Math.min(SH, Math.ceil(ty1));
  const tw = tx1 - tx0, th = ty1 - ty0, tailImg = new ImageData(tw, th), bodyImg = new ImageData(new Uint8ClampedArray(sd), SW, SH);
  const locks = hairLayer(sd, bodyImg.data, SW, SH, cfg, hair.lab); delete hair.lab;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const m = rig.tailMask(tx0 + x + 0.5, ty0 + y + 0.5); if (m <= 0) continue;
    const si = ((ty0 + y) * SW + tx0 + x) * 4, ti = (y * tw + x) * 4;
    tailImg.data[ti] = sd[si]; tailImg.data[ti + 1] = sd[si + 1]; tailImg.data[ti + 2] = sd[si + 2]; tailImg.data[ti + 3] = sd[si + 3] * m;
    // body keeps the feathered fringe fully opaque (tail layer is drawn behind), so no seam at rest
    if (m > 0.98) bodyImg.data[si + 3] = 0;
  }
  const tail = { img: tailImg, x: tx0, y: ty0, w: tw, h: th };
  const skirt = skirtLayer(sd, bodyImg.data, SW, SH, cfg, rig);
  // bits of the tail its mask misses (the top edge above the cut, the outline at the root, the feathered
  // fringe) are left as small islands on the body once the cloth has gone to the skirt layer; they go
  // with the tail, or they would stay behind as stray lines when it or the hem moves
  const bd = bodyImg.data, isl = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) isl[y * tw + x] = bd[((ty0 + y) * SW + tx0 + x) * 4 + 3] > 8 ? 1 : 0;
  regions(isl, tw, th, 1, (px, touches) => {
    if (touches || px.length > 800 || !px.some(p => rig.tailMask(tx0 + p % tw + 0.5, ty0 + (p / tw | 0) + 0.5) > 0)) return;
    for (const p of px) {
      const si = ((ty0 + (p / tw | 0)) * SW + tx0 + p % tw) * 4;
      for (let c = 0; c < 4; c++) tailImg.data[p * 4 + c] = sd[si + c];
      bd[si + 3] = 0;
    }
  });

  // bounding box of the patch area (union over all patches, chc space)
  const BW = base.width, BH = base.height, bc = mkCanvas(BW, BH), bx = ctx2d(bc);
  let x0 = BW, y0 = BH, x1 = 0, y1 = 0;
  for (const id of ids) {
    bx.clearRect(0, 0, BW, BH); bx.drawImage(imgs[id], 0, 0);
    const d = bx.getImageData(0, 0, BW, BH).data;
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) if (d[(y * BW + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const ox = Math.max(0, x0 - 2), oy = Math.max(0, y0 - 2), w = Math.min(BW, x1 + 3) - ox, h = Math.min(BH, y1 + 3) - oy, N = w * h;
  const cc = mkCanvas(w, h), cx = ctx2d(cc);
  const data = {};
  for (const id of ids) { cx.clearRect(0, 0, w, h); cx.drawImage(imgs[id], -ox, -oy); data[id] = cx.getImageData(0, 0, w, h); }
  // the sprite resampled into chc space, to cover the sprite's own expression
  const [a, b, c, d, e, f] = cfg.M, det = a * d - b * c;
  const ia = d / det, ib = -b / det, ic = -c / det, id_ = a / det, ie = (c * f - d * e) / det, iff = (b * e - a * f) / det;
  cx.clearRect(0, 0, w, h); cx.setTransform(ia, ib, ic, id_, ie - ox, iff - oy); cx.drawImage(sprite, 0, 0); cx.setTransform(1, 0, 0, 1, 0, 0);
  const tgt = cx.getImageData(0, 0, w, h).data;

  const ref = data[cfg.ref].data;
  const diff = (A, B, i) => Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
  // V: everywhere any expression differs from the reference (eyes, brows, mouth, blush)
  let V = new Float32Array(N);
  for (const id of ids) { const D = data[id].data; if (D === ref) continue;
    for (let i = 0; i < N; i++) if (D[i * 4 + 3] > 200 && ref[i * 4 + 3] > 200 && diff(D, ref, i * 4) > 20) V[i] = 1; }
  const fe = cfg.faceEllipse;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const p = j * w + i; if (ref[p * 4 + 3] < 200 || tgt[p * 4 + 3] < 200) continue;
    const u = ox + i, v = oy + j, X = a * u + c * v + e, Y = b * u + d * v + f;
    const ex = (X - fe.c[0]) / fe.rx, ey = (Y - fe.c[1]) / fe.ry;
    if (ex * ex + ey * ey < 1 && diff(tgt, ref, p * 4) > 26) V[p] = 1;
  }
  V = boxBlur(dilate(V, w, h, 8), w, h, 4, 3);
  // core: patch alpha, eroded & feathered so its polygon edge never shows
  let core = new Float32Array(N);
  for (let i = 0; i < N; i++) core[i] = ref[i * 4 + 3] > 250 ? 0 : 1;
  core = dilate(core, w, h, 4); for (let i = 0; i < N; i++) core[i] = 1 - core[i];
  core = boxBlur(core, w, h, 2, 2);
  const mask = new Float32Array(N);
  for (let i = 0; i < N; i++) mask[i] = Math.min(1, V[i] * 1.15) * core[i];
  // E: eye region for blinking (difference against the closed-eye frame, above the mouth)
  const closed = data[cfg.blink.closed].data, band = cfg.eyeBandMax - oy;
  let E = new Float32Array(N);
  for (const id of ids) { const D = data[id].data; if (D === closed) continue;
    for (let j = 0; j < Math.min(h, band); j++) for (let i = 0; i < w; i++) { const p = j * w + i;
      if (D[p * 4 + 3] > 200 && diff(D, closed, p * 4) > 34) E[p] = 1; } }
  E = boxBlur(dilate(E, w, h, 6), w, h, 3, 3);
  for (let i = 0; i < N; i++) E[i] = Math.min(1, E[i] * 1.2) * core[i] * (1 - Math.max(0, Math.min(1, ((i / w | 0) - band + 10) / 10)));

  const apply = (img, m) => { const o = new ImageData(new Uint8ClampedArray(img.data), w, h);
    for (let i = 0; i < N; i++) o.data[i * 4 + 3] = o.data[i * 4 + 3] * m[i]; return o; };
  const patches = {};
  for (const id of ids) patches[id] = apply(data[id], mask);
  const blinkHalf = apply(data[cfg.blink.half], E), blinkClosed = apply(data[cfg.blink.closed], E);
  return { sprite: bodyImg, spriteAlpha, SW, SH, hair, tail, locks, skirt, crop: { ox, oy, w, h }, mask, patches, blinkHalf, blinkClosed };
}

// The lower skirt gets its own layer as well, so lifting or pulling the hem never drags the legs
// along: only cloth (navy skirt, white frill and its shading; skin is warm) goes into it, with the
// soft edge where the hem lies on a leg. Under it the body gets each leg continued straight up
// (every column repeats the skin just below the hem) and nothing between or beside the legs.
function skirtLayer(sd, body, SW, SH, cfg, rig) {
  // the layer starts a little above where the hem starts to move, over an untouched body, so its
  // top edge never shows
  const sk = cfg.skirt, x0 = Math.max(0, sk.x[0]), x1 = Math.min(SW, sk.x[1]), y0 = Math.max(0, sk.y[0] - 8), y1 = Math.min(SH, sk.y[3] + 12), top = sk.y[0] + 4;
  const w = x1 - x0, h = y1 - y0, N = w * h, img = new ImageData(w, h), M = new Uint8Array(N);
  const px = (X, Y) => (Y * SW + X) * 4;
  const cloth = s => sd[s + 3] > 24 && (sd[s] - sd[s + 2]) + 0.5 * (sd[s] - sd[s + 1]) < 16;
  const tail = (X, Y) => rig.tailMask(X + 0.5, Y + 0.5) > 0.02;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (cloth(px(x0 + i, y0 + j)) && !tail(x0 + i, y0 + j)) M[j * w + i] = 1;
  // per column: where the leg starts under the hem, its skin colour a little lower, and its line art
  const YL = new Int32Array(w).fill(-1), leg = new Float32Array(w * 4), legN = new Float32Array(w), ink = new Float32Array(w * 4), inkN = new Float32Array(w);
  const dark = s => sd[s + 3] && (sd[s] + sd[s + 1] + sd[s + 2]) / 3 < 160;
  const addInk = (i, s) => { for (let c = 0; c < 4; c++) ink[i * 4 + c] += sd[s + c]; inkN[i]++; };
  for (let i = 0; i < w; i++) {
    const X = x0 + i, skin = Y => { const s = px(X, Y); return sd[s + 3] > 40 && !cloth(s) && !tail(X, Y); };
    let yc = -1; for (let j = h - 1; j >= 0; j--) if (M[j * w + i]) { yc = y0 + j; break; }
    if (yc < 0) continue;
    // the first solid skin under the hem; the blended rows above it are the hem's own edge
    // (a leg goes on below it: not just the soft edge of cloth against the background)
    let yl = -1;
    for (let Y = yc + 1; Y < Math.min(SH, yc + 8); Y++) if (skin(Y)) { yl = Y; break; }
    if (yl >= 0 && !(sd[px(X, Math.min(SH - 1, yl + 4)) + 3] > 128)) yl = -1;
    for (let Y = yc + 1; Y < (yl < 0 ? yc + 1 : yl) && Y < y1; Y++) M[(Y - y0) * w + i] = 1;
    // no leg under it: the hem's dark outline against the background goes with the cloth
    if (yl < 0) for (let Y = yc + 1; Y < Math.min(y1, yc + 5) && sd[px(X, Y) + 3] && !tail(X, Y); Y++) M[(Y - y0) * w + i] = 1;
    // where a thigh's outline runs on a slant, the skirt's lining shows beside it, so this column
    // ends in cloth: its leg is the run of skin between the hem and the lining, a little way up
    if (yl < 0) {
      let Y = yc; while (Y > yc - 60 && Y > y0 && !skin(Y)) Y--;
      if (Y > yc - 60 && Y > y0) { let yt = Y; while (yt > y0 && skin(yt - 1)) yt--; if (Y - yt >= 2) { yl = yt; if (dark(px(X, Y))) addInk(i, px(X, Y)); } }
    }
    if (yl < 0) continue;
    // skin a little further down, clear of the shadow the hem casts (the leg's soft outline included);
    // line art is kept apart, so an outline crossing these rows isn't drawn up the thigh as a streak
    YL[i] = yl;
    for (let Y = yl + 4; Y < Math.min(SH, yl + 9); Y++) {
      const s = px(X, Y); if (cloth(s) && sd[s + 3]) continue;
      if (dark(s)) { addInk(i, s); continue; }
      for (let c = 0; c < 4; c++) leg[i * 4 + c] += sd[s + c]; legN[i]++;
    }
  }
  // even out neighbouring columns a little so the continued thighs don't come out streaky; the
  // outermost column of each thigh takes the line art, inner ones never do
  const ext = i => i >= 0 && i < w && (inkN[i] || (legN[i] && leg[i * 4 + 3] / legN[i] > 128));
  const sm = new Float32Array(w * 4), smN = new Float32Array(w);
  for (let i = 0; i < w; i++) {
    if (!ext(i)) continue;
    if (inkN[i] && (!ext(i - 1) || !ext(i + 1))) { for (let c = 0; c < 4; c++) sm[i * 4 + c] = ink[i * 4 + c]; smN[i] = inkN[i]; continue; }
    for (let d = -1; d <= 1; d++) { const k = i + d; if (k < 0 || k >= w || !legN[k]) continue; for (let c = 0; c < 4; c++) sm[i * 4 + c] += leg[k * 4 + c] * (d ? 0.5 : 1); smN[i] += legN[k] * (d ? 0.5 : 1); }
    if (!smN[i]) { for (let c = 0; c < 4; c++) sm[i * 4 + c] = ink[i * 4 + c]; smN[i] = inkN[i]; }
  }
  // where the cloth meets something that stays (a slanted thigh, a hand, the tail's root), that is
  // carried on a couple of px under the cut edge, so the filtered edge of the layer can't let the
  // background through and no strip of cloth is left standing beside it when the skirt moves
  const O = new Float32Array(N); for (let k = 0; k < N; k++) if (!M[k] && sd[px(x0 + k % w, y0 + (k / w | 0)) + 3] > 128) O[k] = 1;
  const near = dilate(O, w, h, 2);
  const nearest = (i, j) => { let best = 1e9, q = -1;
    for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const ii = i + a, jj = j + b, d = a * a + b * b;
      if (ii >= 0 && jj >= 0 && ii < w && jj < h && O[jj * w + ii] && d < best) { best = d; q = px(x0 + ii, y0 + jj); } }
    return q; };
  for (let i = 0; i < w; i++) {
    const X = x0 + i, n = smN[i];
    for (let j = 0; j < h; j++) {
      const Y = y0 + j, s = px(X, Y), m = M[j * w + i];
      if (m) img.data.set([sd[s], sd[s + 1], sd[s + 2], sd[s + 3]], (j * w + i) * 4);
      // under the cloth, and the shadowed rows just under the hem: the leg carried on upwards
      // (behind the cloth's soft outer edge there is nothing, or it would show through at rest)
      if (Y < top || (!m && !(YL[i] >= 0 && Y >= YL[i] && Y < YL[i] + 3))) continue;
      if (n && sd[s + 3] > 200 && Y < YL[i] + 3) for (let c = 0; c < 4; c++) body[s + c] = sm[i * 4 + c] / n;
      else if (m) { const q = near[j * w + i] ? nearest(i, j) : -1; if (q < 0) body[s + 3] = 0; else for (let c = 0; c < 3; c++) body[s + c] = sd[q + c]; }
    }
  }
  return { img, x: x0, y: y0, w, h };
}

// Which pixels belong to the hair locks. Colour alone can't tell the grey hair from the
// greyish cardigan, so the hair is flood-filled from each strand's centre line over
// hair-coloured pixels and stopped by the dark line art. Clothes are walled off by their
// outline even where their colour matches.
function hairMap(sd, SW, SH, strands, step = 4) {
  const N = SW * SH, ok = new Uint8Array(N), wall = new Uint8Array(N), reg = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * 4; if (sd[i + 3] < 100) continue;
    const r = sd[i], g = sd[i + 1], b = sd[i + 2], lum = (r + g + b) / 3, warm = (r - b) + 0.5 * (r - g);
    if (lum < 125) { wall[p] = 1; continue; }                     // line art
    // cool grey; near-white is left out (frills), small highlights are taken back in below
    ok[p] = warm < 10 && b - r < 22 && lum < 236 ? 1 : 0;
  }
  // fill only within reach of a strand (a capsule a little wider than the lock)
  for (const st of strands) {
    if (st.anyColor) continue;
    const P = prepPoly(st.pts), R = st.r + st.f;
    let x0 = SW, y0 = SH, x1 = 0, y1 = 0;
    for (const [x, y] of st.pts) { x0 = Math.min(x0, x - R); y0 = Math.min(y0, y - R); x1 = Math.max(x1, x + R); y1 = Math.max(y1, y + R); }
    x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(SW - 1, x1 | 0); y1 = Math.min(SH - 1, y1 | 0);
    for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) if (polyNearest(x, y, P.pts, P.lens, P.total).d < R)
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) if (y + b < SH && x + a < SW) reg[(y + b) * SW + x + a] = 1;
  }
  // all strands fill at once, so each pixel is labelled (k+1) with the strand that reaches it first
  const fill = new Uint8Array(N), q = new Int32Array(N); let qn = 0;
  strands.forEach((st, k) => {
    if (st.anyColor) return;
    const P = prepPoly(st.pts);
    for (let s = 0; s <= 1; s += 1 / P.total) {
      let d = s * P.total, j = 0; while (j < P.lens.length - 1 && d > P.lens[j]) d -= P.lens[j++];
      const t = Math.min(1, d / P.lens[j]), a = P.pts[j], b = P.pts[j + 1];
      const x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t), p = y * SW + x;
      if (x >= 0 && y >= 0 && x < SW && y < SH && ok[p] && reg[p] && !fill[p]) { fill[p] = k + 1; q[qn++] = p; }
    }
  });
  for (let h = 0; h < qn; h++) {
    const p = q[h], x = p % SW;
    for (const n of [x > 0 ? p - 1 : -1, x < SW - 1 ? p + 1 : -1, p - SW, p + SW])
      if (n >= 0 && n < N && !fill[n] && ok[n] && reg[n]) { fill[n] = fill[p]; q[qn++] = n; }
  }
  // take in the hair's own outline (a few px) and the empty space around it, then go coarse
  const w = Math.ceil(SW / step), h = Math.ceil(SH / step), num = new Float32Array(w * h), den = new Float32Array(w * h);
  let m = new Float32Array(N); for (let p = 0; p < N; p++) m[p] = fill[p] ? 1 : 0;
  const near = dilate(m, SW, SH, 3), around = dilate(m, SW, SH, 10);
  for (let y = 0; y < SH; y += 2) for (let x = 0; x < SW; x += 2) {
    const p = y * SW + x, a = sd[p * 4 + 3] / 255;
    const v = fill[p] ? 1 : a < 0.4 ? around[p] : near[p];
    const k = ((y / step) | 0) * w + ((x / step) | 0); num[k] += v; den[k] += 1;
  }
  for (let i = 0; i < w * h; i++) num[i] /= den[i] || 1;
  const data = boxBlur(num, w, h, 1, 1);
  return { w, h, step, data, lab: fill };
}

// The twin tails swing far, so they are cut out into their own layer: on the shared mesh their
// motion stretched the sleeve they hang over. Each tail has a hand-traced outline (`poly` in
// config.js): it runs through the background on the outside, along the gap or line art that
// separates the tail from the side hair on the inside, and across the tail at the hair tie at
// the top. Everything inside goes, so a tail always moves as one piece; only where the outline
// overlaps the torso is the hair told apart from the sleeve by colour.
// Behind the cut the body keeps the original pixels near the tie (the root barely moves, so a
// swing uncovers more hair rather than a hole), shows the sleeve filled in from around it on the
// torso, carries the side hair a little way in under the tail's inner edge, and is empty everywhere else.
function hairLayer(sd, body, SW, SH, cfg, lab) {
  const torso = (x, y) => cfg.torso && inPoly(x, y, cfg.torso);
  const parts = cfg.strands.filter(st => st.layer && st.poly).map(st => ({ poly: st.poly, P: prepPoly(st.pts), keep: st.keep || 0.14,
    bend: !!st.bend, out: Math.sign(st.pts[0][0] - cfg.dome.c[0]) || 1 }));
  if (!parts.length) return null;
  let x0 = SW, y0 = SH, x1 = 0, y1 = 0;
  for (const p of parts) for (const [x, y] of p.poly) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0); x1 = Math.min(SW, Math.ceil(x1)); y1 = Math.min(SH, Math.ceil(y1));
  const w = x1 - x0, h = y1 - y0, N = w * h, at = k => ((y0 + (k / w | 0)) * SW + x0 + k % w);
  const part = new Int8Array(N).fill(-1), T = new Uint8Array(N), F = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const X = x0 + k % w + 0.5, Y = y0 + (k / w | 0) + 0.5;
    part[k] = parts.findIndex(p => inPoly(X, Y, p.poly));
    if (part[k] < 0) continue;
    T[k] = torso(X, Y) ? 1 : 0;
    if (lab[at(k)]) F[k] = 1;
  }
  // on the torso: the flood-filled hair, its inner line art closed up, and the outline around it
  const inv = a => { const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = 1 - a[i]; return o; };
  const closed = inv(dilate(inv(dilate(F, w, h, 4)), w, h, 4)), ring = dilate(closed, w, h, 2);
  const M = new Uint8Array(N), lumAt = k => { const s = at(k) * 4; return (sd[s] + sd[s + 1] + sd[s + 2]) / 3; };
  // a bending tail swings well clear of the sleeve, so neither the closing nor the pinhole filling may
  // take frill or cloth with it
  const cloth = k => { const s = at(k) * 4; return parts[part[k]].bend && T[k] && ((sd[s] - sd[s + 2]) + 0.5 * (sd[s] - sd[s + 1]) >= 10 || lumAt(k) >= 236); };
  for (let k = 0; k < N; k++) {
    if (part[k] < 0) continue;
    const a = sd[at(k) * 4 + 3], lum = lumAt(k); if (!a) continue;
    if (!T[k] || (ring[k] && ((closed[k] > 0.5 && !cloth(k)) || lum < 150 || a < 230))) M[k] = 1;
  }
  // on the torso: no specks of sleeve carried off, no pinholes left in the hair
  regions(M, w, h, 1, px => { let t = 0; for (const p of px) t += T[p]; if (px.length < 150 && t > px.length / 2) px.forEach(p => { M[p] = 0; }); });
  regions(M, w, h, 0, (px, touches) => !touches && px.length < 40 && px.forEach(p => { if (part[p] >= 0 && sd[at(p) * 4 + 3] && !cloth(p)) M[p] = 1; }));
  // A bending tail swings well clear of the sleeve it lies on, so what it uncovers there is rebuilt row
  // by row: cloth out to the sleeve's outer edge, the cloth's outline where the hair hid it, and
  // background beyond. The edge is the furthest cloth on each row, with the notches the strands lying
  // across it cut in bridged over (a closing of that profile), so the sleeve comes out whole.
  const edge = parts.map(p => p.bend && cfg.torso ? new Float32Array(h).fill(NaN) : null), hid = new Uint8Array(h * parts.length);
  let cc = null, ink = [0, 0, 0, 0];
  if (edge.some(e => e)) {
    const C = new Uint8Array(N);
    for (let k = 0; k < N; k++) C[k] = !M[k] && !lab[at(k)] && sd[at(k) * 4 + 3] >= 128 && torso(x0 + k % w + 0.5, y0 + (k / w | 0) + 0.5) ? 1 : 0;
    parts.forEach((p, q) => {
      if (!edge[q]) return;
      let i0 = w, i1 = 0; for (const [x] of p.poly) { i0 = Math.min(i0, x - x0 - 40); i1 = Math.max(i1, x - x0 + 40); }
      i0 = Math.max(0, i0 | 0); i1 = Math.min(w - 1, Math.ceil(i1));
      // v: how far out the cloth reaches on each row (-inf: none); dilated, then eroded, over ±R rows
      const R = 8, v = new Float32Array(h).fill(-Infinity), D = new Float32Array(h + 2 * R).fill(-Infinity), ce = new Float32Array(h).fill(NaN);
      for (let j = 0; j < h; j++) for (let i = i0; i <= i1; i++) if (C[j * w + i]) v[j] = Math.max(v[j], i * p.out);
      for (let t = 0; t < h + 2 * R; t++) for (let j = Math.max(0, t - 2 * R); j <= Math.min(h - 1, t); j++) D[t] = Math.max(D[t], v[j]);
      for (let j = 0; j < h; j++) {
        if (v[j] === -Infinity) continue;
        let e = Infinity; for (let t = j; t <= j + 2 * R; t++) e = Math.min(e, D[t]);
        ce[j] = e * p.out;
      }
      // where hair lies right against that edge (a tail looping across the sleeve), the sleeve's own
      // edge is hidden under it: there it runs on in a straight line between the nearest rows above
      // and below where it shows, if that is further out
      const covered = j => { for (let t = 1; t <= 5; t++) { const i = Math.round(ce[j]) + t * p.out; if (i >= 0 && i < w && lab[at(j * w + i)]) return true; } return false; };
      for (let j = 0, last = -1; j < h; j++) {
        if (ce[j] !== ce[j] || covered(j)) continue;
        if (last >= 0 && j - last > 1 && j - last < 160) for (let t = last + 1; t < j; t++) {
          const e = ce[last] + (ce[j] - ce[last]) * (t - last) / (j - last);
          if (ce[t] === ce[t] && (e - ce[t]) * p.out > 0) ce[t] = e;
        }
        last = j;
      }
      // (averaged over a few rows into a sub-pixel edge, so its outline comes out without steps)
      for (let j = 0; j < h; j++) {
        if (ce[j] !== ce[j]) continue;
        let sm = 0, n = 0; for (let t = Math.max(0, j - 3); t <= Math.min(h - 1, j + 3); t++) if (ce[t] === ce[t]) { sm += ce[t]; n++; }
        edge[q][j] = sm / n;
      }
      for (let j = 0; j < h; j++) {
        if (ce[j] !== ce[j]) continue;
        const e = Math.round(ce[j]), o = e + p.out;
        if (o >= 0 && o < w && M[j * w + o]) { hid[q * h + j] = 1; continue; }
        // the line art along the edge where it shows, for drawing it in where it is hidden
        for (let t = 0, i = e; t < 3 && i >= 0 && i < w; t++, i -= p.out) { const s = at(j * w + i) * 4; if ((sd[s] + sd[s + 1] + sd[s + 2]) / 3 < 125) { for (let c = 0; c < 3; c++) ink[c] += sd[s + c]; ink[3]++; break; } }
      }
    });
    ink = ink[3] ? ink.map(v => v / ink[3]) : [86, 76, 92];
    // (the fill takes its colours only from clean cloth, not the hair's soft edge just beside it)
    const H = new Float32Array(N); for (let k = 0; k < N; k++) H[k] = M[k] || lab[at(k)] ? 1 : 0;
    const nearH = dilate(H, w, h, 2), cw = new Float32Array(N); cc = new Float32Array(N * 4);
    for (let k = 0; k < N; k++) if (C[k] && nearH[k] < 0.5) { const s = at(k) * 4; cw[k] = 1; for (let c = 0; c < 3; c++) cc[k * 4 + c] = sd[s + c]; cc[k * 4 + 3] = 1; }
    pushPull(cc, cw, w, h);
  }
  // layer image; the sleeve under the hair on the torso is filled from the colours around it
  const img = new ImageData(w, h), col = new Float32Array(N * 4), wt = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const s = at(k) * 4, a = sd[s + 3] / 255;
    if (M[k]) { img.data.set([sd[s], sd[s + 1], sd[s + 2], sd[s + 3]], k * 4); continue; }
    if (lab[at(k)]) continue;
    wt[k] = 1; col[k * 4] = sd[s] * a; col[k * 4 + 1] = sd[s + 1] * a; col[k * 4 + 2] = sd[s + 2] * a; col[k * 4 + 3] = a;
  }
  pushPull(col, wt, w, h);
  // where a tail lies against hair that stays (side hair, the head around the tie), the body gets
  // that hair carried on a little way in under the tail, a shade darker as if in its shadow: a swing
  // then uncovers more hair rather than a gap, and no copy of the tail's own edge is left standing
  const O = new Uint8Array(N), hc = new Float32Array(N * 4), hw = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const s = at(k) * 4;
    if (part[k] >= 0 || sd[s + 3] < 128 || torso(x0 + k % w + 0.5, y0 + (k / w | 0) + 0.5)) continue;
    O[k] = 1;
    // hair colour as in hairMap: cool grey, no line art, no near-white frill
    const r = sd[s], g = sd[s + 1], b = sd[s + 2], lum = (r + g + b) / 3;
    if (sd[s + 3] > 200 && lum >= 125 && lum < 236 && (r - b) + 0.5 * (r - g) < 10 && b - r < 22) { hw[k] = 1; hc[k * 4] = r; hc[k * 4 + 1] = g; hc[k * 4 + 2] = b; hc[k * 4 + 3] = 1; }
  }
  pushPull(hc, hw, w, h);
  const dist = distMap(O, w, h);
  for (let k = 0; k < N; k++) {
    if (!M[k]) continue;
    const s = at(k) * 4, p = parts[part[k]], X = x0 + k % w + 0.5, Y = y0 + (k / w | 0) + 0.5;
    const E = edge[part[k]], j = k / w | 0, e = E ? E[j] : NaN;
    if (e === e) {
      const dOut = (k % w - e) * p.out;
      if (dOut <= 0) { for (let c = 0; c < 3; c++) body[s + c] = cc[k * 4 + c] / Math.max(1e-3, cc[k * 4 + 3]); body[s + 3] = 255; continue; }
      if (dOut < 2.4 && hid[part[k] * h + j]) { for (let c = 0; c < 3; c++) body[s + c] = ink[c]; body[s + 3] = 255 * Math.min(1, 2.4 - dOut); continue; }
      if (T[k]) { body[s + 3] = 0; continue; }
    } else if (T[k]) {
      const a = col[k * 4 + 3];
      for (let c = 0; c < 3; c++) body[s + c] = a > 0.01 ? col[k * 4 + c] / a : 0;
      body[s + 3] = smooth(0.35, 0.65, a) * 255;
      continue;
    }
    // near the tie the original stays underneath, fading out a little further down; next to the
    // torso the filled-in sleeve goes on a little way past its outline as well
    const along = polyNearest(X, Y, p.P.pts, p.P.lens, p.P.total).s;
    const keep = 1 - smooth(p.keep * 0.6, p.keep, along), oa = body[s + 3] / 255;
    // (a bending tail swings far clear, so its side hair only goes on a few px, or a band of it would
    // be left standing beside her arm)
    const wH = p.bend ? 1 - smooth(3, 7, dist[k]) : 1 - smooth(8, 20, dist[k]), wS = cfg.torso && !p.bend ? (1 - smooth(10, 22, polyEdge(X, Y, cfg.torso))) * smooth(0.35, 0.65, col[k * 4 + 3]) : 0;
    // (on a bending tail the shade comes in a few px from the edge, so no dark line shows along the cut,
    // and only where the tail is solid, so its faint strand tips leave no ghost behind)
    const fa = Math.max(wH, wS) * (p.bend ? smooth(0.55, 0.95, oa) : oa) * (1 - keep), A = keep * oa + fa, shade = p.bend ? 1 - 0.18 * smooth(2, 12, dist[k]) : 0.82;
    for (let c = 0; c < 3; c++) {
      const fill = wH + wS > 0.001 ? (wH * shade * hc[k * 4 + c] / Math.max(1e-3, hc[k * 4 + 3]) + wS * col[k * 4 + c] / Math.max(1e-3, col[k * 4 + 3])) / (wH + wS) : 0;
      body[s + c] = A > 0.004 ? (keep * oa * sd[s + c] + fa * fill) / A : 0;
    }
    body[s + 3] = A * 255;
  }
  return { img, x: x0, y: y0, w, h };
}
// approximate distance (px) from every pixel of a w*h mask to its nearest set pixel (two-pass chamfer)
function distMap(M, w, h) {
  const D = new Float32Array(w * h), r2 = Math.SQRT2;
  for (let k = 0; k < w * h; k++) D[k] = M[k] ? 0 : 1e6;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x; let d = D[k];
    if (x > 0) d = Math.min(d, D[k - 1] + 1);
    if (y > 0) { d = Math.min(d, D[k - w] + 1); if (x > 0) d = Math.min(d, D[k - w - 1] + r2); if (x < w - 1) d = Math.min(d, D[k - w + 1] + r2); }
    D[k] = d; }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const k = y * w + x; let d = D[k];
    if (x < w - 1) d = Math.min(d, D[k + 1] + 1);
    if (y < h - 1) { d = Math.min(d, D[k + w] + 1); if (x < w - 1) d = Math.min(d, D[k + w + 1] + r2); if (x > 0) d = Math.min(d, D[k + w - 1] + r2); }
    D[k] = d; }
  return D;
}
// 4-connected regions of value v in a w*h byte mask: cb(pixel indices, touches the border)
function regions(M, w, h, v, cb) {
  const seen = new Uint8Array(M.length), q = new Int32Array(M.length);
  for (let st = 0; st < M.length; st++) {
    if (seen[st] || M[st] !== v) continue;
    let qn = 0, touches = false; q[qn++] = st; seen[st] = 1;
    for (let hd = 0; hd < qn; hd++) {
      const p = q[hd], x = p % w, y = p / w | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      if (x > 0 && !seen[p - 1] && M[p - 1] === v) { seen[p - 1] = 1; q[qn++] = p - 1; }
      if (x < w - 1 && !seen[p + 1] && M[p + 1] === v) { seen[p + 1] = 1; q[qn++] = p + 1; }
      if (y > 0 && !seen[p - w] && M[p - w] === v) { seen[p - w] = 1; q[qn++] = p - w; }
      if (y < h - 1 && !seen[p + w] && M[p + w] === v) { seen[p + w] = 1; q[qn++] = p + w; }
    }
    cb(Array.from(q.subarray(0, qn)), touches);
  }
}
// fill unknown pixels (wt<1) of a premultiplied RGBA image from coarser averages, bilinear upsampled
function pushPull(col, wt, w, h) {
  if (w <= 1 && h <= 1) return;
  const w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2), c2 = new Float32Array(w2 * h2 * 4), t2 = new Float32Array(w2 * h2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, t = wt[k]; if (!t) continue;
    const K = (j >> 1) * w2 + (i >> 1); t2[K] += t; for (let c = 0; c < 4; c++) c2[K * 4 + c] += col[k * 4 + c] * t;
  }
  for (let K = 0; K < w2 * h2; K++) { if (t2[K] > 0) for (let c = 0; c < 4; c++) c2[K * 4 + c] /= t2[K]; t2[K] = Math.min(1, t2[K]); }
  pushPull(c2, t2, w2, h2);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, t = wt[k]; if (t >= 1) continue;
    const fx = Math.min(w2 - 1, Math.max(0, (i + 0.5) / 2 - 0.5)), fy = Math.min(h2 - 1, Math.max(0, (j + 0.5) / 2 - 0.5));
    const a = fx | 0, b = fy | 0, u = fx - a, v = fy - b, a1 = Math.min(w2 - 1, a + 1), b1 = Math.min(h2 - 1, b + 1);
    for (let c = 0; c < 4; c++) {
      const val = (c2[(b * w2 + a) * 4 + c] * (1 - u) + c2[(b * w2 + a1) * 4 + c] * u) * (1 - v) + (c2[(b1 * w2 + a) * 4 + c] * (1 - u) + c2[(b1 * w2 + a1) * 4 + c] * u) * v;
      col[k * 4 + c] = col[k * 4 + c] * t + val * (1 - t);
    }
  }
}

// ============================================================================
//  WebGL
// ============================================================================
const stage = $('#stage');
const gl = stage.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: true });
if (!gl) { $('#loadText').textContent = '此浏览器不支持 WebGL2'; throw new Error('no webgl2'); }
const VS = `#version 300 es
in vec2 aPos; in vec2 aUV; uniform mat3 uView; out vec2 vUV;
void main(){ vec3 p = uView * vec3(aPos, 1.0); gl_Position = vec4(p.xy, 0.0, 1.0); vUV = aUV; }`;
const FS = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uTex; uniform float uAlpha; uniform vec4 uColor; uniform int uMode; out vec4 o;
void main(){ if (uMode == 1) { o = vec4(uColor.rgb * uColor.a, uColor.a) * uAlpha; return; }
  o = texture(uTex, vUV) * uAlpha; }`;
function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
const prog = gl.createProgram();
gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
gl.bindAttribLocation(prog, 0, 'aPos'); gl.bindAttribLocation(prog, 1, 'aUV'); gl.linkProgram(prog);
const U = {}; for (const n of ['uView', 'uTex', 'uAlpha', 'uColor', 'uMode']) U[n] = gl.getUniformLocation(prog, n);
gl.useProgram(prog);
gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

function makeTex(src) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// Grid mesh over a rectangle; `keep(i,j)` decides which cells exist.
class Mesh {
  constructor(rig, nx, ny, toSprite, keep, layer = 'body') {
    const rest = [], uv = [], map = new Int32Array((nx + 1) * (ny + 1)).fill(-1), idx = [], lines = [];
    const vid = (i, j) => { const k = j * (nx + 1) + i; if (map[k] < 0) { map[k] = rest.length / 2; const [x, y] = toSprite(i / nx, j / ny); rest.push(x, y); uv.push(i / nx, j / ny); } return map[k]; };
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!keep(i, j)) continue;
      const a = vid(i, j), b = vid(i + 1, j), c = vid(i, j + 1), d = vid(i + 1, j + 1);
      idx.push(a, b, d, a, d, c); lines.push(a, b, a, c, a, d, b, d, c, d);
    }
    this.rest = new Float32Array(rest); this.pos = new Float32Array(rest); this.count = idx.length; this.lineCount = lines.length;
    this.W = rig.weights(this.rest, layer);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    this.pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.pb); gl.bufferData(gl.ARRAY_BUFFER, this.pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    this.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.lb = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lb); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(lines), gl.STATIC_DRAW);
  }
  update(rig, P) {
    rig.deform(this.rest, this.W, P, this.pos);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pos);
  }
  draw(tex, alpha) {
    if (alpha <= 0.002) return;
    gl.bindVertexArray(this.vao); gl.uniform1i(U.uMode, 0); gl.uniform1f(U.uAlpha, alpha);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.uTex, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib); gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
  }
  wire(color, alpha) {
    gl.bindVertexArray(this.vao); gl.uniform1i(U.uMode, 1); gl.uniform4fv(U.uColor, color); gl.uniform1f(U.uAlpha, alpha);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.lb); gl.drawElements(gl.LINES, this.lineCount, gl.UNSIGNED_INT, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib);
  }
}

// Build all GPU resources for one pose
function buildPose(key, cfg, baked) {
  const rig = new Rig(cfg);
  rig.hair = baked.hair; rig.split = !!baked.locks; rig.splitSkirt = !!baked.skirt;
  const { SW, SH, spriteAlpha } = baked;
  // sprite mesh: 12px cells, culled where fully transparent
  const step = 12, nx = Math.ceil(SW / step), ny = Math.ceil(SH / step);
  const occ = new Uint8Array(nx * ny);
  for (let y = 0; y < SH; y += 2) for (let x = 0; x < SW; x += 2) if (spriteAlpha[y * SW + x] > 0) occ[((y / step) | 0) * nx + ((x / step) | 0)] = 1;
  const keepS = (i, j) => { for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < nx && jj < ny && occ[jj * nx + ii]) return true; } return false; };
  const spriteMesh = new Mesh(rig, nx, ny, (u, v) => [Math.min(SW, u * nx * step), Math.min(SH, v * ny * step)], keepS);
  // the uv of the last column/row must match the clamped position
  { const uvFix = new Float32Array(spriteMesh.rest.length); for (let i = 0; i < uvFix.length; i += 2) { uvFix[i] = spriteMesh.rest[i] / SW; uvFix[i + 1] = spriteMesh.rest[i + 1] / SH; }
    gl.bindVertexArray(spriteMesh.vao); const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, uvFix, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null); }

  // cut-out layer meshes (tail, twin tails) over their bounding boxes
  const layerMesh = (T, tstep, layer) => {
    const tnx = Math.ceil(T.w / tstep), tny = Math.ceil(T.h / tstep);
    const keepT = (i, j) => { for (let y = Math.max(0, j * tstep - 8); y < Math.min(T.h, (j + 1) * tstep + 8); y += 2) for (let x = Math.max(0, i * tstep - 8); x < Math.min(T.w, (i + 1) * tstep + 8); x += 2) if (T.img.data[(y * T.w + x) * 4 + 3] > 0) return true; return false; };
    const m = new Mesh(rig, tnx, tny, (u, v) => [T.x + u * tnx * tstep, T.y + v * tny * tstep], keepT, layer);
    // uv must account for the grid overshooting the image
    const uv = new Float32Array(m.rest.length); for (let i = 0; i < uv.length; i += 2) { uv[i] = (m.rest[i] - T.x) / T.w; uv[i + 1] = (m.rest[i + 1] - T.y) / T.h; }
    gl.bindVertexArray(m.vao); const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
    return m;
  };
  const T = baked.tail, tailMesh = layerMesh(T, 8, 'tail');
  const L = baked.locks, locksMesh = L && layerMesh(L, 8, 'locks');
  const K = baked.skirt, skirtMesh = layerMesh(K, 8, 'skirt');

  // expression patch mesh, in chc space mapped through M
  const { ox, oy, w, h } = baked.crop, M = cfg.M, pstep = 8;
  const pnx = Math.ceil(w / pstep), pny = Math.ceil(h / pstep);
  const keepP = (i, j) => { for (let y = Math.max(0, j * pstep - 6); y < Math.min(h, (j + 1) * pstep + 6); y += 2) for (let x = Math.max(0, i * pstep - 6); x < Math.min(w, (i + 1) * pstep + 6); x += 2) if (baked.mask[y * w + x] > 0.003) return true; return false; };
  const patchMesh = new Mesh(rig, pnx, pny, (u, v) => { const X = ox + u * w, Y = oy + v * h; return [M[0] * X + M[2] * Y + M[4], M[1] * X + M[3] * Y + M[5]]; }, keepP);

  // procedural blush overlay
  const [c0, c1] = cfg.cheeks, bx0 = c0.c[0] - 70, by0 = Math.min(c0.c[1], c1.c[1]) - 45, bw = c1.c[0] - c0.c[0] + 140, bh = 100;
  const bcv = mkCanvas(512, Math.round(512 * bh / bw)), bctx = bcv.getContext('2d'), k = 512 / bw;
  for (const ch of cfg.cheeks) {
    const X = (ch.c[0] - bx0) * k, Y = (ch.c[1] - by0 + 4) * k;
    const g = bctx.createRadialGradient(X, Y, 0, X, Y, 46 * k); g.addColorStop(0, 'rgba(255,120,150,.55)'); g.addColorStop(1, 'rgba(255,120,150,0)');
    bctx.fillStyle = g; bctx.save(); bctx.translate(X, Y); bctx.scale(1.35, 0.8); bctx.translate(-X, -Y); bctx.fillRect(0, 0, bcv.width, bcv.height); bctx.restore();
    bctx.strokeStyle = 'rgba(230,80,110,.55)'; bctx.lineWidth = 2.2 * k * 0.5; bctx.lineCap = 'round';
    for (let q = -1; q <= 1; q++) { bctx.beginPath(); bctx.moveTo(X + q * 12 * k - 4 * k, Y + 5 * k); bctx.lineTo(X + q * 12 * k + 4 * k, Y - 5 * k); bctx.stroke(); }
  }
  const blushMesh = new Mesh(rig, 16, 6, (u, v) => [bx0 + u * bw, by0 + v * bh], () => true);

  const tex = {};
  for (const id in baked.patches) tex[id] = makeTex(baked.patches[id]);
  return {
    key, cfg, rig, baked, spriteMesh, patchMesh, blushMesh, tailMesh, tailTex: makeTex(T.img), locksMesh, locksTex: L && makeTex(L.img), skirtMesh, skirtTex: makeTex(K.img),
    spriteTex: makeTex(baked.sprite), tex, blinkHalf: makeTex(baked.blinkHalf), blinkClosed: makeTex(baked.blinkClosed), blushTex: makeTex(bcv),
  };
}

// ============================================================================
//  Simulation state
// ============================================================================
const spr = (x = 0) => ({ x, v: 0 });
function stepSpring(o, target, k, c, dt) { o.v += (-(o.x - target) * k - o.v * c) * dt; o.x += o.v * dt; }

let pose = null; const poses = {};
const S = {
  t: 0, ax: spr(), ay: spr(), roll: spr(), bodyX: spr(), bodyRoll: spr(), headDX: spr(), headDY: spr(),
  ears: [spr(), spr()], earPull: [null, null], hair: [], tail: spr(), tailWave: 0.05, tailDrag: null, hairDrag: null,
  skirt: spr(), squash: spr(), hop: 0, hopV: 0, pokes: [], blush: spr(0.15),
  gaze: { x: 0, y: 0, cx: null, cy: null, active: false }, look: null,
  lastMouse: 0, wakeGrace: 0, anim: null, carry: null, skirtPull: null, skirtSpring: null,
  blink: { next: 2, t: -1, double: false }, eyeClose: spr(0),
  face: { cur: null, prev: null, fade: 1, sem: 'neutral', until: 0, idleSem: 'neutral' },
  talkUntil: 0, mouth: 0,
  aff: 0.3, ang: 0, lastInput: 0, sleep: 0, angryUntil: 0, idleNext: 4,
  drag: null, pokeTimes: [], globalAlpha: 1, switching: false,
  leanS: spr(), leanT: 0, giggleUntil: 0, flatUntil: 0, tailPhase: 0, tailFreq: 5, tailBase: 0.045,
  love: false, loveArmed: true, lovePending: false, loveGlow: 0,   // full-affection moment (ANIMS.love)
  manual: {}, opt: { follow: true, wind: true, idle: true, mesh: false },
};

function params() {
  return {
    t: S.t, angleX: S.ax.x, angleY: S.ay.x, roll: S.roll.x, headDX: S.headDX.x, headDY: S.headDY.x,
    breath: S.breath, bodyRoll: S.bodyRoll.x, bodyX: S.bodyX.x,
    ear: S.ears.map(e => e.x), earPull: S.earPull, hair: S.hair.map(h => h.x), hairDrag: S.hairDrag,
    tailAngle: S.tail.x, tailWave: S.tailWave, tailPhase: S.tailPhase, tailDrag: S.tailDrag, skirt: S.skirt.x,
    pokes: S.pokes, squash: S.squash.x, hop: S.hop, skirtPull: S.skirtPull,
  };
}

// ---------------------------------------------------------------- expressions
function semId(sem) { const s = pose.cfg.sem[sem] || pose.cfg.sem.neutral; return s; }
function setFace(sem, dur = 2.5) { S.face.sem = sem; S.face.until = dur == null ? Infinity : S.t + dur; }
function defaultFace() {
  if (S.sleep >= 2) return 'closed';
  if (S.sleep >= 1) return 'sleepy';
  if (S.angryUntil > S.t) return S.ang > 1.2 ? 'jito' : 'pout';
  return S.face.idleSem;
}
function updateFace(dt) {
  const sem = S.face.until > S.t ? S.face.sem : defaultFace();
  const id = semId(sem)[0];
  if (id !== S.face.cur) { S.face.prev = S.face.fade < 0.5 && S.face.prev ? S.face.prev : S.face.cur; S.face.cur = id; S.face.fade = 0; S.face.curSem = sem; }
  S.face.fade = Math.min(1, S.face.fade + dt * 9);
}

// ---------------------------------------------------------------- speech bubble
const bubble = $('#bubble'), bubbleText = $('#bubbleText');
let typing = null, bubbleHide = 0;
// opt: { ja: Japanese for the voice, kind: 'react' | 'chat' } (see Voice.speak)
function say(text, sem, dur, opt = {}) {
  if (sem) setFace(sem, dur || Math.max(2.2, text.length * 0.16));
  bubble.classList.remove('hidden');
  let i = 0; clearInterval(typing); bubbleText.textContent = '';
  typing = setInterval(() => { i++; bubbleText.textContent = text.slice(0, i); if (i >= text.length) clearInterval(typing); }, 55);
  S.talkUntil = S.t + text.replace(/[…～♪！？\s.]/g, '').length * 0.055 + 0.15;
  bubbleHide = S.t + Math.max(2.4, text.length * 0.16 + 1.2);
  // spoken aloud: once the audio plays her mouth follows it instead of the typing
  if (opt.voice !== false) Voice.speak(text, opt);
}
let ambientNext = 0, ambientFrequency = null, ambientPending = false;
async function ambientMoment() {
  const minutes = Store.data.ambientMinutes;
  if (minutes !== ambientFrequency) {
    ambientFrequency = minutes;
    ambientNext = S.t + rand(minutes, minutes * 2) * 60;
  }
  const available = () => minutes > 0 && minutes === Store.data.ambientMinutes && S.opt.idle && !S.sleep &&
    !S.drag && !S.anim && !S.switching && S.angryUntil <= S.t &&
    !Rec.on && !CompanionUI.busy() && !CompanionUI.talking && !CompanionUI.queued &&
    $('#settings').classList.contains('hidden') && bubble.classList.contains('hidden');
  if (ambientPending || S.t < ambientNext || !available()) return;
  ambientPending = true;
  const userInput = S.lastInput;
  const allowed = () => !window.petAPI || CompanionUI.call('ambientAllowed').catch(() => false);
  try {
    if (!await allowed() || !available()) return;
    ambientNext = S.t + 30;
    const [text, face, animation] = idleMoment();
    const opt = { kind: 'ambient' };
    const buffer = await Voice.prepareAnimation(text, opt);
    if (!available() || S.lastInput !== userInput || !await allowed() || !available() || S.lastInput !== userInput) return;
    ambientNext = S.t + rand(minutes, minutes * 2) * 60;
    startAnim(animation);
    S.anim.ambient = true;
    say(text, face, 2.5, { ...opt, buffer, voice: !!buffer });
  } finally { ambientPending = false; }
}
// "…" while she thinks of an answer
function think(sec = 25) {
  clearInterval(typing); bubble.classList.remove('hidden');
  bubbleText.innerHTML = '<span class="dots"><b></b><b></b><b></b></span>'; bubbleHide = S.t + sec;
}

// ---------------------------------------------------------------- reactions: fixed lines or AI
// A reaction line for an event key of LINES. When AI reactions are on, the touch is described
// to the model and its answer replaces the fixed line; the body reacts at once either way.
// A newer reaction always supersedes a pending one (AI.seq), and touches that come too fast
// after the last request fall back to the fixed lines so nothing piles up.
function line(key, sem, dur) {
  const id = ++AI.seq, desc = EVENT_DESC[key];
  if (!desc || !Store.data.aiReact || !AI.ready() || (Rec.on && !Rec.ai) || S.t - AI.lastAt < 1.5) { say(pickLine(LINES[key]), sem, dur); return; }
  AI.lastAt = S.t;
  if (sem) setFace(sem, dur || 6);
  think();
  AI.interacting++;
  AI.ask(`[互动] 对方${desc}。`, aiState(), { remember: false })
    // with a voice, the words wait (still "…") until the audio is ready, so both come together
    .then(async o => { if (id !== AI.seq) return; await Voice.prepare(o.reply, { ja: o.ja }, 6000); if (id === AI.seq) applyAI(o, sem, dur, false); })
    .catch(e => { if (id !== AI.seq) return; say(pickLine(LINES[key]), sem, dur); aiFailed(e); })
    .finally(() => { AI.interacting--; });
}
// in recording mode every reaction says the first line of its list, so takes match the storyboard
const pickLine = a => Rec.on ? a[0] : pick(a);
function aiState() {
  const mood = S.sleep >= 2 ? '正在睡觉' : S.sleep ? '有点困' : S.angryUntil > S.t ? '正在赌气' : '';
  return { aff: S.aff, ang: S.ang, mood };
}
function applyAI(o, sem, dur, withAffection) {
  say(o.reply, o.emotion || sem || 'smile', dur && dur < 50 ? Math.max(dur, o.reply.length * 0.16) : dur, { ja: o.ja, kind: withAffection ? 'chat' : 'react' });
  doAction(o.action);
  if (withAffection && o.affection) o.affection > 0 ? please(o.affection * 0.5) : annoy(-o.affection * 0.6);
}
function doAction(a) {
  const top = headTop();
  if (a === 'hop') hop();
  else if (a === 'swish') swish(1.3);
  else if (a === 'twitch') twitchEars();
  else if (a === 'blush') S.blush.x = 1;
  else if (a === 'hearts') emit('heart', top[0], top[1], 3);
  else if (a === 'sweat') emit('sweat', top[0] + 60, top[1] + 60, 2, { life: 1.1 });
  else if (a === 'anger') emit('anger', top[0] + 70, top[1] + 30, 1, { life: 1.6, size: 30 });
  else if (a === 'notes') emit('note', top[0], top[1] + 20, 3, { size: 22 });
  else if (a === 'sleep') { S.sleep = 1; S.wakeGrace = S.t + 4; }
}
let aiErrShown = 0;
function aiFailed(e) {
  console.warn('AI request failed', e);
  if (S.t - aiErrShown > 30 && typeof toast === 'function') { aiErrShown = S.t; toast('AI 请求失败：' + e.message, 2600, 'pout'); }
}

// ---------------------------------------------------------------- particles
const particles = [];
function emit(type, x, y, n = 1, opts = {}) {
  for (let i = 0; i < n; i++) particles.push({ type, x: x + rand(-14, 14), y: y + rand(-8, 8), vx: rand(-30, 30) + (opts.vx || 0), vy: rand(-90, -50) + (opts.vy || 0), life: 0, max: opts.life || rand(1.0, 1.6), size: opts.size || rand(14, 22), rot: rand(-0.4, 0.4) });
}

// ============================================================================
//  View / coordinates
// ============================================================================
const under = $('#under'), over = $('#over'), uctx = under.getContext('2d'), octx = over.getContext('2d');
const view = { s: 1, ox: 0, oy: 0, dpr: 1, W: 0, H: 0 };
const PET = document.documentElement.classList.contains('pet');
const PET_BAND = 90 / 690, PET_SIDE = 380;   // match PET_H / SIDE in electron/main.js
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  for (const c of [stage, under, over]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  view.dpr = dpr; view.W = W; view.H = H;
  // character occupies roughly x 160..860, y 0..1520 of the sprite
  if (PET) {
    // desktop pet: she stands under a band kept free for her speech bubble and the menu; the chat /
    // settings panel takes its own strip on the left (the shell widens the window for it)
    const side = document.documentElement.classList.contains('side') ? Math.min(PET_SIDE, W * 0.6) : 0;
    const availW = W - side, availH = H * (1 - PET_BAND);
    const s = Math.min((availH * 0.98) / 1525, (availW * 0.98) / 720);
    view.s = s; view.ox = side + availW / 2 - 512 * s; view.oy = H - 1525 * s;
  } else {
    // keep her centred in the space left between the chat (left) and the panel (right)
    const panelOpen = panelShown() && W > 760;
    const left = !$('#chat').classList.contains('hidden') && W > 760 ? 370 : 0;
    const availW = W - left - (panelOpen ? 316 : 0);
    const s = Math.min((H * 0.97) / 1520, (availW * 0.95) / 760);
    view.s = s; view.ox = left + availW / 2 - 512 * s; view.oy = H - 1525 * s - H * 0.01;
    if (W <= 760) view.oy = Math.min(view.oy, H * 0.02);
  }
  const zq = new URLSearchParams(location.search).get('zoom'); // debug: zoom=cx,cy,scale (sprite px)
  if (zq) { const [zx, zy, zs] = zq.split(',').map(Number); view.s = zs; view.ox = W / 2 - zx * zs; view.oy = H / 2 - zy * zs; }
  gl.viewport(0, 0, stage.width, stage.height);
}
// the control panel, unless closed or hidden for a clean recording
const panelShown = () => !$('#panel').classList.contains('closed') && !document.documentElement.classList.contains('rec-clean');
const toSprite = (cx, cy) => [(cx - view.ox) / view.s, (cy - view.oy) / view.s];
const toScreen = (x, y) => [x * view.s + view.ox, y * view.s + view.oy];

// ============================================================================
//  Hit testing (rest space, compensating for the current head offset)
// ============================================================================
function hitTest(x, y) {
  const c = pose.cfg, rig = pose.rig, P = params();
  const d0 = rig.point(c.dome.c[0], c.dome.c[1], P), hx = x - (d0[0] - c.dome.c[0]), hy = y - (d0[1] - c.dome.c[1]);
  for (let k = 0; k < rig.ears.length; k++) {
    const e = rig.ears[k], n = polyNearest(hx, hy, e.P.pts, e.P.lens, e.P.total);
    const along = ((hx - e.pivot[0]) * (e.tip[0] - e.pivot[0]) + (hy - e.pivot[1]) * (e.tip[1] - e.pivot[1])) / (e.len * e.len);
    if (n.d < e.r + 6 && along > 0.1 && along < 1.25) return { type: 'ear', k };
  }
  const tn = polyNearest(x, y, rig.tailP.pts, rig.tailP.lens, rig.tailP.total);
  if (tn.d < c.tail.r + 16 && tn.s > (c.tail.s0 || 0) + 0.1) return { type: 'tail', s: tn.s };
  for (const ch of c.cheeks) if (Math.hypot(hx - ch.c[0], hy - ch.c[1]) < ch.r + 6) return { type: 'cheek' };
  const inE = (e, px, py) => ((px - e.c[0]) / e.rx) ** 2 + ((py - e.c[1]) / e.ry) ** 2 < 1;
  for (const z of c.zones) if (z.head && inE(z, hx, hy)) return { type: z.type };
  if (inE(c.crown, hx, hy)) return { type: 'head' };
  if (inE(c.dome, hx, hy) && hy > c.dome.c[1] - 20) return { type: 'face' };
  for (let k = 0; k < rig.strands.length; k++) {
    const st = rig.strands[k]; if (!st.grab) continue;
    const n = polyNearest(x, y, st.P.pts, st.P.lens, st.P.total);
    const b = pose.baked, opaque = () => b.spriteAlpha[Math.round(Math.min(b.SH - 1, Math.max(0, y))) * b.SW + Math.round(Math.min(b.SW - 1, Math.max(0, x)))] > 40;
    if (st.poly ? n.s > 0.25 && inPoly(x, y, st.poly) && (n.d < st.r * 0.8 || opaque()) : n.d < st.r * 0.8 && n.s > 0.3) return { type: 'hair', k, s: n.s };
  }
  if (inE(c.head, hx, hy)) return { type: 'head' };
  // body zones in rest space: undo the hop lift and the sway of the upper body
  const by = y + S.hop, bx = x - S.bodyX.x * 7 * (1 - smoothstep(700, 1040, by));
  for (const z of c.zones) if (!z.head && inE(z, bx, by)) return { type: z.type };
  const xi = Math.round(x), yi = Math.round(y), b = pose.baked;
  if (xi >= 0 && yi >= 0 && xi < b.SW && yi < b.SH && b.spriteAlpha[yi * b.SW + xi] > 40) return { type: 'body' };
  return null;
}

// ============================================================================
//  Behaviour / reactions
// ============================================================================
function touch() {
  CompanionUI.activity();
  S.lastInput = S.t;
  if (S.sleep > 0) wake();
}
// any mouse movement (anywhere on screen on the desktop) counts; she only dozes off when it stops
function activity() {
  S.lastMouse = S.t;
  if (S.sleep > 0 && S.t > S.wakeGrace) wake();
}
function wake() {
  const deep = S.sleep >= 2; S.sleep = 0; S.lastInput = S.t;
  startAnim(deep ? 'wake' : 'rouse');
}
function quietFor() { return S.t - Math.max(S.lastInput, S.lastMouse); }

// ---------------------------------------------------------------- acted moments
// Idle fidgets and waking up. f(u) gives targets for u seconds in, blended in by simulate():
// gx/gy gaze, roll/hdx/hdy head, eye closing, sq squash (+ taller), tail, flat ears, lean.
// cues fire once at their time.
const env = (u, a, b, c, d) => smoothstep(a, b, u) * (1 - smoothstep(c, d, u));
const notes = () => { const [x, y] = headTop(); emit('note', x + rand(60, 130), y + 30, 1, { size: 22, vx: 30 }); };
const ANIMS = {
  lookAround: { dur: 4.4, f: u => ({ gx: u < 1.5 ? -0.8 : u < 3 ? 0.8 : 0, gy: u < 3 ? 0.05 : null }),
    cues: [[0.15, () => twitchEars(0)], [1.6, () => twitchEars(1)], [3.1, () => setFace('curious', 1.2)]] },
  hum: { dur: 5, f: u => { const b = Math.sin(u * Math.PI * 1.6), e = env(u, 0, 0.4, 4.4, 5);
      return { roll: 0.07 * b * e, gx: 0.25 * Math.sin(u * Math.PI * 0.8) * e, gy: -0.12 * e, hdy: 2.5 * Math.abs(b) * e, tail: 0.3 * b * e, eye: 0.6 * e }; },
    cues: [[0, () => setFace('enjoy', 4.6)], [0.4, notes], [1.6, notes], [2.8, notes], [4, notes]] },
  stretch: { dur: 3.6, f: u => { const s = env(u, 0.5, 1.1, 2.3, 3.0);
      return { sq: u < 0.5 ? -0.02 * env(u, 0, 0.2, 0.35, 0.5) : 0.035 * s, gy: -0.6 * s, roll: 0.05 * Math.sin(u * 3) * s, eye: s, flat: 0.3 * s, tail: 0.4 * s }; },
    cues: [[0.45, () => setFace('yawn', 1.9)], [2.4, () => twitchEars()]] },
  sneeze: { dur: 2.9, f: u => {
      if (u < 1.15) { const b = smoothstep(0, 1.1, u); return { gy: -0.4 * b, hdy: -3 * b, eye: 0.55 * b }; }
      const after = u - 1.15, k = Math.exp(-after * 2.5);
      return { gy: 0.45 * k, eye: after < 0.4 ? 1 : 0, hdx: Math.sin(after * 28) * 3 * smoothstep(0.5, 0.7, after) * k * 2 };
    },
    cues: [[0.05, () => setFace('troubled', 1.2)], [1.15, () => { setFace('closed', 0.6); S.squash.v -= 1.3; S.headDY.v += 150; twitchEars(); swish(1.4); kick(0.2); }],
      [1.9, () => setFace('shy', 1.8)]] },
  tailPlay: { dur: 3.8, f: u => { const side = Math.sign(pose.rig.tailRoot[0] - 512) || 1, e = env(u, 0, 0.3, 3.2, 3.8);
      return { gx: side * 0.65 * e, gy: 0.5 * e, roll: side * 0.06 * e, tail: 0.5 * Math.sin(u * 7) * e }; },
    cues: [[0.1, () => setFace('curious', 2.6)], [0.6, () => swish(1.2)], [1.4, () => swish(1.4)], [2.2, () => swish(1)], [2.9, () => { setFace('happy', 1.2); kick(0.3); }]] },
  earFlick: { dur: 1.8, f: u => ({ roll: 0.05 * Math.sin(u * 9) * env(u, 0, 0.2, 1.4, 1.8) }),
    cues: [[0.1, () => twitchEars(0)], [0.45, () => twitchEars(1)], [0.8, () => twitchEars(0)], [1.1, () => twitchEars(1)]] },
  peek: { dur: 3.2, f: u => { const e = env(u, 0, 0.5, 2.5, 3.2);
      return { gx: (S.gaze.active ? S.gaze.x : 0) * e, gy: 0.2 * e, hdy: 7 * e, roll: -0.08 * Math.sign(S.gaze.x || 1) * e }; },
    cues: [[0.3, () => setFace('curious', 2.4)]] },
  doze: { dur: 3.6, f: u => { const d = smoothstep(0, 2.4, u) * (u < 2.5 ? 1 : Math.exp(-(u - 2.5) * 6));
      return { gy: 0.55 * d, hdy: 7 * d, roll: 0.07 * d, eye: u < 2.5 ? 0.3 + 0.7 * d : 0 }; },
    cues: [[0.2, () => setFace('sleepy', 2.3)], [2.5, () => { S.headDY.v -= 120; twitchEars(); setFace('surprised', 0.9); }], [3.2, () => setFace('troubled', 1.5)]] },
  bounce: { dur: 1.6, f: () => ({}),
    cues: [[0, () => setFace('happy', 1.6)], [0.05, () => { S.hopV = 300; S.squash.v += 1.2; }], [0.6, () => { S.hopV = 300; S.squash.v += 1.2; }], [1.0, () => emit('note', ...headTop(), 2, { size: 20 })]] },
  // waking from deep sleep: eyes flutter, startle, look around, a big stretch, then a word
  wake: { dur: 4, f: u => {
      if (u < 0.55) return { gy: 0.5, roll: 0.08, hdy: 5, eye: 0.75 + 0.25 * Math.sin(u * 34) };
      if (u < 1.4) return { gx: 0.6 * Math.sin((u - 0.55) * 7.5), gy: -0.1 };
      const s = env(u, 1.4, 1.9, 2.8, 3.4);
      return { sq: 0.035 * s, gy: -0.6 * s, eye: s, flat: 0.35 * s, tail: 0.5 * s, roll: 0.04 * Math.sin(u * 3) * s };
    },
    cues: [[0.55, () => { setFace('surprised', 0.9); S.headDY.v -= 120; kick(0.45); twitchEars(); emit('surprise', ...headTop(), 1, { life: 0.9, size: 30 }); }],
      [1.4, () => setFace('yawn', 1.6)], [3.2, () => { setFace('smile', 2.4); twitchEars(); swish(1); }]] },
  // only drowsy: a quick double blink and the ears come back up
  rouse: { dur: 1.2, f: u => ({ eye: u < 0.5 ? 0.6 * (1 - u / 0.5) + 0.4 * Math.max(0, Math.sin(u * 25)) : 0 }),
    cues: [[0.05, () => { S.headDY.v -= 50; twitchEars(); }], [0.5, () => setFace('curious', 0.8)]] },
  // the affection meter is full: she notices with a start, glances away blushing, then leans in close
  // with something special to say while a ring of hearts bursts out and a pink glow swells behind
  // her; a happy little hop to finish
  love: { dur: 6.6, f: u => {
      const shy = env(u, 0.15, 0.5, 1.3, 1.8), lean = env(u, 1.2, 2.0, 5.0, 5.9), g = S.gaze.active ? S.gaze.x : 0;
      return { gx: -0.55 * shy + 0.5 * g * lean, gy: 0.3 * shy + 0.08 * lean, hdy: 2 * shy + 6 * lean, roll: 0.05 * shy * Math.sin(u * 8) + 0.08 * lean,
        flat: 0.3 * shy, tail: 0.35 * Math.sin(u * 2.6) * lean, sq: 0.012 * lean };
    },
    cues: [[0, () => { S.love = true; setFace('surprised', 0.7); S.headDY.v -= 90; twitchEars(); kick(0.35); emit('heart', ...headTop(), 2); }],
      [0.55, () => { setFace('shy', 1.6); S.blush.x = 1; swish(0.8); }],
      [1.5, () => { line('loveMax', 'shy', 4.2); S.loveGlow = 1; heartBurst(); }],
      [2.6, () => emit('heart', ...headTop(), 3)], [3.6, () => { twitchEars(); emit('heart', ...headTop(), 2); }],
      [5.1, () => { setFace('happy', 1.8); hop(); heartBurst(0.6); }], [6.4, () => { S.love = false; }]] },
};
// hearts flying out in a ring from her chest, with a few sparkles
function heartBurst(k = 1) {
  const c = pose.cfg.chest.c, [x, y] = pose.rig.point(c[0], c[1] - 120, params()), n = Math.round(14 * k);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.12, 0.12), v = rand(170, 240);
    particles.push({ type: 'heart', x: x + Math.cos(a) * 40, y: y + Math.sin(a) * 40, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 0, max: rand(1.4, 1.9), size: rand(16, 26), rot: rand(-0.3, 0.3) });
  }
  for (let i = 0; i < 8 * k; i++) emit('spark', x + rand(-160, 160), y + rand(-180, 120), 1, { life: 0.7, size: 12 });
}
function startAnim(name) { S.anim = { name, t0: S.t, fired: 0 }; }
function animFrame(t) {
  const a = S.anim; if (!a) return null;
  const A = ANIMS[a.name], u = t - a.t0, cues = A.cues || [];
  while (a.fired < cues.length && cues[a.fired][0] <= u) cues[a.fired++][1]();
  if (u > A.dur) { S.anim = null; return null; }
  return A.f(u);
}
function idleMoment() {
  return pick([
    ['嗯？', 'curious', 'lookAround'],
    ['哼～哼哼♪', 'enjoy', 'hum'],
    ['呼啊～…', 'gentle', 'stretch'],
    ['唔……耳朵有点痒。', 'curious', 'earFlick'],
    ['尾巴怎么又动啦……', 'gentle', 'tailPlay'],
    ['嗯嗯～♪', 'happy', 'bounce'],
  ]);
}

// ---------------------------------------------------------------- carrying her around
// Desktop pet only, by holding the menu bar: the window follows the cursor while she dangles
// and swings with the motion (the speed comes from the screen cursor, see onCursor).
function startCarry() {
  const d = S.drag; d.started = true; d.carry = true; S.anim = null;
  S.carry = { vx: 0, sx: d.sx, sy: d.sy, t: S.t };
  window.petAPI.drag(true);
  line('carry', 'surprised', 99); twitchEars(); kick(0.5); swish(1.2); S.blush.x = Math.max(S.blush.x, 0.6);
  emit('sweat', ...headTop(), 1, { life: 1 });
  document.documentElement.classList.add('carrying');
}
function moveCarry(e) {
  const c = S.carry, dts = Math.max(0.008, S.t - c.t), vx = (e.screenX - c.sx) / dts;
  c.vx = lerp(c.vx, Math.max(-3000, Math.min(3000, vx)), 0.35); c.sx = e.screenX; c.sy = e.screenY; c.t = S.t;
}
function endCarry() {
  window.petAPI.drag(false);
  S.carry = null; document.documentElement.classList.remove('carrying');
  // set down: a soft landing
  S.squash.v -= 1.7; S.skirt.v += 40; S.tail.v += 1.4; S.tailWave = Math.max(S.tailWave, 0.18); S.headDY.v += 70;
  setTimeout(() => line('drop', pickLine(['smile', 'troubled', 'shy']), 2.2), 350);
}
function kick(a = 0.4) { S.squash.v += a; }
function twitchEars(which) {
  for (let k = 0; k < 2; k++) if (which == null || which === k) S.ears[k].v += pose.cfg.ears[k].side * rand(5, 8) * (Math.random() < 0.5 ? 1 : -0.6);
}
function swish(p = 1) { S.tail.v += pick([-1, 1]) * 2.8 * p; S.tailWave = Math.max(S.tailWave, 0.18 * p); }
function hop() {
  if (S.hop > 0.5 || S.hopPending) return;
  S.hopPending = true; S.squash.v -= 1.6;
  setTimeout(() => { S.hopV = 560; S.squash.v += 2.4; S.hopPending = false; }, 110);
}
function annoy(a) {
  S.ang = Math.min(1.6, S.ang + a);
  if (S.ang > 1 && S.angryUntil < S.t) { S.angryUntil = S.t + 7; setTimeout(() => line('angry', 'pout', 3), 900); emit('anger', ...headTop(), 1, { life: 1.6, size: 30 }); }
}
function please(a) {
  S.aff = Math.min(1, S.aff + a);
  S.ang = Math.max(0, S.ang - a * 2.5);
  if (S.angryUntil > S.t && S.ang < 0.35) { S.angryUntil = 0; line('forgive', 'shy', 2.6); }
  // filling the meter sets off her special moment, once until it has drained a little again;
  // it waits for a free moment (see frame) so a pat or a held hand is not cut short
  if (S.aff >= 1 && S.loveArmed) { S.loveArmed = false; S.lovePending = true; }
}
function headTop() {
  const c = pose.cfg; const p = pose.rig.point(c.crown.c[0], c.crown.c[1] - 40, params()); return [p[0], p[1]];
}
function earTip(k) { const e = pose.cfg.ears[k]; const p = pose.rig.point(e.tip[0], e.tip[1], params()); return [p[0], p[1]]; }

function onDown(hit, sx, sy, e) {
  S.anim = null; touch();
  S.drag = { hit, x0: sx, y0: sy, x: sx, y: sy, moved: 0, t0: S.t, started: false, lastX: sx, lastY: sy,
    cx: e ? e.clientX : 0, cy: e ? e.clientY : 0, sx: e ? e.screenX : 0, sy: e ? e.screenY : 0 };
  if (!hit) return;
  if (hit.type === 'cheek' || hit.type === 'face') {
    S.pokes.push({ x: sx, y: sy, a: 1 }); kick(0.25);
    S.pokeTimes = S.pokeTimes.filter(t => S.t - t < 4); S.pokeTimes.push(S.t);
    S.blush.x = Math.max(S.blush.x, 0.5);
    if (S.pokeTimes.length >= 5) { line('pokeMany', 'pout', 3); annoy(0.45); S.pokeTimes = []; }
    else { line('poke', hit.type === 'cheek' ? (Math.random() < 0.5 ? 'pout' : 'surprised') : 'curious', 2.2); annoy(0.06); }
    emit('spark', sx, sy, 3, { life: 0.5, size: 10 });
  }
}

function onMove(sx, sy, e) {
  const d = S.drag; if (!d) return;
  if (S.carry) return;
  const dx = sx - d.x0, dy = sy - d.y0;
  d.moved += Math.hypot(sx - d.lastX, sy - d.lastY); d.lastX = sx; d.lastY = sy; d.x = sx; d.y = sy;
  const h = d.hit; if (!h) return;
  const soft = (vx, vy, L) => { const l = Math.hypot(vx, vy) || 1, l2 = L * Math.tanh(l / L); return [vx * l2 / l, vy * l2 / l]; };
  if (h.type === 'ear') {
    if (!d.started && d.moved > 6) {
      d.started = true; line('earPull', 'shock', 99); annoy(0.32); S.tailWave = 0.3; swish(1.2); kick(0.5);
      emit('sweat', ...earTip(h.k), 2, { life: 1.1 }); emit('surprise', ...headTop(), 1, { life: 0.9, size: 30 });
      S.blush.x = 0.8;
    }
    if (d.started) {
      S.earPull[h.k] = soft(dx, dy, 55);
      S.earPullVel = [0, 0];
    }
  } else if (h.type === 'head') {
    if (!d.started && d.moved > 30) { d.started = true; d.patDist = 0; line('pat', 'enjoy', 99); }
    if (d.started) {
      d.patDist += 1; S.pat = { x: dx, y: dy };
      if (d.moved - (d.lastHeart || 0) > 90) { d.lastHeart = d.moved; emit('heart', sx, sy - 20, 1); please(0.04); }
    }
  } else if (h.type === 'tail') {
    if (!d.started && d.moved > 5) { d.started = true; line('tail', 'shock', 99); annoy(0.25); kick(0.5); twitchEars(); emit('surprise', ...headTop(), 1, { life: 0.9, size: 30 }); S.blush.x = 0.8; }
    if (d.started) { const [vx, vy] = soft(dx, dy, 80); S.tailDrag = { s: h.s, x: vx, y: vy }; S.tailWave = 0.25; }
  } else if (h.type === 'hair') {
    if (!d.started && d.moved > 6) { d.started = true; line('hair', 'troubled', 99); annoy(0.12); }
    if (d.started) { const [vx, vy] = soft(dx, dy, 45); S.hairDrag = { k: h.k, s: h.s, x: vx, y: vy }; }
  } else if (h.type === 'skirt') {
    // the hem stretches after the hand; she flusters, holds it down and leans away
    if (!d.started && d.moved > 6) {
      d.started = true; S.skirtSpring = null; line('skirtPull', 'shy', 99); annoy(0.18); S.blush.x = 1; kick(0.3); twitchEars(); swish(1.4);
      emit('sweat', ...headTop(), 1, { life: 1.1 });
    }
    if (d.started) {
      const [vx, vy] = soft(dx, dy, 70);
      S.skirtPull = { px: d.x0, py: d.y0, x: vx, y: vy };
      S.leanT = Math.max(-0.07, Math.min(0.07, -vx * 0.0009)); S.flatUntil = S.t + 0.3;
      if (S.t - d.t0 > 2.5 && !d.angry) { d.angry = true; annoy(0.4); line('skirtLong', 'pout', 99); }
    }
  } else if (DRAGS[h.type]) {
    const g = DRAGS[h.type];
    if (!d.started && d.moved > 12) { d.started = true; g.start(d); }
    // the body leans with the drag (towards a pull, away from a push), about the hips
    if (d.started) { S.leanT = Math.max(-0.11, Math.min(0.11, soft(dx, 0, 160)[0] * g.k)); if (g.move) g.move(d, sx, sy); }
  }
}
// drag reactions for the body zones: k = lean per px of drag
const DRAGS = {
  hand: { k: 0.00045, start: () => { line('handHold', 'shy', 99); S.blush.x = Math.max(S.blush.x, 0.7); },
    move: (d, sx, sy) => { if (d.moved - (d.lastHeart || 0) > 110) { d.lastHeart = d.moved; emit('heart', sx, sy - 20, 1); please(0.03); } } },
  arm: { k: 0.0006, start: () => { line('armTug', 'troubled', 99); twitchEars(); swish(0.8); } },
  chest: { k: 0.0005, start: () => { line('push', 'surprised', 99); kick(0.3); swish(1); } },
  belly: { k: 0.0005, start: () => { line('push', 'surprised', 99); kick(0.3); swish(1); } },
  bow: { k: 0.0004, start: () => { line('bow', 'troubled', 99); annoy(0.06); } },
  body: { k: 0.0005, start: () => { line('push', 'surprised', 99); kick(0.3); } },
};
// tap reactions for the body zones (p = tap point in sprite px)
const TAPS = {
  clip: p => { line('clip', 'happy', 2.2); twitchEars(); please(0.02); emit('spark', p[0], p[1], 3, { life: 0.5, size: 12 }); },
  neck: () => { line('neck', 'shy', 2.2); S.blush.x = Math.max(S.blush.x, 0.85); S.headDY.v += 90; S.flatUntil = S.t + 1.2; kick(0.3); swish(1.1); annoy(0.04); },
  hand: p => { line('hand', 'shy', 2.2); S.blush.x = Math.max(S.blush.x, 0.6); emit('heart', p[0], p[1] - 20, 1); please(0.03); },
  arm: () => { line('arm', 'curious', 1.8); twitchEars(); },
  bow: () => { line('bow', 'troubled', 2.2); S.skirt.v += 18; },
  chest: () => { line('chest', Math.random() < 0.5 ? 'shy' : 'surprised', 2.2); S.blush.x = Math.max(S.blush.x, 0.9); S.leanS.v -= 0.5; annoy(0.08); },
  belly: p => { line('belly', 'surprised', 2); S.squash.v -= 0.9; S.headDY.v += 60; swish(1.3); annoy(0.04); emit('sweat', ...headTop(), 1, { life: 1 }); emit('spark', p[0], p[1], 3, { life: 0.5, size: 12 }); },
  skirt: () => { line('skirt', 'shy', 2.6); S.blush.x = 1; S.skirt.v -= 30; annoy(0.15); },
  leg: () => { line('leg', Math.random() < 0.6 ? 'shy' : 'jito', 2.4); S.blush.x = 1; S.skirt.v -= 22; S.leanS.v -= 0.35; annoy(0.12); },
  feet: p => { line('feet', 'happy', 2.2); S.giggleUntil = S.t + 1.1; swish(1.6); twitchEars(); please(0.02); emit('note', p[0] + 40, p[1] - 60, 2, { size: 20 }); },
  body: () => { line('body', 'smile', 2); },
};
// any touch: she glances at the spot and her tail flicks
function noticeTouch(x, y) {
  S.look = { x: Math.max(-1, Math.min(1, (x - 512) / 420)), y: Math.max(-1, Math.min(1, (y - 262) / 520)), until: S.t + 1.4 };
  S.tail.v += (x > 512 ? 1 : -1) * 0.9; S.tailWave = Math.max(S.tailWave, 0.12);
}

function onUp() {
  const d = S.drag; S.drag = null;
  if (d && d.carry) { endCarry(); return; }
  if (!d || !d.hit) return;
  const h = d.hit;
  if (h.type === 'ear') {
    if (d.started) {
      S.earSpring = { k: h.k, x: S.earPull[h.k][0], y: S.earPull[h.k][1], vx: 0, vy: 0 };
      setTimeout(() => line('earRelease', S.ang > 0.8 ? 'jito' : 'troubled', 2.6), 250);
    } else { S.ears[h.k].v += pose.cfg.ears[h.k].side * 9; line('earFlick', 'curious', 1.6); }
  } else if (h.type === 'head') {
    if (d.started) { S.pat = null; line('patEnd', 'happy', 2.2); please(0.08); emit('heart', ...headTop(), 3); }
    else { S.headDY.v += 60; twitchEars(); line('headTap', 'curious', 1.8); }
  } else if (h.type === 'tail') {
    if (d.started) { S.tailSpring = { x: S.tailDrag.x, y: S.tailDrag.y, vx: 0, vy: 0, s: S.tailDrag.s }; swish(1.5); setTimeout(() => line('tailEnd', 'jito', 2.2), 400); }
    else { swish(1.2); say('呜…', 'surprised', 1.2); }
  } else if (h.type === 'hair') {
    if (d.started) { S.hairSpring = { ...S.hairDrag, vx: 0, vy: 0 }; S.hair[S.hairDrag.k].v += -S.hairDrag.x * 0.04; }
    else line('hair', 'troubled', 1.8);
  } else if (h.type === 'skirt' && d.started) {
    // let go: the cloth flutters back, she smooths it down
    S.skirtSpring = { ...S.skirtPull, vx: 0, vy: 0 }; S.skirt.v += -S.skirtPull.x * 0.6; S.leanS.v += -S.leanS.x * 2;
    setTimeout(() => line('skirtEnd', pickLine(['pout', 'shy', 'jito']), 2.4), 300);
  } else if (TAPS[h.type] || DRAGS[h.type]) {
    if (d.started) {
      // let go of a lean: she sways back with a little overshoot
      S.leanT = 0; S.leanS.v += -S.leanS.x * 2;
      if (h.type === 'hand') { line('patEnd', 'smile', 2); please(0.04); }
      else setTimeout(() => say(pickLine(['呼…', '真是的…', '差点摔倒…']), 'troubled', 1.8), 300);
    } else if (d.moved < 10 && TAPS[h.type]) { noticeTouch(d.x0, d.y0); TAPS[h.type]([d.x0, d.y0]); }
  }
}

// idle director
function idleTick() {
  if (!S.opt.idle || S.drag || S.angryUntil > S.t || S.switching || S.anim) return;
  // while recording she only twitches an ear or flicks her tail now and then
  if (Rec.on) { const r = Math.random(); if (!S.sleep && r < 0.4) r < 0.25 ? twitchEars(r < 0.12 ? 0 : 1) : swish(0.8); return; }
  const quiet = quietFor(), after = Store.data.sleepAfter;
  if (after > 0 && S.sleep === 0 && quiet > after * 0.8) { S.sleep = 1; setFace('yawn', 2.2); return; }
  if (after > 0 && S.sleep === 1 && quiet > after) { S.sleep = 2; return; }
  if (!S.sleep) void ambientMoment();
}

// ============================================================================
//  Recording mode: acting out the video storyboard on cue
// ============================================================================
// While it is on she starts nothing by herself (no fidgets, chatter or dozing off), every reaction
// says the first line of its list, and touch reactions only go to the AI once it is switched back on
// for the shot that shows it. These keys cue the rest; key handling and the cheat sheet are in ui.js.
const Rec = { on: false, ai: false, freeze: false };
const REC_ACTS = {
  1: ['伸懒腰', () => recAnim('stretch')],
  2: ['打喷嚏', () => recAnim('sneeze')],
  3: ['回头看尾巴', () => recAnim('tailPlay')],
  4: ['哼歌', () => recAnim('hum')],
  5: ['东张西望', () => recAnim('lookAround')],
  6: ['凑近偷看', () => recAnim('peek')],
  7: ['蹦跶', () => recAnim('bounce')],
  8: ['抖耳朵', () => recAnim('earFlick')],
  9: ['打盹点头', () => recAnim('doze')],
  J: ['跳一下', () => { hop(); line('jump', 'happy', 1.6); }],
  A: ['赌气别过脸（摸头哄好）', recSulk],
  S: ['犯困后睡着（动鼠标叫醒）', recSleep],
  F: ['定格，点她才动起来', () => Rec.freeze ? recThaw() : recFreeze()],
  R: ['复位：情绪、表情清零', recReset],
  P: ['换姿势', () => switchPose(pose.key === 'a' ? 'b' : 'a', true)],
  M: ['显示变形网格', () => { S.opt.mesh = !S.opt.mesh; $('#optMesh').checked = S.opt.mesh; }],
  I: ['AI 触摸反应 开 / 关', () => { Rec.ai = !Rec.ai; toast('AI 触摸反应：' + (Rec.ai ? '开' : '关')); }],
  L: ['好感满：特别动作', () => { recAnim('love'); S.aff = 1; S.loveArmed = false; }],
};
function recAnim(name) { if (Rec.freeze) recThaw(); S.sleep = 0; S.angryUntil = 0; startAnim(name); }
// turned away until patted enough (a few strokes), however long that takes
function recSulk() {
  S.anim = null; S.sleep = 0; S.ang = 1.05; S.angryUntil = S.t + 30;
  emit('anger', ...headTop(), 1, { life: 1.6, size: 30 }); setTimeout(() => line('angry', 'pout', 3), 300);
}
// a yawn, then fast asleep; moving the mouse after that wakes her the usual way
function recSleep() {
  S.anim = null; S.angryUntil = 0; S.sleep = 1; S.wakeGrace = S.t + 6; line('yawn', 'yawn', 2.2);
  setTimeout(() => { if (S.sleep === 1) { S.sleep = 2; line('sleep', null); } }, 3200);
}
function recReset() {
  S.anim = null; S.sleep = 0; S.ang = 0; S.angryUntil = 0; S.aff = 0.5; S.pokeTimes = []; S.look = null;
  S.face.until = 0; S.face.idleSem = 'neutral'; S.talkUntil = 0; bubbleHide = 0; clearInterval(typing); particles.length = 0;
  S.love = false; S.lovePending = false; S.loveGlow = 0; Voice.stop();
}
// stands perfectly still at rest, like the plain illustration, until the next touch brings her to life
function recFreeze() {
  recReset(); activate(pose.key);
  for (const o of [S.ax, S.ay, S.roll, S.bodyX, S.bodyRoll, S.headDX, S.headDY, S.leanS, S.tail, S.skirt, S.squash, S.eyeClose, ...S.ears]) { o.x = 0; o.v = 0; }
  S.blush.x = 0.15; S.blink.t = -1; S.breath = 0; S.mouth = 0; S.tailWave = 0; S.hop = 0; S.hopV = 0; S.pokes = [];
  Rec.freeze = true;
}
function recThaw() { Rec.freeze = false; S.blink.next = S.t + 1.5; }

// ============================================================================
//  Main loop
// ============================================================================
let last = now(), idleTimer = 0;
function frame() {
  const t1 = now(); let dt = Math.min(0.05, t1 - last); last = t1;
  Voice.lvl = lerp(Voice.lvl, Voice.meter(), 0.45);
  // frozen for the opening shot: time stands still (simulate advances it)
  if (!Rec.freeze) {
    const sub = 3; for (let i = 0; i < sub; i++) simulate(dt / sub);
    idleTimer -= dt; if (idleTimer <= 0) { idleTimer = rand(4, 8); idleTick(); }
    if (S.lovePending && !S.drag && !S.carry && !S.switching) { S.lovePending = false; S.sleep = 0; S.angryUntil = 0; startAnim('love'); }
  }
  render(dt);
  requestAnimationFrame(frame);
}

function simulate(dt) {
  S.t += dt; const t = S.t, c = pose.cfg, man = S.manual;
  // --- gaze target
  aimGaze();
  let gx = 0, gy = 0;
  if (S.look && S.look.until > t) { gx = S.look.x; gy = S.look.y; }
  // follows the mouse while it moves; after a while of stillness her eyes wander off again
  else if (S.opt.follow && S.gaze.active && t - S.lastMouse < 12) { gx = S.gaze.x; gy = S.gaze.y; }
  else { gx = 0.15 * Math.sin(t * 0.37); gy = 0.1 * Math.sin(t * 0.23 + 1); }
  if (S.angryUntil > t) { gx = S.gaze.active ? -Math.sign(S.gaze.x || 1) * 0.85 : 0.8; gy = -0.15; }
  if (S.sleep >= 2) { gx = 0.1; gy = 0.55; }
  if (S.sleep === 1) gy += 0.25;
  if (man.angleX != null) gx = man.angleX; if (man.angleY != null) gy = man.angleY;
  let rollT = -gx * 0.05 + 0.02 * Math.sin(t * 0.5);
  if (S.sleep >= 2) rollT = 0.1 + 0.02 * Math.sin(t * 0.6);
  let hdx = 0, hdy = 0;
  // ear pull drags the head along, with a trembling resistance
  const pullK = S.earPull.findIndex(p => p && S.drag);
  if (pullK >= 0) {
    const p = S.earPull[pullK]; hdx = p[0] * 0.18 + Math.sin(t * 45) * 1.2; hdy = p[1] * 0.12; rollT += p[0] * 0.0022;
    gx = -p[0] * 0.01; gy = 0.2;
  }
  if (S.pat) { hdy = 5 + Math.min(6, Math.abs(S.pat.y) * 0.05); hdx = Math.max(-8, Math.min(8, S.pat.x * 0.05)); rollT += Math.max(-0.08, Math.min(0.08, S.pat.x * 0.0009)); gy = 0.3; }
  if (S.hairDrag && S.drag) rollT += S.hairDrag.x * 0.0012;
  // tail pulled: she twists round to look at it and is dragged a little towards the pull
  const tailHeld = S.tailDrag && S.drag && S.drag.started;
  if (tailHeld) { const side = Math.sign(pose.rig.tailRoot[0] - 512) || 1; gx = side * 0.6; gy = 0.45; S.leanT = Math.max(-0.08, Math.min(0.08, S.tailDrag.x * 0.0007)); }
  // giggling (feet tickled): quick shakes of head and shoulders
  if (S.giggleUntil > t) { const g = (S.giggleUntil - t) / 1.1; hdx += Math.sin(t * 31) * 2.5 * g; hdy += Math.abs(Math.sin(t * 17)) * 2 * g; rollT += Math.sin(t * 23) * 0.035 * g; }
  // acted moments, and dangling while carried (body swings against the motion, legs hang)
  const A = !S.drag ? animFrame(t) : null, C = S.carry;
  if (A) {
    if (A.gx != null) gx = A.gx; if (A.gy != null) gy = A.gy;
    rollT += A.roll || 0; hdx += A.hdx || 0; hdy += A.hdy || 0;
  }
  if (C) { C.vx *= Math.exp(-dt * 5); gy = Math.max(gy, 0.35); rollT += Math.max(-0.12, Math.min(0.12, C.vx * 0.00006)); }
  if (man.roll != null) rollT = man.roll;
  stepSpring(S.ax, gx, 55, 13, dt); stepSpring(S.ay, gy, 55, 13, dt); stepSpring(S.roll, rollT, 45, 11, dt);
  stepSpring(S.headDX, hdx, 120, 14, dt); stepSpring(S.headDY, hdy, 120, 14, dt);
  // lean: pushes / tugs / holding hands tip the body about the hips; the head counter-rolls to stay level-ish
  if (!S.drag && !tailHeld) S.leanT = 0;
  if (C) S.leanT = Math.max(-0.14, Math.min(0.14, -C.vx * 0.00009));
  stepSpring(S.leanS, S.leanT, 26, 4.2, dt);
  stepSpring(S.bodyX, man.bodyX != null ? man.bodyX : S.ax.x * 0.45 + S.leanS.x * 14, 18, 7, dt);
  stepSpring(S.bodyRoll, -S.roll.x * 0.25 + 0.012 * Math.sin(t * 0.8) - S.bodyX.x * 0.015 - S.leanS.x * 0.9, 18, 7, dt);
  // --- breathing
  const bp = S.sleep >= 2 ? 5.2 : 3.4;
  S.breath = man.breath != null ? man.breath : 0.5 + 0.5 * Math.sin(t * Math.PI * 2 / bp);
  // --- hair pendulums: gravity counters head roll, wind + inertia from head motion
  const wind = S.opt.wind ? 1 : 0;
  pose.rig.strands.forEach((st, k) => {
    const h = S.hair[k];
    const w = wind * (0.035 * Math.sin(t * 1.3 + k * 1.7) + 0.02 * Math.sin(t * 2.9 + k * 0.6) + 0.015 * Math.sin(t * 0.47));
    const tgt = -(S.roll.x + S.bodyRoll.x) * 0.7 - S.ax.v * 0.012 + w + (st.back ? -S.ax.x * 0.02 : 0) + (C ? Math.max(-0.2, Math.min(0.2, -C.vx * 0.0001)) : 0);
    stepSpring(h, tgt, st.k || 80, 3.2, dt);
    h.v += -S.roll.v * 0.6 * dt * 10 * 0.1;
  });
  // --- ears: perked normally, flattened while patted / scared / sleepy
  let flat = 0;
  if (S.pat) flat = 0.4; else if (S.flatUntil > t) flat = 0.35; else if (S.drag && S.drag.started && ['ear', 'tail'].includes(S.drag.hit?.type)) flat = 0.3;
  else if (S.angryUntil > t) flat = 0.22; else if (S.sleep) flat = 0.15; else if (C) flat = 0.25;
  if (A && A.flat) flat += A.flat;
  S.ears.forEach((e, k) => {
    const side = c.ears[k].side;
    let tg = side * flat + 0.02 * Math.sin(t * 2.1 + k);
    const mk = k === 0 ? man.earL : man.earR; if (mk != null) tg = mk;
    stepSpring(e, tg, 200, 9, dt);
  });
  // released ear springs back with a wobble
  if (S.earSpring) {
    const es = S.earSpring; es.vx += (-es.x * 320 - es.vx * 9) * dt; es.vy += (-es.y * 320 - es.vy * 9) * dt; es.x += es.vx * dt; es.y += es.vy * dt;
    S.earPull[es.k] = [es.x, es.y];
    if (Math.abs(es.x) + Math.abs(es.y) + Math.abs(es.vx) * 0.02 < 0.2) { S.earPull[es.k] = null; S.earSpring = null; }
  }
  // --- tail
  // --- tail: rhythm follows her mood, and it is coupled to the body (it lags behind sways,
  // hops and squashes, and counters the lean) so the whole figure moves as one
  const scared = S.drag && S.drag.started && ['ear', 'tail'].includes(S.drag.hit?.type);
  // skirt held: the tail lashes about nervously
  const flustered = S.drag && S.drag.started && S.drag.hit?.type === 'skirt';
  const mood = scared ? 'scared' : flustered ? 'flustered' : S.angryUntil > t ? 'angry' : S.sleep ? 'sleepy' : (S.pat || S.giggleUntil > t || S.love || (S.face.until > t && ['happy', 'enjoy', 'smile'].includes(S.face.sem))) ? 'happy' : 'calm';
  const TM = { calm: [5, 0.045, 0.16, 1.15], happy: [3.2, 0.13, 0.28, 1.6], angry: [9, 0.2, 0.32, 3.4], scared: [16, 0.06, 0.05, 0.5], sleepy: [1.6, 0.025, 0.07, 0.5], flustered: [12, 0.17, 0.22, 2.9] }[mood];
  S.tailFreq = lerp(S.tailFreq, TM[0], 1 - Math.exp(-dt * 3)); S.tailBase = lerp(S.tailBase, TM[1], 1 - Math.exp(-dt * 2));
  S.tailPhase += dt * S.tailFreq;
  const sway = TM[2] * Math.sin(t * TM[3]) + 0.06 * Math.sin(t * 2.3 + 1);
  const couple = -S.bodyX.v * 0.035 - S.bodyRoll.x * 2.2 - S.leanS.x * 2.5 + S.squash.x * 1.6 + Math.max(-0.5, Math.min(0.5, S.hopV * 0.0007)) + (S.sleep >= 2 ? 0.25 : 0);
  const tailT = (man.tail != null ? man.tail : 0) + sway + couple + (A && A.tail || 0) + (C ? Math.max(-0.6, Math.min(0.6, -C.vx * 0.0004)) : 0);
  stepSpring(S.tail, tailT, 10, 2.2, dt);
  S.tailWave = Math.max(S.tailBase, S.tailWave - dt * 0.12);
  if (S.tailSpring) {
    const ts = S.tailSpring; ts.vx += (-ts.x * 140 - ts.vx * 7) * dt; ts.vy += (-ts.y * 140 - ts.vy * 7) * dt; ts.x += ts.vx * dt; ts.y += ts.vy * dt;
    S.tailDrag = { s: ts.s, x: ts.x, y: ts.y };
    if (Math.abs(ts.x) + Math.abs(ts.y) + Math.abs(ts.vx) * 0.02 < 0.3) { S.tailDrag = null; S.tailSpring = null; }
  }
  if (S.hairSpring) {
    const hs = S.hairSpring; hs.vx += (-hs.x * 160 - hs.vx * 8) * dt; hs.vy += (-hs.y * 160 - hs.vy * 8) * dt; hs.x += hs.vx * dt; hs.y += hs.vy * dt;
    S.hairDrag = { k: hs.k, s: hs.s, x: hs.x, y: hs.y };
    if (Math.abs(hs.x) + Math.abs(hs.y) < 0.3) { S.hairDrag = null; S.hairSpring = null; }
  }
  if (S.skirtSpring) {
    const ss = S.skirtSpring; ss.vx += (-ss.x * 150 - ss.vx * 6) * dt; ss.vy += (-ss.y * 150 - ss.vy * 6) * dt; ss.x += ss.vx * dt; ss.y += ss.vy * dt;
    S.skirtPull = { px: ss.px, py: ss.py, x: ss.x, y: ss.y };
    if (Math.abs(ss.x) + Math.abs(ss.y) + (Math.abs(ss.vx) + Math.abs(ss.vy)) * 0.01 < 0.3) { S.skirtPull = null; S.skirtSpring = null; }
  }
  // --- skirt lags behind the body
  stepSpring(S.skirt, -S.bodyX.v * 2.2 - S.bodyRoll.x * 120 + wind * 1.2 * Math.sin(t * 1.7) + (C ? Math.max(-25, Math.min(25, -C.vx * 0.02)) : 0), 40, 3.5, dt);
  // --- hop & squash
  if (S.hop > 0 || S.hopV > 0) { S.hop += S.hopV * dt; S.hopV -= 2600 * dt; if (S.hop <= 0) { S.squash.v -= Math.min(2.5, -S.hopV * 0.003); S.hop = 0; S.hopV = 0; S.skirt.v += 40; S.tail.v += 1.6; S.tailWave = Math.max(S.tailWave, 0.16); } }
  stepSpring(S.squash, A && A.sq || (C ? 0.02 : 0), 260, 11, dt);
  // --- pokes decay
  for (const p of S.pokes) p.a *= Math.exp(-dt * 4); S.pokes = S.pokes.filter(p => p.a > 0.02);
  // --- blush
  const blushT = man.blush != null ? man.blush : (S.pat ? 0.9 : S.angryUntil > t ? 0.5 : 0.12 + S.aff * 0.2);
  S.blush.x = lerp(S.blush.x, blushT, 1 - Math.exp(-dt * (S.blush.x > blushT ? 0.6 : 3)));
  // --- blink
  const b = S.blink;
  if (b.t < 0 && t > b.next) { b.t = 0; }
  if (b.t >= 0) { b.t += dt; if (b.t > 0.17) { b.t = -1; b.next = t + (b.double ? 0.12 : rand(2.2, 5.5)); b.double = !b.double && Math.random() < 0.18; } }
  const eyeT = man.eyeClose != null ? man.eyeClose : A && A.eye != null ? A.eye : (S.sleep >= 2 ? 1 : S.sleep === 1 ? 0.45 + 0.1 * Math.sin(t * 1.3) : 0);
  stepSpring(S.eyeClose, eyeT, 30, 10, dt);
  // --- mouth: opens with the loudness of her voice while it plays, else flaps while the text types
  const talking = S.talkUntil > t;
  S.mouth = man.mouth != null ? man.mouth : Voice.playing ? Voice.lvl : talking ? Math.max(0, Math.sin(t * 19) * 0.6 + Math.sin(t * 7.1) * 0.4) : 0;
  // --- mood decay
  S.ang = Math.max(0, S.ang - dt * 0.035);
  S.aff = Math.max(0.1, S.aff - dt * 0.002);
  if (S.aff < 0.85) S.loveArmed = true;
  S.loveGlow = Math.max(0, S.loveGlow - dt * 0.2);
  updateFace(dt);
  // particles (sprite space)
  for (const p of particles) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 1 - dt * 1.5; p.vx *= 1 - dt * 1.5; }
  for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life > particles[i].max) particles.splice(i, 1);
  if (S.sleep >= 2 && Math.random() < dt * 0.9) { const [x, y] = headTop(); particles.push({ type: 'zzz', x: x + 120, y: y + 40, vx: 25, vy: -40, life: 0, max: 2.4, size: rand(20, 30), rot: 0 }); }
  if (S.pat && Math.random() < dt * 1.5) { const [x, y] = headTop(); emit(Math.random() < 0.35 ? 'paw' : 'note', x + rand(-130, 130), y + 30, 1, { size: 20 }); }
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function render() {
  const P = params(), dpr = view.dpr;
  const s = view.s * dpr, W = stage.width, H = stage.height;
  gl.useProgram(prog);
  gl.uniformMatrix3fv(U.uView, false, [2 * s / W, 0, 0, 0, -2 * s / H, 0, 2 * view.ox * dpr / W - 1, 1 - 2 * view.oy * dpr / H, 1]);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  drawRig(P, S.globalAlpha);
  drawUnder(P); drawOver(P);
  updateBubble(P);
}

// the live rig (tail, body, expression patches, blink, blush)
function drawRig(P, A) {
  pose.spriteMesh.update(pose.rig, P); pose.patchMesh.update(pose.rig, P); pose.blushMesh.update(pose.rig, P); pose.tailMesh.update(pose.rig, P);
  pose.tailMesh.draw(pose.tailTex, A);
  pose.spriteMesh.draw(pose.spriteTex, A);
  pose.skirtMesh.update(pose.rig, P); pose.skirtMesh.draw(pose.skirtTex, A);
  if (pose.locksMesh) { pose.locksMesh.update(pose.rig, P); pose.locksMesh.draw(pose.locksTex, A); }
  // expression: previous face, cross-faded current face, talk mouth, blink overlays
  const f = S.face, tex = pose.tex;
  if (f.prev && f.fade < 1) pose.patchMesh.draw(tex[f.prev], A);
  pose.patchMesh.draw(tex[f.cur], f.prev && f.fade < 1 ? A * f.fade : A);
  const alt = semId(f.curSem || 'neutral')[1];
  if (alt && tex[alt] && S.mouth > 0.01) pose.patchMesh.draw(tex[alt], A * smoothstep(0.25, 0.6, S.mouth));
  if (!pose.cfg.noBlink.includes(f.cur)) {
    const bt = S.blink.t >= 0 ? Math.sin(Math.PI * S.blink.t / 0.17) : 0;
    const cl = Math.max(bt, S.eyeClose.x);
    const halfA = smoothstep(0.08, 0.35, cl) * (1 - smoothstep(0.6, 0.85, cl)), closedA = smoothstep(0.55, 0.8, cl);
    pose.patchMesh.draw(pose.blinkHalf, A * halfA);
    pose.patchMesh.draw(pose.blinkClosed, A * closedA);
  }
  pose.blushMesh.draw(pose.blushTex, A * Math.max(0, Math.min(1, (S.blush.x - 0.15) * 1.3)));
  if (S.opt.mesh) { pose.spriteMesh.wire([1, 0.55, 0.75, 1], 0.16); pose.tailMesh.wire([1, 0.85, 0.4, 1], 0.4); pose.skirtMesh.wire([0.6, 0.7, 1, 1], 0.35); if (pose.locksMesh) pose.locksMesh.wire([0.5, 1, 0.8, 1], 0.35); pose.patchMesh.wire([0.55, 0.75, 1, 1], 0.35); }
}

function drawUnder(P) {
  const dpr = view.dpr; uctx.setTransform(dpr, 0, 0, dpr, 0, 0); uctx.clearRect(0, 0, view.W, view.H);
  // full-affection moment: a pink glow and a big soft heart behind her that swells as it fades
  if (S.loveGlow > 0.01) {
    const a = S.loveGlow, c = pose.rig.point(pose.cfg.dome.c[0], pose.cfg.dome.c[1] + 170, P), [hx, hy] = toScreen(c[0], c[1]), R = 520 * view.s;
    const gl2 = uctx.createRadialGradient(hx, hy, 0, hx, hy, R);
    gl2.addColorStop(0, `rgba(255,140,190,${0.6 * a})`); gl2.addColorStop(0.55, `rgba(255,140,190,${0.25 * a})`); gl2.addColorStop(1, 'rgba(255,140,190,0)');
    uctx.fillStyle = gl2; uctx.fillRect(hx - R, hy - R, R * 2, R * 2);
    const hs = (340 + 100 * (1 - a)) * view.s;
    uctx.save(); uctx.translate(hx, hy + hs * 0.35); uctx.globalAlpha = 0.42 * a; heartPath(uctx, hs); uctx.fillStyle = '#ff8fb8'; uctx.fill(); uctx.restore();
  }
  const [x, y] = toScreen(512 + P.bodyX * 5, pose.cfg.feetY - 6);
  const k = 1 / (1 + S.hop / 120), rx = 190 * view.s * k, ry = 30 * view.s * k;
  const g = uctx.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, `rgba(10,8,25,${0.45 * k * S.globalAlpha})`); g.addColorStop(1, 'rgba(10,8,25,0)');
  uctx.fillStyle = g; uctx.save(); uctx.translate(x, y); uctx.scale(1, ry / rx); uctx.translate(-x, -y);
  uctx.beginPath(); uctx.arc(x, y, rx, 0, Math.PI * 2); uctx.fill(); uctx.restore();
}

function heartPath(c, s) { c.beginPath(); c.moveTo(0, s * 0.35); c.bezierCurveTo(-s, -s * 0.3, -s * 0.45, -s * 1.05, 0, -s * 0.45); c.bezierCurveTo(s * 0.45, -s * 1.05, s, -s * 0.3, 0, s * 0.35); c.closePath(); }
// particle sprites: img/fx.png, 96 px cells in this order (tools/ui-art.ps1); vectors until it has loaded
const FX_SPRITES = ['heart', 'note', 'zzz', 'sweat', 'anger', 'surprise', 'spark', 'paw'];
const fxImg = new Image(); fxImg.src = 'img/fx.png';
function drawOver() {
  const dpr = view.dpr; octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, view.W, view.H);
  const sprites = fxImg.complete && fxImg.naturalWidth > 0;
  for (const p of particles) {
    const [x, y] = toScreen(p.x, p.y), k = p.life / p.max, a = Math.min(1, (1 - k) * 2.5) * Math.min(1, p.life * 8);
    const sz = p.size * Math.max(0.6, view.s * 1.6) * (p.type === 'heart' ? 0.8 + 0.3 * Math.sin(p.life * 12) * (1 - k) : 1);
    octx.save(); octx.translate(x, y); octx.rotate(p.rot); octx.globalAlpha = a;
    if (sprites) {
      // sparks bloom and turn as they fade
      const d = sz * (p.type === 'spark' ? 0.9 + 1.1 * k : 1.25);
      if (p.type === 'spark') octx.rotate(k * 1.2);
      octx.drawImage(fxImg, FX_SPRITES.indexOf(p.type) * 96, 0, 96, 96, -d / 2, -d / 2, d, d);
    }
    else if (p.type === 'paw') { octx.fillStyle = '#ffb3cc'; octx.beginPath(); octx.ellipse(0, sz * 0.15, sz * 0.26, sz * 0.21, 0, 0, Math.PI * 2);
      for (const [px, py] of [[-0.3, -0.12], [-0.11, -0.3], [0.11, -0.3], [0.3, -0.12]]) { octx.moveTo(px * sz + sz * 0.1, py * sz); octx.arc(px * sz, py * sz, sz * 0.1, 0, Math.PI * 2); }
      octx.fill(); }
    else if (p.type === 'heart') { heartPath(octx, sz * 0.6); octx.fillStyle = '#ff7fa8'; octx.fill(); octx.lineWidth = 1.5; octx.strokeStyle = '#fff'; octx.stroke(); }
    else if (p.type === 'note') { octx.fillStyle = '#ffd0e4'; octx.font = `${sz}px serif`; octx.fillText(p.n || (p.n = pick(['♪', '♫'])), 0, 0); }
    else if (p.type === 'zzz') { octx.fillStyle = '#cfd8ff'; octx.font = `bold ${sz}px sans-serif`; octx.fillText('Z', 0, 0); }
    else if (p.type === 'sweat') { octx.fillStyle = '#9fd3ff'; octx.beginPath(); octx.moveTo(0, -sz * 0.5); octx.quadraticCurveTo(sz * 0.4, 0, 0, sz * 0.3); octx.quadraticCurveTo(-sz * 0.4, 0, 0, -sz * 0.5); octx.fill(); }
    else if (p.type === 'anger') { octx.strokeStyle = '#ff4d5e'; octx.lineWidth = sz * 0.14; octx.lineCap = 'round';
      for (let i = 0; i < 4; i++) { octx.rotate(Math.PI / 2); octx.beginPath(); octx.moveTo(sz * 0.12, -sz * 0.45); octx.quadraticCurveTo(sz * 0.12, -sz * 0.12, sz * 0.45, -sz * 0.12); octx.stroke(); } }
    else if (p.type === 'surprise') { octx.fillStyle = '#ffe27a'; octx.strokeStyle = '#6a4a00'; octx.lineWidth = 2; octx.font = `900 ${sz * 1.2}px sans-serif`; octx.strokeText('!', 0, 0); octx.fillText('!', 0, 0); }
    else if (p.type === 'spark') { octx.strokeStyle = '#fff'; octx.lineWidth = 2; for (let i = 0; i < 4; i++) { octx.rotate(Math.PI / 2); octx.beginPath(); octx.moveTo(0, sz * (0.3 + k)); octx.lineTo(0, sz * (0.7 + k)); octx.stroke(); } }
    octx.restore();
  }
}

function updateBubble(P) {
  if (S.t > bubbleHide && !bubble.classList.contains('hidden')) bubble.classList.add('hidden');
  const a = pose.rig.point(pose.cfg.bubble[0], pose.cfg.bubble[1], P);
  let [x, y] = toScreen(a[0], a[1]);
  const bw = bubble.offsetWidth, bh = bubble.offsetHeight;
  if (PET) {
    // on the desktop it floats in the band above her head, never over her
    const hc = pose.rig.point(pose.cfg.dome.c[0], pose.cfg.dome.c[1], P), left = view.ox + 140 * view.s;
    x = Math.max(left, Math.min(toScreen(hc[0], 0)[0] - bw / 2, view.W - bw - 44));
    y = Math.max(4, view.oy + 16 * view.s - bh);
    bubble.style.left = x + 'px'; bubble.style.top = y + 'px';
    return;
  }
  const rightLimit = view.W - 12 - (view.W > 760 && panelShown() ? 300 : 0);
  x = Math.max(12, Math.min(x, rightLimit - bw)); y = Math.max(12, y - bh);
  if (x + bw > view.W - 64) y = Math.max(y, 64);   // keep clear of the panel toggle
  bubble.style.left = x + 'px'; bubble.style.top = y + 'px';
}

// ============================================================================
//  Input
// ============================================================================
let hoverHit = null;
stage.addEventListener('pointerdown', e => {
  try { stage.setPointerCapture(e.pointerId); } catch (_) { /* synthetic events */ }
  const [x, y] = toSprite(e.clientX, e.clientY);
  if (Rec.freeze) recThaw();
  onDown(hitTest(x, y), x, y, e);
});
// Gaze: on the desktop the shell reports the system cursor relative to this window even when it
// is far outside it, so she can follow it across the whole screen; a browser page only sees itself.
const SCREEN_GAZE = !!window.petAPI;
function pointerAt(cx, cy) {
  const g = S.gaze;
  if (g.cx == null || Math.hypot(cx - g.cx, cy - g.cy) > 2) activity();
  g.cx = cx; g.cy = cy; g.active = true;
}
// gaze direction towards the pointer, from where her head is now
function aimGaze() {
  const g = S.gaze; if (g.cx == null) return;
  const [hx, hy] = toScreen(pose.cfg.dome.c[0], pose.cfg.dome.c[1]);
  // soft range: about half the screen (or page) away she is looking as far as she can
  const R = SCREEN_GAZE ? Math.max(280, Math.min(screen.width, screen.height) * 0.45) : Math.max(240, Math.min(view.W, view.H) * 0.5);
  g.x = Math.tanh((g.cx - hx) / R); g.y = Math.tanh((g.cy - hy) / (R * 0.85));
}
if (window.petAPI && window.petAPI.onCursor) window.petAPI.onCursor(p => {
  // while carried the window moves with the cursor, so only the screen position tells the speed
  if (S.carry && PET) { moveCarry({ screenX: p.sx, screenY: p.sy }); S.lastMouse = S.t; return; }
  pointerAt(p.x, p.y);
});
window.addEventListener('pointermove', e => { if (!SCREEN_GAZE) pointerAt(e.clientX, e.clientY); }, true);
document.addEventListener('mouseleave', () => { if (!SCREEN_GAZE) S.gaze.active = false; });
window.addEventListener('keydown', () => { S.lastInput = S.t; });
stage.addEventListener('pointermove', e => {
  const [x, y] = toSprite(e.clientX, e.clientY);
  if (S.drag) { onMove(x, y, e); return; }
  hoverHit = hitTest(x, y);
  stage.style.cursor = !hoverHit ? 'default' : ['ear', 'tail', 'hair'].includes(hoverHit.type) || hoverHit.zone === 'tail' ? 'grab' : 'pointer';
});
const up = () => { onUp(); };
stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
stage.addEventListener('dblclick', e => {
  const [x, y] = toSprite(e.clientX, e.clientY), h = hitTest(x, y);
  if (h && ['body', 'skirt', 'chest', 'belly', 'bow', 'arm', 'leg'].includes(h.type)) { touch(); hop(); line('jump', 'happy', 1.6); please(0.02); }
});
window.addEventListener('resize', resize);

// ============================================================================
//  UI panel
// ============================================================================
const SLIDERS = [
  ['angleX', '头部 X', -1, 1], ['angleY', '头部 Y', -1, 1], ['roll', '头部 Z', -0.3, 0.3], ['bodyX', '身体 X', -1, 1],
  ['eyeClose', '闭眼', 0, 1], ['mouth', '张嘴', 0, 1], ['earL', '左耳', -0.6, 0.6], ['earR', '右耳', -0.6, 0.6],
  ['tail', '尾巴', -0.8, 0.8], ['blush', '脸红', 0, 1], ['breath', '呼吸', 0, 1],
];
function buildUI() {
  const pb = $('#poseBtns'); pb.innerHTML = '';
  for (const k in POSES) { const b = document.createElement('button'); b.textContent = POSES[k].name; b.dataset.pose = k; b.onclick = () => switchPose(k); pb.append(b); }
  const sl = $('#sliders'); sl.innerHTML = '';
  for (const [key, label, mn, mx] of SLIDERS) {
    const row = document.createElement('div'); row.className = 'sl';
    row.innerHTML = `<span>${label}</span><input type="range" min="${mn}" max="${mx}" step="0.01" value="${key === 'breath' ? 0.5 : 0}"><span>auto</span>`;
    const inp = row.querySelector('input'), val = row.lastElementChild;
    inp.oninput = () => { S.manual[key] = +inp.value; val.textContent = (+inp.value).toFixed(2); touch(); };
    row.reset = () => { delete S.manual[key]; val.textContent = 'auto'; inp.value = key === 'breath' ? 0.5 : 0; };
    sl.append(row);
  }
  $('#resetParams').onclick = () => { for (const r of $('#sliders').children) r.reset(); };
  document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    touch(); const a = b.dataset.act;
    if (a === 'talk') say(pick(LINES.idle.concat(LINES.greet)), pick(['smile', 'gentle', 'happy']));
    if (a === 'hop') { hop(); line('jump', 'happy', 1.6); }
    if (a === 'twitch') { twitchEars(); }
    if (a === 'swish') swish(1.3);
    if (a === 'sleep') { S.sleep = 2; S.wakeGrace = S.t + 4; line('sleep', null); }
    if (a === 'love') { S.aff = 1; S.loveArmed = false; S.anim = null; S.lovePending = true; }
  });
  const opt = (id, k) => { const el = $(id); el.onchange = () => { S.opt[k] = el.checked; }; };
  opt('#optFollow', 'follow'); opt('#optWind', 'wind'); opt('#optIdle', 'idle'); opt('#optMesh', 'mesh');
  const syncPanel = () => $('#panelToggle').classList.toggle('on', !$('#panel').classList.contains('closed'));
  $('#panelToggle').onclick = () => { $('#panel').classList.toggle('closed'); syncPanel(); resize(); };
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.tabpage').forEach(p => p.classList.toggle('on', p.dataset.page === b.dataset.tab));
  });
  if (innerWidth <= 760 || PET) $('#panel').classList.add('closed');
  syncPanel();
}
function refreshExprButtons() {
  const eb = $('#exprBtns'); eb.innerHTML = '';
  for (const sem in pose.cfg.sem) {
    const b = document.createElement('button'); b.textContent = EXPR_LABELS[sem] || sem;
    b.onclick = () => { touch(); setFace(sem, 4); if (sem === 'shock') { kick(0.4); emit('surprise', ...headTop(), 1, { size: 30 }); } if (sem === 'happy') emit('heart', ...headTop(), 2); };
    eb.append(b);
  }
  document.querySelectorAll('#poseBtns button').forEach(b => b.classList.toggle('on', b.dataset.pose === pose.key));
}
function activate(key) {
  pose = poses[key];
  S.hair = pose.rig.strands.map(() => spr());
  S.earPull = [null, null]; S.earSpring = null; S.tailDrag = null; S.tailSpring = null; S.hairDrag = null; S.hairSpring = null; S.pat = null; S.skirtPull = null; S.skirtSpring = null;
  S.face.cur = semId('neutral')[0]; S.face.prev = null; S.face.fade = 1; S.face.until = 0; S.face.curSem = 'neutral';
  refreshExprButtons();
}
// poses are baked on demand (a couple of seconds each), so start-up only waits for the first one
const baking = {};
function ensurePose(key) {
  return baking[key] || (baking[key] = (async () => {
    await new Promise(r => setTimeout(r, 30));
    poses[key] = buildPose(key, POSES[key], await bakePose(POSES[key]));
  })());
}
async function switchPose(key, quiet) {
  if (pose.key === key) return;
  if (S.switching) return;
  S.switching = true; touch();
  if (!poses[key]) { think(); await ensurePose(key); }
  for (let i = 0; i <= 10; i++) { S.globalAlpha = 1 - i / 10; await new Promise(r => setTimeout(r, 18)); }
  activate(key); Store.save({ pose: key });
  for (let i = 0; i <= 10; i++) { S.globalAlpha = i / 10; await new Promise(r => setTimeout(r, 18)); }
  S.switching = false;
  if (!quiet) { hop(); line('pose', 'smile', 2); }
}

setInterval(() => {
  $('#mAff').style.width = (S.aff * 100).toFixed(0) + '%'; $('#mAng').style.width = (Math.min(1, S.ang) * 100).toFixed(0) + '%';
  $('#meters').classList.toggle('love', S.aff > 0.995);
}, 200);

// ============================================================================
//  Boot
// ============================================================================
// waits for ui.js, which loads after this file
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await Store.load(); await Voice.init();
    buildUI(); initUI(); resize();
    let first = new URLSearchParams(location.search).get('pose') || Store.data.pose || 'a';
    if (!POSES[first]) first = 'a';
    $('#loadText').textContent = '正在烘焙表情差分…';
    await ensurePose(first);
    activate(first);
    $('#loading').classList.add('done');
    requestAnimationFrame(frame);
    setTimeout(() => {
      const g = pickLine(LINES.greet);
      say(g.replace('你好呀', `你好呀，我是${Store.data.name}`), 'smile', 2.5, { ja: g === '你好呀～' ? `こんにちは、${Voice.jaName()}です～` : null });
    }, 700);
    window.__L2D = { S, poses, get pose() { return pose; }, setFace, say, hop, toScreen, view, hitTest, Voice };
  } catch (err) { console.error(err); $('#loadText').textContent = '加载失败：' + err.message; }
});
