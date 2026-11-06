# Stitch Tracker: Design

Living document. Update it as the app changes.

## Decisions

| Topic | Decision |
|---|---|
| Platform | Web app / PWA, installable on iPhone/iPad via Safari "Add to Home Screen". |
| Storage | On-device only (IndexedDB). All access is in `src/storage.js` so cloud sync can replace it later (planned fork). |
| Pattern display | The PDF itself is the picture (symbols and colors come from the PDF; they are not parsed into thread data). |
| PDF sources | Varied. Auto-detection covers cell-square and grid-line PDFs; image-only PDFs use the manual grid editor. |
| Gestures | Tap cycles empty → half → full → empty. Double tap = full. One finger pans. Touch-and-hold then drag paints full stitches. The user picks which PDF pages are chart pages (auto-suggested). |

## What the sample PDF looks like (BowserBaddies.pdf)

- 22 A4 pages. Page 1 cover. Pages 2-10 chart (3 × 3 tiles). Pages 11-19 are a second, symbols-only copy of the chart drawn with grid lines. Pages 20-22 are the legend. Size is printed as "358x410 Stitches".
- Each chart page draws **one filled square per stitch** (pitch 3.357 pt) and prints numbers in the margin every 10 stitches. Those numbers are real text, so the app reads **absolute column/row numbers** from the PDF instead of matching images.
- A big background rectangle marks the **printed area** (150 columns × 207 rows). Cells outside it exist but are covered by white masks, so they are ignored.
- Neighbouring pages **overlap by 2 cells**; the duplicated strip is shaded translucent blue (the first 2 columns of a page, or the first 2 rows). Verified: placing pages by their printed numbers gives zero conflicting cells in the overlaps.
- Column label *n* is centred on the right edge of column *n*; row label *n* is centred inside row *n*.

## Test patterns (patterns/ folder)

| File | Grid style | Notes |
|---|---|---|
| BowserBaddies.pdf | filled cell squares (pages 2-10) **and** a second, symbols-only copy drawn with grid lines (pages 11-19) | 18 chart pages = two *views* of one 358x410 chart. Overlap 2 cells, shaded translucent blue. |
| mariosamplercolor.pdf | drawn grid lines, landscape, axis numbers rotated for rows | 6 chart pages (2x3), 151x132. Overlap strips (3 rows/cols) shaded grey and drawn *outside* the grid lines. Page 9 is the legend. |
| ZeldaInventorycolor.pdf | same generator as Mario Sampler (drawn lines, grey strips as filled polygons) | 8 chart pages (4x2), 3-line overlaps, printed 212x173 but pages cover 214x175. Page 9 is the legend. |
| ghosts-pattern.pdf | raster/outlined drawing, **no text** | Cannot be read automatically (no axis numbers). Use the manual grid editor; PDF page 5 holds two chart pages stacked, so use "+ Another grid on this page". |

## Views

A PDF can contain the same chart twice (colour + symbols). Selected pages that start at the same stitch as an earlier page go into another *view*; the stitching screen has a button in the top bar that switches views. Progress is shared between views.

## Line numbering

Charts number grid **lines**, not cells: the chart's left (and top) edge is line 0, and a page of 83 stitches runs from line 0 to line 83. Printed axis numbers sit on those lines (e.g. "10" is on line 10, the right edge of stitch 10). The UI shows line numbers (Mario Sampler page 1: lines 0-83 across, 0-48 down; Bowser Baddies page 2 starts at line 148). Internally pages still store 1-based stitch numbers (`colStart = leftLine + 1`, `cols = rightLine - leftLine`).

## Editing a built pattern

The original PDF is kept, so a pattern can be re-opened in the import screen (`importScreen(pdf, existingPattern)`) with its saved pages and grids pre-selected. Saving calls `store.replacePattern`, which rewrites the pattern record and page images and **resets progress to empty** (stitch positions would no longer match a changed alignment). The user confirms a warning dialog before editing starts.

## Manual grid editor

Tap a page picture on the import screen. The page opens full screen with the grid drawn on top (every 10th line is bold and numbered). Handles: round corner handles move two edges, square edge handles move a single edge **straight horizontally or vertically** (cell width and height are independent, so scale can be fixed one axis at a time), and the centre handle moves the whole grid. Type the left/right/top/bottom line numbers in the fields below: this relabels the lines without moving the grid on the page (cell width/height are recalculated to fit the same box). "+ Another grid on this page" adds a second grid from the same PDF page (stacked charts). Point values are PDF points (1/72 inch) from the page's bottom-left.

## How pages are stitched

1. `analyze.js` reads, per page: axis numbers (text multiples of 10, larger than in-cell symbols) → cell size and first column/row number; cell squares or grid lines (plus the printed-area rectangle, white masks and shaded overlap strips) → grid origin, columns, rows.
2. `layout.js` draws pages in order of descending start row/column so the earliest page wins in overlaps (this also hides the blue overlap strips). Pages that start at the same stitch as an earlier page become another view (see Views).
3. Import renders each selected page once into an 8 px/stitch PNG "tile" stored in IndexedDB (fast opening). When zoomed in beyond that, the viewer re-renders the visible pages straight from the PDF (vector, always sharp), 180 ms after the view settles.

## Data model

- `patterns`: `{id, name, createdAt, openedAt, width, height, views[], lastView, thumbData (JPEG data URL), pages[{pdfPage, view, colStart, rowStart, cols, rows, pitchX, pitchY, x0, yTop}], done, half, total, thumb}`
- `files`: original PDF. `tiles`: page PNGs. `progress`: `Uint8Array(width*height)`, 0 none / 1 half / 2 full, row-major.
- Saved 400 ms after a change, on `visibilitychange` (hidden), `pagehide`, and when leaving the screen.

## Pattern size

The size printed in the PDF ("358x410 Stitches") is only a default. The import uses the largest of: the printed size, the furthest non-blank stitch (`contentCols/contentRows`, cell-square charts only) and the full area covered by the selected chart pages. Bowser Baddies prints 358x410, but its stitches sit inside blank margins of a 411x461 grid (stitches span columns 25-382, rows 24-433), so the pattern is 411x461 and nothing is cut off. The width/height fields stay editable.

## Rulers

The viewer draws line numbers along the top and left edges (`Viewer.drawRulers`). The strips cover part of the canvas, so `cellAt` ignores taps there and `fit()` leaves room for them.

## Known limits / ideas

- Auto-detection needs text axis numbers plus drawn squares or lines. Other PDFs need the manual grid editor (a future image-based detector could automate this).
- Image-only PDFs (like ghosts-pattern.pdf) need manual grid placement for every page.
- The sample's first chart page has a small overview picture printed in its empty top-left corner; it is shown as part of the page.
- Not yet verified on a real iPhone/iPad (tested in a desktop browser with synthetic touch events). The service worker could not be exercised in the test browser.
- Ideas: thread/color filter from the legend, per-session stitch counts, backup/export of progress, cloud sync.

## Open questions
- None right now.
