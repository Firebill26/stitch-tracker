// Detects the stitch grid on a PDF chart page.
// Works from the PDF's own data (text labels, filled cell squares or grid lines), not from pixels.
// Takes the pdfjs OPS table as a parameter so it runs in both the browser and node.
//
// Supported grid styles
//   cells : one filled square per stitch (e.g. the Bowser Baddies sample)
//   lines : a drawn lattice of grid lines (e.g. the Mario Sampler sample)
// Axis numbers (multiples of 10) may be upright or rotated, centred on a grid line or on a cell.

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : NaN;
};

function mode(values, tol) {
  let best = null;
  for (const v of values) {
    const n = values.filter((w) => Math.abs(w - v) <= tol).length;
    if (!best || n > best.n) best = { v, n };
  }
  return best;
}

/** Walks a pdf.js constructPath op into line segments and rectangles. */
function* shapes(args, OPS) {
  const [ops, c] = args;
  // Some generators draw filled bands (e.g. shaded overlap strips) as a 4-corner polygon instead of a rectangle.
  if (ops.length >= 4 && ops[0] === OPS.moveTo && ops[1] === OPS.lineTo && ops[2] === OPS.lineTo && ops[3] === OPS.lineTo &&
      (ops.length === 4 || (ops.length === 5 && ops[4] === OPS.closePath))) {
    const xs = [c[0], c[2], c[4], c[6]], ys = [c[1], c[3], c[5], c[7]];
    const ux = new Set(xs.map((v) => v.toFixed(2))), uy = new Set(ys.map((v) => v.toFixed(2)));
    if (ux.size === 2 && uy.size === 2) {
      const x = Math.min(...xs), y = Math.min(...ys);
      yield { rect: [x, y, Math.max(...xs) - x, Math.max(...ys) - y], poly: true };
    }
  }
  let p = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  for (const op of ops) {
    if (op === OPS.moveTo) { cx = sx = c[p++]; cy = sy = c[p++]; }
    else if (op === OPS.lineTo) { const x = c[p++], y = c[p++]; yield { seg: [cx, cy, x, y] }; cx = x; cy = y; }
    else if (op === OPS.curveTo) { p += 4; cx = c[p++]; cy = c[p++]; }
    else if (op === OPS.curveTo2 || op === OPS.curveTo3) { p += 2; cx = c[p++]; cy = c[p++]; }
    else if (op === OPS.closePath) { if (cx !== sx || cy !== sy) yield { seg: [cx, cy, sx, sy] }; cx = sx; cy = sy; }
    else if (op === OPS.rectangle) { yield { rect: [c[p], c[p + 1], c[p + 2], c[p + 3]] }; p += 4; }
  }
}

/**
 * @returns {{ok:boolean, reason?:string, style?:string, pitch?:number, x0?:number, yTop?:number,
 *            cols?:number, rows?:number, colStart?:number, rowStart?:number,
 *            pageHeight:number, cellCount:number}}
 */
export async function analyzePage(page, OPS) {
  const view = page.view;
  const pageW = view[2] - view[0], pageH = view[3] - view[1];
  const out = { ok: false, pageHeight: pageH, cellCount: 0 };

  // ---- axis numbers ------------------------------------------------------
  const text = await page.getTextContent();
  const labels = text.items
    .filter((i) => /^\d+$/.test(i.str.trim()) && Number(i.str) % 10 === 0 && Number(i.str) > 0)
    .map((i) => {
      const [a, b, , , x, y] = i.transform;
      const rotated = Math.abs(b) > Math.abs(a); // text running up the page
      return rotated
        ? { n: Number(i.str), rotated, pos: y + i.width / 2, key: x }
        : { n: Number(i.str), rotated, pos: x + i.width / 2, vpos: y + i.height * 0.36, key: y, right: x + i.width, h: i.height };
    });

  const upright = labels.filter((l) => !l.rotated && l.h >= 3.5);
  const colRef = mode(upright.map((l) => l.key), 0.6);
  if (!colRef || colRef.n < 3) return { ...out, reason: 'no axis numbers found' };
  const colLabels = upright.filter((l) => Math.abs(l.key - colRef.v) <= 0.6).sort((a, b) => a.pos - b.pos);

  let rowLabels = [];
  const rot = labels.filter((l) => l.rotated);
  const rotRef = mode(rot.map((l) => l.key), 1.5);
  if (rotRef && rotRef.n >= 3) {
    rowLabels = rot.filter((l) => Math.abs(l.key - rotRef.v) <= 1.5).map((l) => ({ n: l.n, cy: l.pos }));
  } else {
    const rightRef = mode(upright.map((l) => l.right), 1.2);
    if (rightRef && rightRef.n >= 3) {
      rowLabels = upright.filter((l) => Math.abs(l.right - rightRef.v) <= 1.2).map((l) => ({ n: l.n, cy: l.vpos }));
    }
  }
  rowLabels.sort((a, b) => b.cy - a.cy);
  if (rowLabels.length < 3) return { ...out, reason: 'no row numbers found' };

  const pitches = [];
  for (let i = 1; i < colLabels.length; i++) pitches.push((colLabels[i].pos - colLabels[i - 1].pos) / (colLabels[i].n - colLabels[i - 1].n));
  for (let i = 1; i < rowLabels.length; i++) pitches.push((rowLabels[i - 1].cy - rowLabels[i].cy) / (rowLabels[i].n - rowLabels[i - 1].n));
  const pitch = median(pitches);
  if (!(pitch > 0.5)) return { ...out, reason: 'could not measure cell size' };

  // ---- grid extent -------------------------------------------------------
  const ops = await page.getOperatorList();
  let fill = [0, 0, 0];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, count = 0;
  let printed = null;
  const masks = [];
  const bigRects = [];
  const vlines = [], hlines = [];
  const inked = []; // filled cell squares that are not blank paper

  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i];
    if (f === OPS.setFillRGBColor) { fill = ops.argsArray[i]; continue; }
    if (f !== OPS.constructPath) continue;
    for (const s of shapes(ops.argsArray[i], OPS)) {
      if (s.rect && s.poly) {
        // Polygon "rectangles" only count as big shapes (overlap strips, grid box), never as stitch cells.
        const [x, y, w, h] = s.rect;
        if (w > pitch * 3 || h > pitch * 3) bigRects.push({ x, y, w, h });
        if (!printed && count === 0 && w > pitch * 20 && h > pitch * 20 && w < pageW * 0.95 && h < pageH * 0.95) printed = { x, y, w, h };
      } else if (s.rect) {
        const [x, y, w, h] = s.rect;
        if (Math.abs(w - pitch) <= pitch * 0.05 && Math.abs(h - pitch) <= pitch * 0.05) {
          count++;
          if (fill[0] < 246 || fill[1] < 246 || fill[2] < 246) inked.push({ x, y, h });
          if (x < minX) minX = x;
          if (x + w > maxX) maxX = x + w;
          if (y < minY) minY = y;
          if (y + h > maxY) maxY = y + h;
        } else if (!printed && count === 0 && w > pitch * 20 && h > pitch * 20 && w < pageW * 0.95 && h < pageH * 0.95) {
          printed = { x, y, w, h };
        }
        if (w > pitch * 3 || h > pitch * 3) bigRects.push({ x, y, w, h });
        if (fill[0] > 250 && fill[1] > 250 && fill[2] > 250 && (w > pageW * 0.5 || h > pageH * 0.5)) masks.push({ x, y, w, h });
      } else {
        const [x1, y1, x2, y2] = s.seg;
        if (Math.abs(x1 - x2) < 0.02 && Math.abs(y1 - y2) > pitch * 5) vlines.push({ x: x1, len: Math.abs(y1 - y2), lo: Math.min(y1, y2), hi: Math.max(y1, y2) });
        else if (Math.abs(y1 - y2) < 0.02 && Math.abs(x1 - x2) > pitch * 5) hlines.push({ y: y1, len: Math.abs(x1 - x2), lo: Math.min(x1, x2), hi: Math.max(x1, x2) });
      }
    }
  }
  out.cellCount = count;

  let style = 'cells';
  if (count < 50) {
    style = 'lines';
    const vMax = Math.max(0, ...vlines.map((l) => l.len)), hMax = Math.max(0, ...hlines.map((l) => l.len));
    const v = vlines.filter((l) => l.len > vMax * 0.6), hl = hlines.filter((l) => l.len > hMax * 0.6);
    if (v.length < 10 || hl.length < 10) return { ...out, reason: 'no cell grid found', pitch };
    minX = Math.min(...v.map((l) => l.x)); maxX = Math.max(...v.map((l) => l.x));
    minY = Math.min(...v.map((l) => l.lo)); maxY = Math.max(...v.map((l) => l.hi));
    // Shaded overlap bands carry no grid lines; the page's white grid box still covers them.
    if (printed) {
      const snap = (val, ref) => ref + Math.round((val - ref) / pitch) * pitch;
      const top = snap(printed.y + printed.h, minY), bottom = snap(printed.y, minY);
      const left = snap(printed.x, minX), right = snap(printed.x + printed.w, minX);
      if (top > maxY) maxY = top;
      if (bottom < minY) minY = bottom;
      if (left < minX) minX = left;
      if (right > maxX) maxX = right;
      printed = null;
    }
    // Shaded overlap strips (a band of cells the previous page already covers) sit just outside the lines.
    const snap2 = (val, ref) => ref + Math.round((val - ref) / pitch) * pitch;
    const gw = maxX - minX, gh = maxY - minY;
    for (const r of bigRects) {
      if (r.w >= gw * 0.8 && r.h >= pitch * 0.5 && r.h <= pitch * 6 && Math.abs(r.x - minX) < pitch * 1.5) {
        if (r.y + r.h > maxY && r.y + r.h <= maxY + pitch * 6) maxY = snap2(r.y + r.h, minY);
        if (r.y < minY && r.y >= minY - pitch * 6) minY = snap2(r.y, minY);
      }
      if (r.h >= gh * 0.8 && r.w >= pitch * 0.5 && r.w <= pitch * 6 && Math.abs(r.y - minY) < pitch * 1.5) {
        if (r.x < minX && r.x >= minX - pitch * 6) minX = snap2(r.x, minX);
        if (r.x + r.w > maxX && r.x + r.w <= maxX + pitch * 6) maxX = snap2(r.x + r.w, minX);
      }
    }
  }

  // Parts of the grid hidden under white masks or outside the printed rectangle don't count.
  if (printed) {
    maxX = Math.min(maxX, printed.x + printed.w);
    minY = Math.max(minY, printed.y - pitch * 0.5);
    maxY = Math.min(maxY, printed.y + printed.h + pitch * 0.5);
  }
  for (const m of masks) {
    const tall = m.h > pageH * 0.8, wide = m.w > pageW * 0.8;
    if (tall && m.x > minX + pitch * 10 && m.x < maxX) maxX = m.x;
    if (tall && m.x + m.w < maxX - pitch * 10 && m.x + m.w > minX) minX = m.x + m.w;
  }

  const cols = Math.round((maxX - minX) / pitch);
  const rows = Math.round((maxY - minY) / pitch);

  // ---- which stitch each number belongs to ------------------------------
  // A number sits either on a grid line (right/bottom edge of stitch n) or in the middle of stitch n.
  const index = (t) => {
    const frac = t - Math.floor(t);
    return frac < 0.25 || frac > 0.75 ? Math.round(t) - 1 : Math.floor(t);
  };
  const colStart = median(colLabels.map((l) => l.n - index((l.pos - minX) / pitch)));
  const rowStart = median(rowLabels.map((l) => l.n - index((maxY - l.cy) / pitch)));

  if (!(cols >= 5 && rows >= 5 && colStart >= 1 && rowStart >= 1)) return { ...out, reason: 'numbers do not fit a grid', pitch };

  // How far the actual chart reaches (the printed size can be smaller or larger than the page grid).
  let contentCols = 0, contentRows = 0;
  for (const c of inked) {
    if (c.x + pitch > maxX + pitch * 0.5 || c.y < minY - pitch * 0.5 || c.y + c.h > maxY + pitch * 0.5) continue;
    contentCols = Math.max(contentCols, colStart + Math.round((c.x - minX) / pitch));
    contentRows = Math.max(contentRows, rowStart + Math.round((maxY - (c.y + c.h)) / pitch));
  }

  return { ...out, ok: true, style, pitch, contentCols, contentRows, x0: minX, yTop: maxY, cols, rows, colStart, rowStart };
}
