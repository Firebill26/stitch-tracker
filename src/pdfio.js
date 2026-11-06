// pdf.js wrapper: opening PDFs, analysing pages, drawing parts of a page onto a canvas.
import * as pdfjs from '../vendor/pdf.min.mjs';
import { analyzePage } from './analyze.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;

export async function openPdf(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

export const analyze = (page) => analyzePage(page, pdfjs.OPS);

/** Reads "358x410 Stitches" style size text from a page, if present. */
export async function findStitchSize(page) {
  const t = await page.getTextContent();
  const text = t.items.map((i) => i.str).join(' ');
  const m = text.match(/(\d{2,4})\s*w?\s*[x×]\s*(\d{2,4})\s*h?\s*stitches/i) || text.match(/stitches\W{0,3}(\d{2,4})\s*[x×]\s*(\d{2,4})/i);
  return m ? { width: +m[1], height: +m[2] } : null;
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/**
 * Draws a PDF page so that its stitch grid lands at a chosen place on `ctx`.
 *   g        page geometry {x0, yTop}  (PDF points, top-left corner of the grid)
 *   sx, sy   canvas pixels per PDF point, horizontally and vertically (cells need not be square)
 *   gridX/Y  canvas position of the grid's top-left corner
 * Draws into a temporary canvas covering only `clip` (canvas px) to keep memory small.
 */
export async function drawPage(page, g, sx, sy, gridX, gridY, ctx, clip) {
  const [vx0, , , vy3] = page.view;
  const tmp = makeCanvas(clip.w, clip.h);
  const viewport = page.getViewport({ scale: sx });
  // pdf.js applies `transform` after the viewport, which lets the vertical scale differ.
  const transform = [1, 0, 0, sy / sx, gridX - clip.x - sx * (g.x0 - vx0), gridY - clip.y - sy * (vy3 - g.yTop)];
  await page.render({ canvasContext: tmp.getContext('2d'), viewport, transform }).promise;
  ctx.drawImage(tmp, clip.x, clip.y);
}

export async function renderThumb(page, width) {
  const vp0 = page.getViewport({ scale: 1 });
  const scale = width / vp0.width;
  const c = makeCanvas(vp0.width * scale, vp0.height * scale);
  await page.render({ canvasContext: c.getContext('2d'), viewport: page.getViewport({ scale }) }).promise;
  return c;
}
