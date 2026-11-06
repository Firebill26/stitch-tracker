// In-app help page (opened from the ? button in the top bar).
import { h } from './ui.js';

const SECTIONS = [
  ['Quick start', [
    ['p', 'Add a PDF pattern, check the pages the app found, build it, then tap stitches to mark your progress. Your progress saves by itself.'],
    ['ol', [
      'On the My Patterns screen tap + Add pattern (PDF) and choose your PDF.',
      'Check the chart pages are ticked, then tap Build pattern.',
      'Tap a stitch to mark it. Pinch to zoom. Drag with one finger to move around.',
    ]],
  ]],
  ['My Patterns (the list)', [
    ['p', 'Every pattern you add appears as a card with a picture, its size and how much is done. Tap a card to start stitching it.'],
    ['ul', [
      "Rename: change the pattern's name.",
      'Edit: reopen the page setup to fix a misaligned grid or page. This removes ALL stitch markings on that pattern, so you are asked to confirm first.',
      'Delete: permanently removes the pattern, its PDF and your progress. You are asked to confirm first.',
    ]],
  ]],
  ['Adding a pattern', [
    ['p', 'After you choose a PDF the app reads every page and shows a picture of each one. It looks for the stitch grid and the numbers printed along its edges, and uses those numbers to place each page, so the overlap strips between pages line up on their own.'],
    ['ul', [
      'Tick only the pages that hold the chart. Leave the cover, instructions and thread legend unticked.',
      'Name, Width and Height: the app fills these in. The size is the largest of the size printed in the PDF, the furthest stitch drawn, and the area the chart pages cover. Change them if you want a different size.',
      'If the same chart appears twice in the PDF (for example a colour version and a symbols-only version) the app keeps both. You switch between them while stitching (see "Views").',
      'Build pattern (or Save changes when editing) creates the pattern. This can take a few seconds for big charts.',
    ]],
    ['p', 'The Numbers section on each page card lists its grid settings. You rarely need it; see "Adjusting the grid" below.'],
  ]],
  ['Grid line numbers', [
    ['p', 'Charts number the grid lines, not the squares. The left edge and top edge of the chart are line 0. A page whose grid runs from line 0 to line 83 across holds 83 stitches across. A square sits between two lines, so stitch 10 is the square between lines 9 and 10.'],
    ['p', 'Numbers along the top and left of the stitching screen show these line numbers, so you can find your place on the printed chart.'],
  ]],
  ['Adjusting the grid (when a page is misaligned or not found)', [
    ['p', "Tap a page's picture on the Add pattern screen to open it full screen with a red grid drawn on top. Every 10th line is bold and numbered."],
    ['ul', [
      'Round handles at the corners move two edges at once.',
      'Square handles in the middle of each side move just that edge, straight across or straight up and down, so you can fix the width and the height separately.',
      'The handle in the centre moves the whole grid without changing its size.',
      'Drag anywhere else to scroll the page. Use + and − to zoom for precise placement.',
      'Left, Right, Top and Bottom line # tell the app which chart lines the grid edges are. Changing them relabels the lines; it does not move or resize the grid on the page.',
      'Cell width / height and Grid left / top (in points) are the exact measurements. You normally just drag.',
      'Tap Done when it lines up. The page is ticked automatically.',
    ]],
    ['p', 'Some PDFs have two charts on one page. Tap + Another grid on this page to add a second grid for that page. Use Remove to delete an extra grid.'],
    ['p', "PDFs that are only pictures (no readable numbers) can't be placed automatically. Tick the page and set its grid by hand with this editor."],
  ]],
  ['Stitching', [
    ['p', 'Gestures on the chart:'],
    ['ul', [
      'Tap a stitch: marks it (see "Tap mode"). Tap a finished stitch again to clear it.',
      'Double tap: marks the stitch complete straight away.',
      'Touch and hold, then drag: paints a line of stitches. A short buzz (on devices that support it) tells you painting has started.',
      'Drag with one finger (without holding): moves the chart around.',
      'Pinch with two fingers, use the mouse wheel, or tap + / −: zoom in and out. The ⤢ button fits the whole chart on screen.',
    ]],
    ['p', 'Half stitches show as a single orange slash; complete stitches show as a green cross. The percentage at the top counts complete stitches only. The small note at the bottom left shows how many half stitches you have and what a tap does.'],
  ]],
  ['Tap mode (the Tap: button)', [
    ['ul', [
      'Tap: Half → Full: the first tap marks a half stitch, the second makes it complete, the third clears it.',
      'Tap: Full: one tap marks the stitch complete; tap again to clear it.',
    ]],
    ['p', 'Touch-and-hold dragging follows the same setting: it paints half stitches in Half → Full mode and complete stitches in Full mode. Painting never turns a finished stitch back into a half stitch. The choice is remembered on your device.'],
  ]],
  ['Undo', [
    ['p', 'Undo reverses your last tap or painted line. You can undo several steps in a row. The undo history is cleared when you leave the pattern.'],
  ]],
  ['Views (colour / symbols)', [
    ['p', 'When a PDF holds the same chart in more than one version, a button appears at the top (for example Color / Symbols). Tap it to switch. Your progress is the same in every version.'],
  ]],
  ['Saving and your data', [
    ['ul', [
      'Progress saves automatically a moment after each change, and again when you leave the pattern or close the app.',
      'Everything (patterns, PDFs, progress) is stored on the device and browser you are using. It is not sent anywhere and it does not sync between devices.',
      "If you use the hosted app on an iPhone or iPad, add it to the Home Screen (Share → Add to Home Screen) and open it from there. Don't clear Safari's website data, or you will lose your patterns and progress.",
      'Deleting a pattern, or using Edit on it, removes its stitch markings for good.',
    ]],
  ]],
  ['Troubleshooting', [
    ['ul', [
      'A page is not ticked or says "Grid not set": tap its picture and place the grid by hand.',
      'Pages do not line up: tap a page picture and check the line numbers match the numbers printed on the chart. If a pattern is already built, use Edit on its card to fix it (this clears your stitches).',
      'The chart looks blurry while zooming: it sharpens a moment after you stop moving.',
      'Part of the chart is cut off: Edit the pattern and make Width / Height larger.',
      'A picture or screen looks wrong, or you are not seeing the latest version: tap Reload app below (installed iPhone/iPad apps have no refresh control).',
    ]],
  ]],
];

function render([kind, body]) {
  if (kind === 'p') return h('p', {}, body);
  return h(kind, {}, body.map((t) => h('li', {}, t)));
}

/** Reloads the app, first asking the service worker to look for a newer version. */
async function reloadApp() {
  try { const regs = await navigator.serviceWorker?.getRegistrations(); await Promise.all((regs || []).map((r) => r.update())); } catch { /* offline: just reload */ }
  location.reload();
}

/** Opens the help page over the current screen. */
export function openHelp() {
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const root = h('div', { class: 'help', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Help' },
    h('div', { class: 'topbar' }, h('h1', {}, 'How to use Stitch Tracker'), h('button', { class: 'primary', onclick: close }, 'Close')),
    h('div', { class: 'help-body', tabindex: '-1' },
      SECTIONS.map(([title, blocks]) => h('section', {}, h('h2', {}, title), blocks.map(render))),
      h('section', {}, h('h2', {}, 'Reload the app'),
        h('p', {}, 'Reloads the app to pick up updates or clear a glitch. Your patterns and progress are kept.'),
        h('button', { class: 'primary', onclick: reloadApp }, 'Reload app'))));
  document.addEventListener('keydown', onKey);
  document.body.append(root);
  root.querySelector('.help-body').focus();
}

/** The round ? button used in every top bar. */
export const helpButton = () => h('button', { class: 'help-btn', 'aria-label': 'Help', title: 'How to use the app', onclick: openHelp }, '?');
