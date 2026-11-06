# Changelog

## 2026-11-06
- Published to GitHub Pages: https://firebill26.github.io/stitch-tracker/ (public repo `Firebill26/stitch-tracker`; PDFs are git-ignored).
- **Line-number rulers** along the top and left of the stitched pattern view (0 = left/top edge of the chart, spacing adapts to zoom). They stay on the border while you pan and zoom, and taps on them do not mark stitches.
- **Bowser Baddies was cut off on the right/bottom.** The PDF text says 358x410 stitches, but its pages cover a **411 x 461** grid: the 358x410 stitches sit inside blank margins (stitches run from line 24/25 to 382/433). Import now sizes the pattern to the largest of the printed size, the furthest drawn stitch and the full area the chart pages cover, and says so on the import screen. The size fields stay editable. To fix a pattern built earlier: Edit it (size is pre-filled with the corrected value; this clears stitches).
- **Edit pattern**: new Edit button on each pattern card in the pattern list (not on the stitching screen). After a warning that all stitch markings will be cleared, it reopens the page/grid setup pre-filled with the saved layout so misalignments can be fixed; Save changes rebuilds the pattern (same name and PDF) with empty progress. Cancel keeps everything.
- Grid alignment: editing the left/right/top/bottom line numbers no longer grows or shrinks the grid on the page. The grid keeps its box and the cell width/height are recalculated to fit the new line numbers. Moving the handles or editing cell size/position changes the box as before.
- Touch-and-hold drag now follows the Tap toggle: paints half stitches in Half → Full mode, complete stitches in Full mode. It never turns a finished stitch back into a half.
- Added a **Tap** toggle in the stitching top bar: single tap marks a half stitch first (Half → Full) or marks the stitch complete straight away (Full). The choice is remembered on the device.

## 2026-11-05: third round
- Grid numbers are now **lines** (left/top edge = line 0) everywhere in the UI, matching how charts are numbered.
- Grid editor: edge handles move one edge purely horizontally or vertically, corners move two edges, the centre handle moves the whole grid. Cell width and height are independent, so scale can be adjusted per axis. Pages are rendered with separate horizontal/vertical scale.

## 2026-11-05: second round
- Fixed Rename and Delete on the pattern list: the browser prompt()/confirm() dialogs are not available in some browsers/webviews, so the app now has its own dialogs. Delete asks "are you sure?" first.
- Bowser Baddies now imports all 18 pages: the second 9 pages (symbols-only, drawn with grid lines) become a second *view* you can switch to.
- Grid detection now handles drawn grid lines, rotated and line-centred axis numbers, and shaded overlap strips outside the grid (Mario Sampler sample imports as 6 pages, 151x132).
- Tap a page picture on the import screen to open a full-screen grid editor (draggable corner handles, grid overlay, number fields). "+ Another grid on this page" supports stacked charts on one PDF page.
- Test PDFs moved into patterns/.

## 2026-11-05: first working version
- Library of uploaded patterns, PDF import with automatic chart-page selection and page stitching.
- Pan, zoom (pinch, wheel, buttons), tap half/full/clear, double tap, hold-and-drag painting, undo.
- Autosave to IndexedDB; installable PWA shell.
- Tested with BowserBaddies.pdf in a desktop browser: 9 chart pages stitched to 358×410, overlaps line up, progress survives reload.
