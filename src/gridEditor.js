// Full-screen editor for describing where a chart's stitch grid sits on a PDF page.
// Grid lines are numbered the way charts print them: the left edge of the chart is line 0,
// the right edge of stitch 83 is line 83 (so a page of 83 stitches runs from line 0 to line 83).
// The grid is drawn over the page. Each edge has its own handle so it can be moved purely
// horizontally or vertically; corners move two edges; the centre handle moves the whole grid.
// Edits are written straight into the import screen's input fields.
import { h } from './ui.js';
import { makeCanvas } from './pdfio.js';

export const FIELD_DEFS = [
  ['left', 'Left line #'], ['right', 'Right line #'], ['top', 'Top line #'], ['bottom', 'Bottom line #'],
  ['pitchX', 'Cell width (pt)'], ['pitchY', 'Cell height (pt)'], ['x0', 'Grid left (pt)'], ['yTop', 'Grid top (pt)'],
];
const R = 15; // handle radius in css px
const LINE_KEYS = ['left', 'right', 'top', 'bottom'];

// Changing a line number must not move or grow the grid on the page: the grid keeps its
// physical box and the cells are re-divided to fit. We remember the box in PDF points and
// only refresh it when something other than a line number changes.
const boxes = new WeakMap();
const val = (f, k) => Number(f[k].value);
const round3 = (v) => String(Math.round(v * 1000) / 1000);
function boxOf(f) {
  const cols = val(f, 'right') - val(f, 'left'), rows = val(f, 'bottom') - val(f, 'top');
  const L = val(f, 'x0'), T = val(f, 'yTop');
  return { L, T, R: L + cols * val(f, 'pitchX'), B: T - rows * val(f, 'pitchY') };
}
/** Re-reads the grid's physical box from the fields (call after setting field values by hand). */
export function rebox(fields) { boxes.set(fields, boxOf(fields)); }
/** Wires up a set of grid inputs so line-number edits keep the grid in place. */
export function bindGridFields(fields, onChange) {
  rebox(fields);
  for (const k of Object.keys(fields)) {
    fields[k].addEventListener('input', () => {
      if (LINE_KEYS.includes(k)) {
        const b = boxes.get(fields);
        const cols = val(fields, 'right') - val(fields, 'left'), rows = val(fields, 'bottom') - val(fields, 'top');
        if (b && cols > 0 && rows > 0) {
          fields.pitchX.value = round3((b.R - b.L) / cols);
          fields.pitchY.value = round3((b.T - b.B) / rows);
        }
      } else {
        rebox(fields);
      }
      onChange?.();
    });
  }
}

/**
 * @param page   pdf.js page
 * @param fields {left,right,top,bottom,pitchX,pitchY,x0,yTop} -> <input> elements (the source of truth)
 * @param title  heading text
 * @returns {Promise<void>} resolves when the user presses Done
 */
export function openGridEditor({ page, fields, title }) {
  return new Promise((resolve) => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const [vx0, vy0, vx1, vy1] = page.view; // left, bottom, right, top in PDF points
    const pageW = vx1 - vx0, pageH = vy1 - vy0;
    const fitZ = Math.min(window.innerWidth - 24, 900) / pageW;
    let z = fitZ; // css pixels per PDF point
    let renderToken = 0;

    const base = h('canvas');
    const over = h('canvas');
    const stage = h('div', { class: 'ge-stage' }, base, over);
    const scroller = h('div', { class: 'ge-scroll' }, stage);

    const inputs = {};
    const panel = h('div', { class: 'ge-fields' }, FIELD_DEFS.map(([k, label]) => {
      const inp = h('input', { type: 'number', step: 'any', value: fields[k].value, inputmode: 'decimal' });
      inp.addEventListener('input', () => { fields[k].value = inp.value; fields[k].dispatchEvent(new Event('input')); sync(); drawOverlay(); });
      inputs[k] = inp;
      return h('label', {}, label, inp);
    }));

    // line-number edits can change the cell size fields; mirror them back unless being typed in
    const sync = () => { for (const [k] of FIELD_DEFS) if (document.activeElement !== inputs[k]) inputs[k].value = fields[k].value; };
    const num = (k) => Number(inputs[k].value);
    const setVal = (k, v) => {
      const s = String(Math.round(v * 1000) / 1000);
      inputs[k].value = s; fields[k].value = s; fields[k].dispatchEvent(new Event('input'));
    };

    const root = h('div', { class: 'ge' },
      h('div', { class: 'topbar' },
        h('h1', {}, title),
        h('button', { 'aria-label': 'Zoom out', onclick: () => zoom(1 / 1.4) }, '−'),
        h('button', { 'aria-label': 'Zoom in', onclick: () => zoom(1.4) }, '+'),
        h('button', { class: 'primary', onclick: close }, 'Done')),
      h('p', { class: 'ge-help' }, 'Line up the red grid with the chart. Round handles move a corner, square handles move one edge straight across or up and down, the centre handle moves the whole grid. Drag anywhere else to scroll. Line numbers start at 0 on the left/top edge of the chart.'),
      scroller,
      panel);
    document.body.append(root);

    function close() { renderToken++; root.remove(); resolve(); }

    function layout() {
      const w = Math.round(pageW * z), hgt = Math.round(pageH * z);
      for (const c of [base, over]) {
        c.style.width = w + 'px'; c.style.height = hgt + 'px';
        c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr);
      }
      stage.style.width = w + 'px'; stage.style.height = hgt + 'px';
    }

    async function renderPage() {
      const token = ++renderToken;
      const tmp = makeCanvas(base.width, base.height);
      try { await page.render({ canvasContext: tmp.getContext('2d'), viewport: page.getViewport({ scale: z * dpr }) }).promise; } catch { return; }
      if (token !== renderToken) return;
      base.getContext('2d').drawImage(tmp, 0, 0);
    }

    const toScreen = (x, y) => [(x - vx0) * z, (vy1 - y) * z];
    const toPdf = (sx, sy) => [vx0 + sx / z, vy1 - sy / z];

    /** Grid box in PDF points. */
    function box() {
      const cols = num('right') - num('left'), rows = num('bottom') - num('top');
      const L = num('x0'), T = num('yTop');
      return { cols, rows, L, T, R: L + cols * num('pitchX'), B: T - rows * num('pitchY') };
    }

    function handles() {
      const b = box();
      const mx = (b.L + b.R) / 2, my = (b.T + b.B) / 2;
      return [
        { id: 'tl', corner: true, p: toScreen(b.L, b.T) }, { id: 'tr', corner: true, p: toScreen(b.R, b.T) },
        { id: 'bl', corner: true, p: toScreen(b.L, b.B) }, { id: 'br', corner: true, p: toScreen(b.R, b.B) },
        { id: 't', p: toScreen(mx, b.T) }, { id: 'b', p: toScreen(mx, b.B) },
        { id: 'l', p: toScreen(b.L, my) }, { id: 'r', p: toScreen(b.R, my) },
        { id: 'move', move: true, p: toScreen(mx, my) },
      ];
    }

    function drawOverlay() {
      const ctx = over.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, over.width, over.height);
      const b = box();
      const px = num('pitchX'), py = num('pitchY');
      const cols = Math.round(b.cols), rows = Math.round(b.rows);
      if (!(px > 0 && py > 0 && cols > 0 && rows > 0 && cols < 1000 && rows < 1000)) return;
      const [lx, ty] = toScreen(b.L, b.T);
      const w = cols * px * z, ht = rows * py * z;
      const l0 = Math.round(num('left')), t0 = Math.round(num('top'));
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#c00';
      for (let i = 0; i <= cols; i++) {
        const n = l0 + i, ten = n % 10 === 0;
        if (px * z < 3 && !ten) continue;
        ctx.strokeStyle = ten ? 'rgba(220,30,30,.9)' : 'rgba(220,30,30,.35)';
        const x = lx + i * px * z;
        ctx.beginPath(); ctx.moveTo(x, ty); ctx.lineTo(x, ty + ht); ctx.stroke();
        if (ten) ctx.fillText(String(n), x + 2, ty - 4);
      }
      for (let j = 0; j <= rows; j++) {
        const n = t0 + j, ten = n % 10 === 0;
        if (py * z < 3 && !ten) continue;
        ctx.strokeStyle = ten ? 'rgba(220,30,30,.9)' : 'rgba(220,30,30,.35)';
        const y = ty + j * py * z;
        ctx.beginPath(); ctx.moveTo(lx, y); ctx.lineTo(lx + w, y); ctx.stroke();
        if (ten) ctx.fillText(String(n), Math.max(0, lx - 26), y - 2);
      }
      for (const hd of handles()) {
        const [x, y] = hd.p;
        ctx.fillStyle = 'rgba(30,110,255,.35)'; ctx.strokeStyle = '#1e6eff'; ctx.lineWidth = 2;
        ctx.beginPath();
        if (hd.corner || hd.move) ctx.arc(x, y, R, 0, Math.PI * 2); else ctx.rect(x - R * 0.6, y - R * 0.6, R * 1.2, R * 1.2);
        ctx.fill(); ctx.stroke();
        if (hd.move) {
          ctx.beginPath();
          ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8); ctx.stroke();
        }
      }
      ctx.lineWidth = 1;
    }

    let zoomTimer = 0;
    function zoom(f) {
      const next = Math.min(fitZ * 10, Math.max(fitZ * 0.6, z * f));
      if (next * pageW * dpr > 9000) return;
      const cx = scroller.scrollLeft + scroller.clientWidth / 2, cy = scroller.scrollTop + scroller.clientHeight / 2;
      const k = next / z;
      z = next;
      layout();
      scroller.scrollLeft = cx * k - scroller.clientWidth / 2;
      scroller.scrollTop = cy * k - scroller.clientHeight / 2;
      drawOverlay();
      clearTimeout(zoomTimer);
      zoomTimer = setTimeout(renderPage, 120);
    }

    // ---- dragging ----
    const MIN = 0.2; // smallest allowed cell size in points
    function dragTo(id, px, py, start) {
      const b = start; // grid box when the drag began
      const cols = b.cols, rows = b.rows;
      let { L, R: Rt, T, B } = b;
      if (id === 'move') {
        const dx = px - start.gx, dy = py - start.gy;
        L += dx; Rt += dx; T += dy; B += dy;
      } else {
        if (id === 'l' || id === 'tl' || id === 'bl') L = px;
        if (id === 'r' || id === 'tr' || id === 'br') Rt = px;
        if (id === 't' || id === 'tl' || id === 'tr') T = py;
        if (id === 'b' || id === 'bl' || id === 'br') B = py;
      }
      const pX = (Rt - L) / cols, pY = (T - B) / rows;
      if (pX < MIN || pY < MIN) return;
      setVal('x0', L); setVal('yTop', T); setVal('pitchX', pX); setVal('pitchY', pY);
    }

    let drag = null;
    over.style.touchAction = 'none';
    over.addEventListener('pointerdown', (e) => {
      const r = over.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      over.setPointerCapture(e.pointerId);
      const hit = handles().find((hd) => Math.hypot(hd.p[0] - sx, hd.p[1] - sy) <= R * 1.7);
      if (hit) {
        const [gx, gy] = toPdf(sx, sy);
        drag = { kind: 'handle', id: hit.id, start: { ...box(), gx, gy } };
      } else {
        drag = { kind: 'scroll', x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop };
      }
    });
    over.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.kind === 'scroll') {
        scroller.scrollLeft = drag.sl - (e.clientX - drag.x);
        scroller.scrollTop = drag.st - (e.clientY - drag.y);
        return;
      }
      const r = over.getBoundingClientRect();
      const [px, py] = toPdf(e.clientX - r.left, e.clientY - r.top);
      dragTo(drag.id, px, py, drag.start);
      drawOverlay();
    });
    const end = () => { drag = null; };
    over.addEventListener('pointerup', end);
    over.addEventListener('pointercancel', end);

    layout();
    drawOverlay();
    renderPage();
  });
}
