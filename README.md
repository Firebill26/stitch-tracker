# Stitch Tracker

A web app (PWA) for tracking progress on cross stitch patterns. Upload a PDF chart; multi-page charts are stitched into one grid; tap to mark half and full stitches. Everything is stored on your device.

## Run it

```bash
node serve.mjs
```

Open http://localhost:8080. No install or build step (Node 18+ only runs the tiny static server).

### Hosted copy
Live at https://firebill26.github.io/stitch-tracker/ (GitHub Pages, served from the `main` branch). To publish changes: `git add . && git commit -m "update" && git push`; the site refreshes in about a minute. PDFs (`patterns/`, `*.pdf`) are git-ignored on purpose: the patterns are other designers' work and the repo is public.

### On an iPhone / iPad
The app must be served over HTTPS to install and work offline. Easiest: publish this folder to any static host (GitHub Pages, Netlify, Cloudflare Pages), open the URL in Safari, then Share > Add to Home Screen. Data stays in that browser/device. For a quick look on your home network, `node serve.mjs` and browse to `http://<your-pc-ip>:8080` (works, but no offline install).

## Using it

| Do this | Result |
|---|---|
| **+ Add pattern (PDF)** | Choose a PDF. Tick the chart pages (auto-selected when detected), check the size, **Build pattern**. Tap a page picture to open the full-screen grid editor if a page needs adjusting. |
| Tap a stitch | empty → half → full → empty (tap a full stitch to undo it) |
| **Tap:** button (top bar) | switch what a single tap does: **Half → Full** (default, as above) or **Full** (one tap = complete, tap again to clear). Remembered between visits. |
| Double tap | full stitch |
| Touch and hold, then drag | paint along the path, following the **Tap:** toggle: half stitches in *Half → Full* mode, complete stitches in *Full* mode (never downgrades a finished stitch) |
| Drag with one finger | pan |
| Numbers along the top/left | line numbers of the chart (0 at its left/top edge) |
| Pinch / mouse wheel / + − buttons | zoom (⤢ fits the whole pattern) |
| View button (top bar) | switch between versions of the chart in one PDF (e.g. Color / Symbols) |
| **Edit** (pattern list only) | reopen the page/grid setup of a built pattern to fix misalignments. **Clears all stitch markings** (you are warned first). |
| Undo | reverts the last tap or paint stroke |

Progress saves automatically (a moment after each change, and when you leave the app).

## Help inside the app
The round **?** button at the top right of every screen opens the full instructions (`src/help.js`). Keep it in step with the app when features change.

## Docs
- [docs/DESIGN.md](docs/DESIGN.md): how it works, the PDF format findings, decisions.
- [docs/CHANGELOG.md](docs/CHANGELOG.md)

Test patterns are in `patterns/`.

## Project layout
```
index.html, styles.css, manifest.webmanifest, sw.js   app shell + PWA
src/analyze.js   finds the stitch grid and absolute row/column numbers on a PDF page
src/layout.js    page placement, overlap ownership, chart "views"
src/gridEditor.js full-screen manual grid editor
src/ui.js        DOM helpers + in-app dialogs
src/help.js      the ? help page
src/pdfio.js     pdf.js wrapper (render a page region so its grid lands where we want)
src/viewer.js    canvas viewer: pan, zoom, progress overlay, gestures
src/storage.js   IndexedDB persistence (swap this for cloud sync later)
src/app.js       library, import and stitching screens
vendor/          pdf.js 4.10.38 (bundled so the app works offline)
serve.mjs        dev server
```
