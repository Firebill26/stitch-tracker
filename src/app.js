// UI: pattern library, PDF import, and the stitching screen.
import * as store from './storage.js';
import { openPdf, analyze, findStitchSize, renderThumb, drawPage, makeCanvas } from './pdfio.js';
import { assignViews, paintOrder, extent } from './layout.js';
import { Viewer, TILE_CELL } from './viewer.js';
import { openGridEditor, bindGridFields, rebox, FIELD_DEFS } from './gridEditor.js';
import { h, toast, confirmDialog, textDialog } from './ui.js';
import { helpButton } from './help.js';

const app = document.getElementById('app');
let current = null; // cleanup for the active screen

async function show(render) {
  current?.();
  current = null;
  app.replaceChildren();
  current = (await render()) || null;
}

// ---------------------------------------------------------------- library

async function libraryScreen() {
  const patterns = await store.listPatterns();
  const fileInput = h('input', { type: 'file', accept: 'application/pdf,.pdf', style: 'display:none',
    onchange: (e) => { const f = e.target.files[0]; if (f) show(() => importScreen(f)); } });

  const top = h('div', { class: 'topbar' },
    h('h1', {}, 'My Patterns'),
    h('button', { class: 'primary', onclick: () => fileInput.click() }, '+ Add pattern (PDF)'), fileInput, helpButton());

  const body = h('div', { class: 'scroll' });
  const urls = [];
  if (!patterns.length) {
    body.append(h('div', { class: 'empty' },
      h('h2', {}, 'No patterns yet'),
      h('p', {}, 'Add a PDF pattern to start tracking your stitches. Multi-page charts are stitched together for you.')));
  } else {
    body.append(h('div', { class: 'cards' }, patterns.map((p) => {
      const pct = p.total ? Math.round(((p.done || 0) / p.total) * 100) : 0;
      const thumb = h('div', { class: 'thumb' });
      if (p.thumb) { const u = URL.createObjectURL(p.thumb); urls.push(u); thumb.style.backgroundImage = `url(${u})`; }
      return h('div', { class: 'card', onclick: () => show(() => stitchScreen(p.id)) },
        thumb,
        h('div', { class: 'meta' },
          h('div', { class: 'name' }, p.name),
          h('div', { class: 'sub' }, `${p.width}×${p.height} · ${pct}% done`),
          h('div', { class: 'bar' }, h('i', { style: `width:${pct}%` })),
          h('div', { class: 'actions' },
            h('button', { onclick: async (e) => {
              e.stopPropagation();
              const name = await textDialog({ title: 'Rename pattern', value: p.name });
              if (name?.trim()) { p.name = name.trim(); await store.savePattern(p); show(libraryScreen); }
            } }, 'Rename'),
            h('button', { onclick: (e) => { e.stopPropagation(); startEdit(p); } }, 'Edit'),
            h('button', { class: 'danger', onclick: async (e) => {
              e.stopPropagation();
              const sure = await confirmDialog({
                title: `Delete "${p.name}"?`,
                message: 'This permanently removes the pattern, its PDF and all of your stitching progress. It cannot be undone.',
                confirmLabel: 'Delete', danger: true,
              });
              if (!sure) return;
              await store.deletePattern(p.id);
              toast('Pattern deleted');
              show(libraryScreen);
            } }, 'Delete'))));
    })));
  }
  app.append(top, body);
  return () => urls.forEach(URL.revokeObjectURL);
}

/** Warns that editing wipes progress, then reopens the grid setup for an already-built pattern. */
async function startEdit(p) {
  const sure = await confirmDialog({
    title: `Edit "${p.name}"?`,
    message: 'Editing lets you fix the page alignment, but it removes ALL of your stitch markings on this pattern. This cannot be undone.',
    confirmLabel: 'Edit and clear stitches', danger: true,
  });
  if (!sure) return;
  const pdf = await store.getPdf(p.id);
  if (!pdf) { toast('The original PDF is missing, so this pattern cannot be edited.'); return; }
  show(() => importScreen(pdf, p));
}

// ---------------------------------------------------------------- import

async function importScreen(file, existing = null) {
  let cancelled = false;
  const status = h('span', { class: 'progressmsg' }, 'Reading PDF…');
  const pagesBox = h('div', { class: 'pages' });
  const nameIn = h('input', { type: 'text', value: existing ? existing.name : file.name.replace(/\.pdf$/i, '') });
  const wIn = h('input', { type: 'number', min: 1 });
  const hIn = h('input', { type: 'number', min: 1 });
  const buildBtn = h('button', { class: 'primary', disabled: true }, existing ? 'Save changes' : 'Build pattern');

  app.append(
    h('div', { class: 'topbar' }, h('button', { onclick: () => show(existing ? () => stitchScreen(existing.id) : libraryScreen) }, '← Cancel'), h('h1', {}, existing ? 'Edit pattern' : 'Add pattern'), helpButton()),
    h('div', { class: 'scroll import' },
      h('p', { class: 'hint' }, 'Tick the pages that contain the chart (skip the cover and legend). Pages are placed using the row and column numbers printed on them, so overlap strips line up automatically. Tap a page picture to enlarge it and adjust the grid by hand.'),
      h('div', { class: 'row' },
        h('label', { class: 'wide' }, 'Name', nameIn),
        h('label', {}, 'Width (stitches)', wIn),
        h('label', {}, 'Height (stitches)', hIn)),
      pagesBox,
      h('div', { class: 'footer' }, buildBtn, status)));

  let doc;
  try { doc = await openPdf(file); } catch (e) {
    status.textContent = 'Could not read that PDF.';
    return () => { cancelled = true; };
  }

  const infos = []; // one per chart grid; several can share a PDF page
  let size = null;
  let sizeNote = '';
  const ext = () => {
    const g = infos.filter((i) => i.on).map(readGeom).filter(Boolean);
    return g.length ? extent(g) : { width: 0, height: 0 };
  };
  let content = { width: 0, height: 0 }; // furthest stitch actually drawn on any page

  // Fields hold grid *line* numbers (the chart's left/top edge is line 0); pages store 1-based stitch numbers.
  const toFields = (g) => ({
    left: g.colStart - 1, right: g.colStart - 1 + g.cols, top: g.rowStart - 1, bottom: g.rowStart - 1 + g.rows,
    pitchX: g.pitchX ?? g.pitch, pitchY: g.pitchY ?? g.pitch, x0: g.x0, yTop: g.yTop,
  });
  const readGeom = (info) => {
    const f = {};
    for (const k of Object.keys(info.fields)) f[k] = Number(info.fields[k].value);
    const cols = Math.round(f.right - f.left), rows = Math.round(f.bottom - f.top);
    if (!(f.pitchX > 0 && f.pitchY > 0 && cols > 0 && rows > 0 && f.left >= 0 && f.top >= 0)) return null;
    return { colStart: Math.round(f.left) + 1, rowStart: Math.round(f.top) + 1, cols, rows,
      pitchX: f.pitchX, pitchY: f.pitchY, pitch: (f.pitchX + f.pitchY) / 2, x0: f.x0, yTop: f.yTop };
  };

  const refresh = () => {
    const sel = infos.filter((i) => i.on);
    buildBtn.disabled = !sel.length || !sel.every(readGeom);
    for (const i of infos) {
      i.card.classList.toggle('on', i.on);
      const g = readGeom(i);
      i.detail.className = g ? 'd' : 'd bad';
      i.detail.textContent = g
        ? `Lines ${g.colStart - 1}–${g.colStart - 1 + g.cols} across, ${g.rowStart - 1}–${g.rowStart - 1 + g.rows} down`
        : 'Grid not set: tap the picture';
    }
    const geoms = sel.map(readGeom).filter(Boolean);
    if (geoms.length && !wIn.dataset.touched) {
      const e = extent(geoms); wIn.value = e.width; hIn.value = e.height;
    }
  };
  wIn.addEventListener('input', () => { wIn.dataset.touched = 1; });
  hIn.addEventListener('input', () => { hIn.dataset.touched = 1; });

  /** Adds a card for one chart grid on a PDF page. `detected` may be null for pages needing manual setup. */
  function addCard(n, page, detected, thumbPromise, after) {
    const [vx0, vy0, vx1, vy1] = page.view;
    const margin = 36, guessCols = 50;
    const src = toFields(detected || {
      colStart: 1, rowStart: 1, cols: guessCols, rows: guessCols,
      pitch: (vx1 - vx0 - margin * 2) / guessCols, x0: vx0 + margin, yTop: vy1 - margin,
    });
    const info = { pdfPage: n, page, detected, on: false, fields: {}, extra: !!after };
    const img = h('div', { class: 'img', role: 'button', tabindex: '0', title: 'Tap to enlarge and adjust the grid' });
    const cb = h('input', { type: 'checkbox', onchange: () => { info.on = cb.checked; refresh(); } });
    info.cb = cb;
    info.detail = h('div', { class: 'd' });
    const fields = h('div', { class: 'fields' }, FIELD_DEFS.map(([k, label]) => {
      const inp = h('input', { type: 'number', step: 'any', value: String(Math.round(src[k] * 1000) / 1000) });
      info.fields[k] = inp;
      return h('label', {}, label, inp);
    }));
    bindGridFields(info.fields, refresh);
    const edit = async () => {
      await openGridEditor({ page, fields: info.fields, title: `Page ${n}${info.extra ? ' (extra grid)' : ''}: adjust grid` });
      if (!info.on && readGeom(info)) { info.on = cb.checked = true; }
      refresh();
    };
    img.addEventListener('click', edit);
    img.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); edit(); } });
    thumbPromise.then((url) => { img.style.backgroundImage = `url(${url})`; });

    info.thumbPromise = thumbPromise;
    const extraBtn = h('button', { class: 'small', onclick: () => {
      addExtra(info, Object.fromEntries(Object.entries(info.fields).map(([k, inp]) => [k, inp.value])));
      refresh();
    } }, '+ Another grid on this page');
    const removeBtn = info.extra && h('button', { class: 'small danger', onclick: () => {
      infos.splice(infos.indexOf(info), 1); info.card.remove(); refresh();
    } }, 'Remove');

    info.card = h('div', { class: 'pg' },
      img,
      h('label', { class: 't' }, cb, `Page ${n}${info.extra ? ' (extra)' : ''}`),
      info.detail,
      h('details', {}, h('summary', {}, 'Numbers'), fields),
      h('div', { class: 'pg-actions' }, extraBtn, removeBtn));
    if (after) after.after(info.card); else pagesBox.append(info.card);
    infos.push(info);
    return info;
  }

  /** Adds another grid card for the same PDF page, directly after `parent`. */
  function addExtra(parent, values) {
    let after = parent.card;
    for (let k = infos.indexOf(parent) + 1; infos[k]?.extra && infos[k].pdfPage === parent.pdfPage; k++) after = infos[k].card;
    const added = addCard(parent.pdfPage, parent.page, null, parent.thumbPromise, after);
    for (const k of Object.keys(values)) added.fields[k].value = String(values[k]);
    rebox(added.fields);
    infos.splice(infos.indexOf(parent) + 1, 0, infos.pop());
    return added;
  }

  for (let n = 1; n <= doc.numPages; n++) {
    if (cancelled) return;
    status.textContent = `Reading page ${n} of ${doc.numPages}…`;
    const page = await doc.getPage(n);
    const a = await analyze(page);
    size ||= await findStitchSize(page);
    if (a.ok) { content.width = Math.max(content.width, a.contentCols || 0); content.height = Math.max(content.height, a.contentRows || 0); }
    const geom = a.ok ? { colStart: a.colStart, rowStart: a.rowStart, cols: a.cols, rows: a.rows, pitch: a.pitch, x0: a.x0, yTop: a.yTop } : null;
    const thumb = renderThumb(page, 240).then((c) => c.toDataURL('image/jpeg', 0.8)).catch(() => '');
    const info = addCard(n, page, geom, thumb);
    info.style = a.style;
    info.on = !!geom; info.cb.checked = info.on;
    refresh();
  }

  if (existing) {
    // Start from the saved layout instead of what auto-detection finds.
    for (const info of infos.filter((i) => !i.extra)) {
      const saved = existing.pages.filter((p) => p.pdfPage === info.pdfPage);
      info.on = saved.length > 0;
      info.cb.checked = info.on;
      if (!saved.length) continue;
      const set = (target, entry) => {
        const f = toFields(entry);
        for (const k of Object.keys(f)) target.fields[k].value = String(Math.round(f[k] * 1000) / 1000);
        rebox(target.fields);
      };
      set(info, saved[0]);
      for (const entry of saved.slice(1)) {
        const extra = addExtra(info, {});
        set(extra, entry);
        extra.on = extra.cb.checked = true;
      }
    }
    wIn.value = Math.max(existing.width, content.width, ext().width);
    hIn.value = Math.max(existing.height, content.height, ext().height);
    wIn.dataset.touched = hIn.dataset.touched = 1;
  } else if (size || content.width || ext().width) {
    // Never cut anything off: use the biggest of the printed size, the furthest drawn stitch and the full area the chart pages cover.
    // (Bowser Baddies prints 358x410 but its pages cover a 411x461 grid, with blank margins around the stitches.)
    const e = ext();
    const w = Math.max(size?.width || 0, content.width, e.width), hh = Math.max(size?.height || 0, content.height, e.height);
    wIn.value = w; hIn.value = hh; wIn.dataset.touched = hIn.dataset.touched = 1;
    sizeNote = size && (w > size.width || hh > size.height)
      ? ` The PDF says ${size.width}×${size.height}, but the chart pages cover ${w}×${hh}, so that full size is used (you can change it above).` : '';
  }
  refresh();
  const found = infos.filter((i) => i.on).length;
  status.textContent = existing
    ? 'Fix the grids you need to (tap a page picture), then Save changes. Saving clears all stitch markings.'
    : found
    ? `Found ${found} chart pages. Check the selection, then build.${sizeNote}`
    : 'No chart grid was detected automatically. Tap a page picture to place its grid by hand, then tick the page.';

  buildBtn.addEventListener('click', async () => {
    const sel = infos.filter((i) => i.on);
    buildBtn.disabled = true;
    try {
      const geoms = sel.map(readGeom);
      const viewOf = assignViews(geoms);
      const pages = sel.map((i, k) => ({ pdfPage: i.pdfPage, view: viewOf[k], ...geoms[k] }));
      const nViews = Math.max(...viewOf) + 1;
      const views = Array.from({ length: nViews }, (_, v) => {
        if (nViews === 1) return 'Chart';
        const styles = new Set(sel.filter((_, k) => viewOf[k] === v).map((i) => i.style));
        return styles.size === 1 && styles.has('cells') ? 'Color' : styles.size === 1 && styles.has('lines') ? 'Symbols' : `Set ${v + 1}`;
      });
      const names = new Set(views);
      if (names.size !== views.length) views.forEach((_, v) => { views[v] = `Set ${v + 1}`; });

      const width = Math.max(1, Math.round(Number(wIn.value))), height = Math.max(1, Math.round(Number(hIn.value)));
      const tiles = [];
      for (let k = 0; k < pages.length; k++) {
        status.textContent = `Rendering page ${pages[k].pdfPage} (${k + 1} of ${pages.length})…`;
        const p = pages[k], page = await doc.getPage(p.pdfPage);
        const c = makeCanvas(p.cols * TILE_CELL, p.rows * TILE_CELL);
        await drawPage(page, p, TILE_CELL / p.pitchX, TILE_CELL / p.pitchY, 0, 0, c.getContext('2d'), { x: 0, y: 0, w: c.width, h: c.height });
        tiles.push(await new Promise((r) => c.toBlob(r, 'image/png')));
        await new Promise((r) => setTimeout(r));
      }
      status.textContent = 'Saving…';
      const pattern = {
        ...(existing || {}),
        id: existing ? existing.id : store.newId(), name: nameIn.value.trim() || 'Untitled', createdAt: Date.now(), openedAt: Date.now(),
        width, height, pages, views, lastView: 0, done: 0, half: 0, total: width * height,
        thumb: await makeThumb(pages, tiles, width, height),
      };
      if (existing) await store.replacePattern(pattern, tiles);
      else await store.createPattern(pattern, file, tiles);
      store.requestPersistence();
      show(() => stitchScreen(pattern.id));
    } catch (e) {
      console.error(e);
      status.textContent = 'Something went wrong building the pattern: ' + e.message;
      buildBtn.disabled = false;
    }
  });
  return () => { cancelled = true; doc.destroy?.(); };
}

async function makeThumb(pages, tileBlobs, width, height) {
  const W = 320, k = W / width;
  const c = makeCanvas(W, Math.max(1, Math.round(height * k)));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  for (const { p, index } of paintOrder(pages, 0)) {
    const bmp = await createImageBitmap(tileBlobs[index]);
    ctx.drawImage(bmp, (p.colStart - 1) * k, (p.rowStart - 1) * k, p.cols * k, p.rows * k);
    bmp.close();
  }
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
}

// ---------------------------------------------------------------- stitching

async function stitchScreen(id) {
  const pattern = await store.getPattern(id);
  if (!pattern) return show(libraryScreen);
  pattern.openedAt = Date.now();
  store.savePattern(pattern);

  const [pdfBlob, prog] = await Promise.all([store.getPdf(id), store.getProgress(id)]);
  const tiles = await Promise.all(pattern.pages.map(async (_, n) => createImageBitmap(await store.getTile(id, n))));
  const doc = await openPdf(pdfBlob);
  const pageCache = new Map();
  const getPage = (n) => { if (!pageCache.has(n)) pageCache.set(n, doc.getPage(n)); return pageCache.get(n); };

  const canvas = h('canvas');
  const stat = h('span', { class: 'stat' });
  const legend = h('div', { class: 'legend' }, '');
  const undoBtn = h('button', { onclick: () => viewer.undo() }, 'Undo');
  let saveTimer = 0, dirty = false;

  const save = async () => {
    clearTimeout(saveTimer);
    if (!dirty) return;
    dirty = false;
    const s = viewer.stats();
    pattern.done = s.full;
    pattern.half = s.half;
    try {
      await Promise.all([store.saveProgress(id, viewer.cells.slice()), store.savePattern(pattern)]);
    } catch (e) { dirty = true; toast('Could not save progress!'); }
  };

  const updateStat = () => {
    const s = viewer.stats();
    stat.textContent = `${((s.full / s.total) * 100).toFixed(1)}%  ·  ${s.full.toLocaleString()} / ${s.total.toLocaleString()}`;
    legend.textContent = `half: ${s.half.toLocaleString()}  ·  tap: ${viewer.tapMode === 'full' ? 'full → clear' : 'half → full → clear'}`;
  };

  const viewer = new Viewer(canvas, pattern, tiles, getPage, prog?.cells || new Uint8Array(pattern.width * pattern.height), {
    onChange: () => { dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); updateStat(); },
  });

  const MODE_KEY = 'stitch-tap-mode';
  try { if (localStorage.getItem(MODE_KEY) === 'full') viewer.tapMode = 'full'; } catch { /* storage unavailable */ }
  const modeLabel = () => (viewer.tapMode === 'full' ? 'Tap: Full' : 'Tap: Half → Full');
  const modeBtn = h('button', { title: 'Choose what a tap, and a touch-and-hold drag, marks: half stitches or complete stitches', onclick: () => {
    viewer.tapMode = viewer.tapMode === 'full' ? 'half' : 'full';
    try { localStorage.setItem(MODE_KEY, viewer.tapMode); } catch { /* ignore */ }
    modeBtn.textContent = modeLabel();
    updateStat();
  } }, modeLabel());

  const onHide = () => { if (document.visibilityState === 'hidden') save(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', save);

  const views = pattern.views || ['Chart'];
  const viewBtn = views.length > 1 && h('button', { title: 'Switch between the versions of this chart in your PDF', onclick: async () => {
    viewer.setView((viewer.view + 1) % views.length);
    viewBtn.textContent = views[viewer.view];
    pattern.lastView = viewer.view;
    await store.savePattern(pattern);
  } }, views[viewer.view]);

  app.append(
    h('div', { class: 'topbar' },
      h('button', { onclick: async () => { await save(); show(libraryScreen); } }, '← Patterns'),
      h('h1', {}, pattern.name), stat, modeBtn, viewBtn, undoBtn, helpButton()),
    h('div', { class: 'stage' }, canvas, legend,
      h('div', { class: 'zoom' },
        h('button', { 'aria-label': 'Zoom in', onclick: () => viewer.zoomBy(1.5) }, '+'),
        h('button', { 'aria-label': 'Zoom out', onclick: () => viewer.zoomBy(1 / 1.5) }, '−'),
        h('button', { 'aria-label': 'Fit to screen', onclick: () => viewer.fit() }, '⤢'))));
  viewer.resize(); viewer.fit();
  updateStat();

  return () => {
    save();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', save);
    viewer.destroy();
    doc.destroy?.();
  };
}

// ---------------------------------------------------------------- boot

show(libraryScreen);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker failed', e));
}
