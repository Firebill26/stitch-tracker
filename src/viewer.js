// The stitching canvas: pan / zoom, page images, progress overlay, and touch input.
//
// Gestures
//   one finger drag ............ pan
//   tap ........................ empty -> half -> full -> empty
//   double tap ................. full
//   touch and hold, then drag .. paint full stitches
//   two fingers / wheel ........ zoom
import { paintOrder } from './layout.js';
import { drawPage, makeCanvas } from './pdfio.js';

export const TILE_CELL = 8; // pixels per stitch in the pre-rendered page images
const HOLD_MS = 350;
const DOUBLE_TAP_MS = 320;
const MOVE_SLOP = 8;
const MAX_CELL_PX = 80;
const RULER_W = 30; // width of the line-number strip on the left
const RULER_H = 20; // height of the strip along the top

export class Viewer {
  /**
   * @param canvas   target canvas
   * @param pattern  pattern record
   * @param tiles    ImageBitmap[] pre-rendered pages (same order as pattern.pages)
   * @param getPage  (pdfPageNumber) => Promise<pdf.js page>  for sharp zoomed-in rendering
   * @param progress Uint8Array(width*height)
   * @param hooks    { onChange(), onView() }
   */
  constructor(canvas, pattern, tiles, getPage, progress, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.pattern = pattern;
    this.tiles = tiles;
    this.getPage = getPage;
    this.cells = progress;
    this.hooks = hooks;
    this.view = Math.min(pattern.lastView ?? 0, (pattern.views?.length || 1) - 1);
    this.order = paintOrder(pattern.pages, this.view);
    this.W = pattern.width;
    this.H = pattern.height;

    this.s = 1; this.tx = 0; this.ty = 0; // cell size in css px, pattern origin in css px
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.hi = null;           // sharp render of the current view
    this.hiToken = 0;
    this.hiTimer = 0;
    this.undoStack = [];
    this.pointers = new Map();
    this.gesture = null;
    this.lastTap = null;
    this.dirty = true;
    this.tapMode = 'half'; // 'half': tap = half, then full, then clear. 'full': tap = full, then clear.

    // Small bitmap of progress, used when cells are too small to draw individually.
    this.mini = makeCanvas(this.W, this.H);
    this.miniCtx = this.mini.getContext('2d');
    this.miniData = this.miniCtx.createImageData(this.W, this.H);
    for (let i = 0; i < this.cells.length; i++) this.paintMini(i);
    this.miniCtx.putImageData(this.miniData, 0, 0);

    this.bind();
    this.resize();
    this.fit();
    const loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } this.raf = requestAnimationFrame(loop); };
    loop();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.hiTimer);
    this.hiToken++;
    this.unbind();
    this.tiles.forEach((t) => t.close?.());
  }

  setView(v) {
    this.view = v;
    this.order = paintOrder(this.pattern.pages, v);
    this.hi = null;
    this.hiToken++;
    this.invalidate();
  }

  // ---- geometry -----------------------------------------------------------

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.cw = r.width; this.ch = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.invalidate();
  }

  fit() {
    const pad = 12;
    const availW = this.cw - RULER_W - pad * 2, availH = this.ch - RULER_H - pad * 2;
    this.s = Math.min(availW / this.W, availH / this.H);
    this.minS = this.s * 0.8;
    this.tx = RULER_W + pad + (availW - this.W * this.s) / 2;
    this.ty = RULER_H + pad + (availH - this.H * this.s) / 2;
    this.invalidate();
  }

  zoomBy(f, cx = this.cw / 2, cy = this.ch / 2) {
    const s = Math.min(MAX_CELL_PX, Math.max(this.minS, this.s * f));
    f = s / this.s;
    this.tx = cx - (cx - this.tx) * f;
    this.ty = cy - (cy - this.ty) * f;
    this.s = s;
    this.invalidate();
  }

  panBy(dx, dy) { this.tx += dx; this.ty += dy; this.invalidate(); }

  cellAt(x, y) {
    if (x < RULER_W || y < RULER_H) return -1; // over the line-number strips
    const c = Math.floor((x - this.tx) / this.s);
    const r = Math.floor((y - this.ty) / this.s);
    return c >= 0 && r >= 0 && c < this.W && r < this.H ? r * this.W + c : -1;
  }

  invalidate() {
    this.dirty = true;
    this.hooks.onView?.();
    clearTimeout(this.hiTimer);
    if (!this.gesture) this.hiTimer = setTimeout(() => this.renderSharp(), 180);
  }

  // ---- progress -----------------------------------------------------------

  setCell(i, v, record) {
    const old = this.cells[i];
    if (old === v) return false;
    record?.push([i, old]);
    this.cells[i] = v;
    this.paintMini(i);
    return true;
  }

  paintMini(i) {
    const v = this.cells[i], d = this.miniData.data, o = i * 4;
    if (v === 2) { d[o] = 40; d[o + 1] = 170; d[o + 2] = 70; d[o + 3] = 170; }
    else if (v === 1) { d[o] = 240; d[o + 1] = 170; d[o + 2] = 30; d[o + 3] = 150; }
    else d[o + 3] = 0;
  }

  /** Applies a batch of changes as one undoable action. */
  commit(record) {
    if (!record.length) return;
    this.undoStack.push(record);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.miniCtx.putImageData(this.miniData, 0, 0);
    this.dirty = true;
    this.hooks.onChange?.();
  }

  undo() {
    const rec = this.undoStack.pop();
    if (!rec) return;
    for (let k = rec.length - 1; k >= 0; k--) { this.cells[rec[k][0]] = rec[k][1]; this.paintMini(rec[k][0]); }
    this.miniCtx.putImageData(this.miniData, 0, 0);
    this.dirty = true;
    this.hooks.onChange?.();
  }

  tapCell(i, double) {
    const rec = [];
    const cur = this.cells[i];
    const next = double ? 2
      : this.tapMode === 'full' ? (cur === 2 ? 0 : 2)
      : cur === 0 ? 1 : cur === 1 ? 2 : 0;
    this.setCell(i, next, rec);
    this.commit(rec);
  }

  paintLine(x0, y0, x1, y1, rec) {
    const target = this.tapMode === 'full' ? 2 : 1; // dragging follows the Tap toggle
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, this.s / 2)));
    for (let k = 0; k <= steps; k++) {
      const i = this.cellAt(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
      if (i >= 0 && this.cells[i] < target) this.setCell(i, target, rec); // never downgrade a finished stitch
    }
    this.miniCtx.putImageData(this.miniData, 0, 0);
    this.dirty = true;
  }

  // ---- drawing ------------------------------------------------------------

  draw() {
    const { ctx, dpr, s, tx, ty } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#d9d9de';
    ctx.fillRect(0, 0, this.cw, this.ch);
    ctx.save();
    ctx.beginPath();
    ctx.rect(tx, ty, this.W * s, this.H * s);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(tx, ty, this.W * s, this.H * s);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const { p, index } of this.order) {
      const x = tx + (p.colStart - 1) * s, y = ty + (p.rowStart - 1) * s;
      const w = p.cols * s, h = p.rows * s;
      if (x > this.cw || y > this.ch || x + w < 0 || y + h < 0) continue;
      ctx.drawImage(this.tiles[index], x, y, w, h);
    }

    if (this.hi) {
      const h = this.hi, f = s / h.s;
      ctx.drawImage(h.canvas, tx - h.tx * f, ty - h.ty * f, (h.canvas.width / h.dpr) * f, (h.canvas.height / h.dpr) * f);
    }

    if (s < 7) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.mini, tx, ty, this.W * s, this.H * s);
    } else {
      this.drawStitches();
    }
    ctx.restore();
    this.drawRulers();
  }

  /** Line numbers (0 at the chart's left/top edge) along the top and left of the view. */
  drawRulers() {
    const { ctx, s, tx, ty } = this;
    const step = [10, 20, 50, 100, 200].find((n) => n * s >= 34) || 200;
    ctx.fillStyle = 'rgba(32,44,66,0.92)';
    ctx.fillRect(0, 0, this.cw, RULER_H);
    ctx.fillRect(0, 0, RULER_W, this.ch);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1;
    ctx.font = '11px -apple-system, Segoe UI, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let n = 0; n <= this.W; n += step) {
      const x = tx + n * s;
      if (x < RULER_W + 8 || x > this.cw) continue;
      ctx.beginPath(); ctx.moveTo(x, RULER_H - 5); ctx.lineTo(x, RULER_H); ctx.stroke();
      ctx.fillText(String(n), x, RULER_H / 2 - 2);
    }
    ctx.textAlign = 'right';
    for (let n = 0; n <= this.H; n += step) {
      const y = ty + n * s;
      if (y < RULER_H + 8 || y > this.ch) continue;
      ctx.beginPath(); ctx.moveTo(RULER_W - 5, y); ctx.lineTo(RULER_W, y); ctx.stroke();
      ctx.fillText(String(n), RULER_W - 7, y);
    }
  }

  drawStitches() {
    const { ctx, s, tx, ty, W, H } = this;
    const c0 = Math.max(0, Math.floor(-tx / s)), c1 = Math.min(W - 1, Math.floor((this.cw - tx) / s));
    const r0 = Math.max(0, Math.floor(-ty / s)), r1 = Math.min(H - 1, Math.floor((this.ch - ty) / s));
    const inset = s * 0.12;
    ctx.lineCap = 'round';
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const v = this.cells[r * W + c];
        if (!v) continue;
        const x = tx + c * s, y = ty + r * s;
        if (v === 2) {
          ctx.fillStyle = 'rgba(40,170,70,0.38)';
          ctx.fillRect(x, y, s, s);
          ctx.strokeStyle = 'rgba(20,110,45,0.9)';
          ctx.lineWidth = Math.max(1, s * 0.12);
          ctx.beginPath();
          ctx.moveTo(x + inset, y + inset); ctx.lineTo(x + s - inset, y + s - inset);
          ctx.moveTo(x + s - inset, y + inset); ctx.lineTo(x + inset, y + s - inset);
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(240,170,30,0.28)';
          ctx.fillRect(x, y, s, s);
          ctx.strokeStyle = 'rgba(190,110,0,0.95)';
          ctx.lineWidth = Math.max(1, s * 0.12);
          ctx.beginPath();
          ctx.moveTo(x + inset, y + s - inset); ctx.lineTo(x + s - inset, y + inset);
          ctx.stroke();
        }
      }
    }
  }

  /** Re-renders the visible pages straight from the PDF so zoomed-in views stay sharp. */
  async renderSharp() {
    const token = ++this.hiToken;
    const { s, tx, ty, dpr } = this;
    if (s * dpr <= TILE_CELL * 1.05) { if (this.hi) { this.hi = null; this.dirty = true; } return; }
    const canvas = makeCanvas(this.cw * dpr, this.ch * dpr);
    const ctx = canvas.getContext('2d');
    try {
      for (const { p } of this.order) {
        const sx = (tx + (p.colStart - 1) * s) * dpr, sy = (ty + (p.rowStart - 1) * s) * dpr;
        const sw = p.cols * s * dpr, sh = p.rows * s * dpr;
        const x0 = Math.max(0, Math.floor(sx)), y0 = Math.max(0, Math.floor(sy));
        const x1 = Math.min(canvas.width, Math.ceil(sx + sw)), y1 = Math.min(canvas.height, Math.ceil(sy + sh));
        if (x1 <= x0 || y1 <= y0) continue;
        const page = await this.getPage(p.pdfPage);
        if (token !== this.hiToken) return;
        await drawPage(page, p, (s * dpr) / (p.pitchX ?? p.pitch), (s * dpr) / (p.pitchY ?? p.pitch), sx, sy, ctx, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        if (token !== this.hiToken) return;
      }
    } catch (e) {
      console.warn('sharp render failed', e);
      return;
    }
    if (token === this.hiToken) { this.hi = { canvas, s, tx, ty, dpr }; this.dirty = true; }
  }

  // ---- input --------------------------------------------------------------

  bind() {
    const c = this.canvas;
    this.h = {
      down: (e) => this.onDown(e),
      move: (e) => this.onMove(e),
      up: (e) => this.onUp(e),
      wheel: (e) => this.onWheel(e),
      menu: (e) => e.preventDefault(),
      resize: () => { this.resize(); },
    };
    c.addEventListener('pointerdown', this.h.down);
    c.addEventListener('pointermove', this.h.move);
    c.addEventListener('pointerup', this.h.up);
    c.addEventListener('pointercancel', this.h.up);
    c.addEventListener('wheel', this.h.wheel, { passive: false });
    c.addEventListener('contextmenu', this.h.menu);
    window.addEventListener('resize', this.h.resize);
  }

  unbind() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this.h.down);
    c.removeEventListener('pointermove', this.h.move);
    c.removeEventListener('pointerup', this.h.up);
    c.removeEventListener('pointercancel', this.h.up);
    c.removeEventListener('wheel', this.h.wheel);
    c.removeEventListener('contextmenu', this.h.menu);
    window.removeEventListener('resize', this.h.resize);
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onDown(e) {
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    clearTimeout(this.hiTimer);
    if (this.pointers.size === 1) {
      const g = (this.gesture = { mode: 'undecided', startX: p.x, startY: p.y, t: performance.now(), lastX: p.x, lastY: p.y, rec: [] });
      g.timer = setTimeout(() => {
        if (this.gesture === g && g.mode === 'undecided') {
          g.mode = 'paint';
          navigator.vibrate?.(15);
          this.paintLine(g.lastX, g.lastY, g.lastX, g.lastY, g.rec);
        }
      }, HOLD_MS);
    } else if (this.pointers.size === 2) {
      this.endGesture(true);
      const [a, b] = [...this.pointers.values()];
      this.gesture = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, rec: [] };
    }
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.mode === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      this.panBy(mx - g.mx, my - g.my);
      if (g.dist > 0) this.zoomBy(dist / g.dist, mx, my);
      g.dist = dist; g.mx = mx; g.my = my;
      return;
    }
    if (this.pointers.size !== 1) return;
    if (g.mode === 'undecided') {
      if (Math.hypot(p.x - g.startX, p.y - g.startY) > MOVE_SLOP) { clearTimeout(g.timer); g.mode = 'pan'; }
    }
    if (g.mode === 'pan') this.panBy(p.x - g.lastX, p.y - g.lastY);
    else if (g.mode === 'paint') this.paintLine(g.lastX, g.lastY, p.x, p.y, g.rec);
    g.lastX = p.x; g.lastY = p.y;
  }

  onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g && g.mode === 'undecided' && e.type === 'pointerup') {
      this.handleTap(p.x, p.y);
    }
    if (this.pointers.size === 0) this.endGesture();
    else if (g && g.mode === 'pinch') { this.gesture = null; this.invalidate(); }
  }

  endGesture(silent) {
    const g = this.gesture;
    if (!g) return;
    clearTimeout(g.timer);
    if (g.mode === 'paint') this.commit(g.rec);
    this.gesture = null;
    if (!silent) this.invalidate();
  }

  handleTap(x, y) {
    const i = this.cellAt(x, y);
    if (i < 0) return;
    const now = performance.now();
    const lt = this.lastTap;
    if (lt && lt.i === i && now - lt.t < DOUBLE_TAP_MS) {
      // Second tap: the first tap already changed the cell, so undo it then mark complete.
      this.undo();
      this.tapCell(i, true);
      this.lastTap = null;
    } else {
      this.tapCell(i, false);
      this.lastTap = { i, t: now };
    }
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.local(e);
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) {
      this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), p.x, p.y);
    } else {
      this.panBy(-e.deltaX, -e.deltaY);
    }
  }

  stats() {
    let full = 0, half = 0;
    for (let i = 0; i < this.cells.length; i++) { if (this.cells[i] === 2) full++; else if (this.cells[i] === 1) half++; }
    return { full, half, total: this.cells.length };
  }
}
