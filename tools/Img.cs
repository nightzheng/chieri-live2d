// Small image toolkit for preparing the UI art (System.Drawing + LockBits).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class Px {
  public int W, H; public byte[] D;   // BGRA
  public static Px Load(string f) {
    using (var src = new Bitmap(f)) {
      var b = new Bitmap(src.Width, src.Height, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(b)) { g.CompositingMode = CompositingMode.SourceCopy; g.DrawImage(src, 0, 0, src.Width, src.Height); }
      return From(b);
    }
  }
  public static Px From(Bitmap b) {
    var p = new Px { W = b.Width, H = b.Height, D = new byte[b.Width * b.Height * 4] };
    var bd = b.LockBits(new Rectangle(0, 0, b.Width, b.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    for (int y = 0; y < b.Height; y++) Marshal.Copy(bd.Scan0 + y * bd.Stride, p.D, y * b.Width * 4, b.Width * 4);
    b.UnlockBits(bd); b.Dispose(); return p;
  }
  public Bitmap ToBitmap() {
    var b = new Bitmap(W, H, PixelFormat.Format32bppArgb);
    var bd = b.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
    for (int y = 0; y < H; y++) Marshal.Copy(D, y * W * 4, bd.Scan0 + y * bd.Stride, W * 4);
    b.UnlockBits(bd); return b;
  }
  public void Save(string f) { using (var b = ToBitmap()) b.Save(f, ImageFormat.Png); }
  public byte A(int x, int y) { return D[(y * W + x) * 4 + 3]; }

  public string Stats() {
    long z = 0, full = 0, mid = 0; for (int i = 3; i < D.Length; i += 4) { if (D[i] == 0) z++; else if (D[i] == 255) full++; else mid++; }
    return string.Format("{0}x{1} a0={2:P1} a255={3:P1} mid={4:P1} corners=[{5},{6},{7},{8}]", W, H, z / (double)(W * H), full / (double)(W * H), mid / (double)(W * H),
      A(0, 0), A(W - 1, 0), A(0, H - 1), A(W - 1, H - 1));
  }
  // connected components of alpha > t (8-neighbour); returns list of (count, minx, miny, maxx, maxy) and a label map
  public List<int[]> Components(int t, out int[] lab) {
    lab = new int[W * H]; var res = new List<int[]>(); var st = new Stack<int>();
    for (int i = 0; i < W * H; i++) {
      if (lab[i] != 0 || D[i * 4 + 3] <= t) continue;
      int id = res.Count + 1, n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0; lab[i] = id; st.Push(i);
      while (st.Count > 0) {
        int k = st.Pop(), x = k % W, y = k / W; n++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
          int nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          int q = ny * W + nx; if (lab[q] == 0 && D[q * 4 + 3] > t) { lab[q] = id; st.Push(q); }
        }
      }
      res.Add(new[] { n, x0, y0, x1, y1 });
    }
    return res;
  }
  // keep only components with at least minPx pixels (alpha > t); everything else (and faint haze <= t far from kept parts) cleared
  public int Despeckle(int t, int minPx) {
    int[] lab; var cs = Components(t, out lab); int removed = 0;
    var keep = new bool[cs.Count + 1]; for (int i = 0; i < cs.Count; i++) keep[i + 1] = cs[i][0] >= minPx;
    // faint pixels survive only next to a kept component (soft edges)
    var near = new bool[W * H];
    for (int i = 0; i < W * H; i++) if (lab[i] > 0 && keep[lab[i]]) {
      int x = i % W, y = i / W;
      for (int dy = -3; dy <= 3; dy++) for (int dx = -3; dx <= 3; dx++) { int nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) near[ny * W + nx] = true; }
    }
    for (int i = 0; i < W * H; i++) {
      bool ok = lab[i] > 0 ? keep[lab[i]] : near[i];
      if (!ok && D[i * 4 + 3] > 0) { D[i * 4 + 3] = 0; removed++; }
    }
    return removed;
  }
  // alpha levels: lo -> 0, hi -> 255 (generated cut-outs come with ~253 interiors and faint haze)
  public void Levels(int lo, int hi) {
    for (int i = 3; i < D.Length; i += 4) { int a = (D[i] - lo) * 255 / (hi - lo); D[i] = (byte)(a < 0 ? 0 : a > 255 ? 255 : a); }
  }
  public void ScaleAlpha(double f) { for (int i = 3; i < D.Length; i += 4) D[i] = (byte)Math.Round(D[i] * f); }
  // paste s centred into a w x h box at (x, y) of this image, scaled to fit inside pad
  public void Blit(Px s, int x, int y, int w, int h, int pad) {
    double k = Math.Min((w - 2.0 * pad) / s.W, (h - 2.0 * pad) / s.H);
    int sw = Math.Max(1, (int)Math.Round(s.W * k)), sh = Math.Max(1, (int)Math.Round(s.H * k));
    var r = Resize(s, sw, sh); int ox = x + (w - sw) / 2, oy = y + (h - sh) / 2;
    for (int j = 0; j < sh; j++) Buffer.BlockCopy(r.D, j * sw * 4, D, ((oy + j) * W + ox) * 4, sw * 4);
  }
  public static Px Blank(int w, int h) { return new Px { W = w, H = h, D = new byte[w * h * 4] }; }
  public Rectangle Bounds(int t) {
    int x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) if (D[(y * W + x) * 4 + 3] > t) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? Rectangle.Empty : Rectangle.FromLTRB(x0, y0, x1 + 1, y1 + 1);
  }
  // make near-white (and its soft edge) transparent: for images whose "transparent" background came out white
  public void KeyWhite(int lo, int hi) {
    for (int i = 0; i < W * H; i++) {
      int b = D[i * 4], g = D[i * 4 + 1], r = D[i * 4 + 2], m = Math.Min(r, Math.Min(g, b)), sat = Math.Max(r, Math.Max(g, b)) - m;
      if (sat > 24) continue;
      double a = m >= hi ? 0 : m <= lo ? 1 : (hi - m) / (double)(hi - lo);
      D[i * 4 + 3] = (byte)Math.Min(D[i * 4 + 3], (int)Math.Round(255 * a));
    }
  }
  public static Px Crop(Px s, Rectangle r) {
    var p = new Px { W = r.Width, H = r.Height, D = new byte[r.Width * r.Height * 4] };
    for (int y = 0; y < r.Height; y++) Buffer.BlockCopy(s.D, ((r.Y + y) * s.W + r.X) * 4, p.D, y * r.Width * 4, r.Width * 4);
    return p;
  }
  // high-quality resize with premultiplied alpha (no dark fringes)
  public static Px Resize(Px s, int w, int h) {
    using (var src = s.ToBitmap()) {
      var dst = new Bitmap(w, h, PixelFormat.Format32bppPArgb);
      using (var g = Graphics.FromImage(dst)) {
        g.CompositingMode = CompositingMode.SourceCopy; g.InterpolationMode = InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = PixelOffsetMode.HighQuality; g.SmoothingMode = SmoothingMode.HighQuality;
        using (var ia = new ImageAttributes()) { ia.SetWrapMode(WrapMode.TileFlipXY); g.DrawImage(src, new Rectangle(0, 0, w, h), 0, 0, s.W, s.H, GraphicsUnit.Pixel, ia); }
      }
      var o = new Bitmap(w, h, PixelFormat.Format32bppArgb);
      using (var g = Graphics.FromImage(o)) { g.CompositingMode = CompositingMode.SourceCopy; g.DrawImage(dst, 0, 0); }
      dst.Dispose(); return From(o);
    }
  }
  public static void SaveJpeg(Px p, string f, long q) {
    var enc = Array.Find(ImageCodecInfo.GetImageEncoders(), e => e.MimeType == "image/jpeg");
    var ps = new EncoderParameters(1); ps.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, q);
    using (var b = p.ToBitmap()) using (var b24 = new Bitmap(b.Width, b.Height, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(b24)) g.DrawImage(b, 0, 0); b24.Save(f, enc, ps);
    }
  }
}
