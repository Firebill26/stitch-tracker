// Places chart pages on one shared stitch grid.
// Each page knows the absolute column/row numbers of its first cell (read from the
// axis numbers printed on the page, or entered by hand), so overlap strips line up
// without any image matching.

/** Page record: { pdfPage, view, colStart, rowStart, cols, rows, pitch, x0, yTop } — starts are 1-based. */

/**
 * Some PDFs contain the same chart twice (e.g. a colour version and a symbols-only version).
 * Pages that start at the same stitch as an earlier page go into a new "view".
 * @param {{colStart:number,rowStart:number}[]} geoms  in page order
 * @returns {number[]} view index for each entry
 */
export function assignViews(geoms) {
  const views = []; // views[v] = Set of "col,row" starts
  return geoms.map((g) => {
    const key = `${g.colStart},${g.rowStart}`;
    let v = views.findIndex((s) => !s.has(key));
    if (v < 0) { views.push(new Set()); v = views.length - 1; }
    views[v].add(key);
    return v;
  });
}

/**
 * Drawing order for one view: pages starting later go first, so the page that owns a cell
 * (the one starting earliest) is painted last and wins in overlap areas.
 * Returns {p, index} where index points into the pattern's page list (and its tile list).
 */
export function paintOrder(pages, view = 0) {
  return pages
    .map((p, index) => ({ p, index }))
    .filter(({ p }) => (p.view ?? 0) === view)
    .sort((a, b) => b.p.rowStart - a.p.rowStart || b.p.colStart - a.p.colStart);
}

/** Overall stitched size if the chart size is not printed in the PDF. */
export function extent(pages) {
  return {
    width: Math.max(...pages.map((p) => p.colStart + p.cols - 1)),
    height: Math.max(...pages.map((p) => p.rowStart + p.rows - 1)),
  };
}
