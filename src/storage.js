// On-device persistence (IndexedDB). Everything the app saves goes through this module,
// so a cloud-sync backend can later replace it without touching the UI.
//
// Stores
//   patterns : metadata record per pattern (key: id)
//   files    : { id, pdf: Blob }                       the original PDF
//   tiles    : { key: "<id>:<n>", blob: Blob }         pre-rendered page images (PNG)
//   progress : { id, cells: Uint8Array, updated }      0 = none, 1 = half, 2 = full

const DB_NAME = 'stitch-tracker';
const DB_VERSION = 1;

let dbPromise;
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('patterns', { keyPath: 'id' });
      d.createObjectStore('files', { keyPath: 'id' });
      d.createObjectStore('tiles', { keyPath: 'key' });
      d.createObjectStore('progress', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(stores, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(stores, mode);
    let result;
    Promise.resolve(fn(...[].concat(stores).map((s) => tx.objectStore(s)))).then((r) => (result = r), reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

export const listPatterns = () =>
  run('patterns', 'readonly', (s) => wrap(s.getAll())).then((a) => a.sort((x, y) => y.openedAt - x.openedAt));

export const getPattern = (id) => run('patterns', 'readonly', (s) => wrap(s.get(id)));
export const savePattern = (p) => run('patterns', 'readwrite', (s) => wrap(s.put(p)));

export const getPdf = (id) => run('files', 'readonly', (s) => wrap(s.get(id))).then((r) => r && r.pdf);

export const getTile = (id, n) => run('tiles', 'readonly', (s) => wrap(s.get(`${id}:${n}`))).then((r) => r && r.blob);

export const getProgress = (id) => run('progress', 'readonly', (s) => wrap(s.get(id)));
export const saveProgress = (id, cells) =>
  run('progress', 'readwrite', (s) => wrap(s.put({ id, cells, updated: Date.now() })));

/** Saves a freshly imported pattern with its PDF, tiles and empty progress in one transaction. */
export function createPattern(pattern, pdfBlob, tileBlobs) {
  return run(['patterns', 'files', 'tiles', 'progress'], 'readwrite', (pats, files, tiles, prog) => {
    pats.put(pattern);
    files.put({ id: pattern.id, pdf: pdfBlob });
    tileBlobs.forEach((blob, n) => tiles.put({ key: `${pattern.id}:${n}`, blob }));
    prog.put({ id: pattern.id, cells: new Uint8Array(pattern.width * pattern.height), updated: Date.now() });
  });
}

export function deletePattern(id) {
  return run(['patterns', 'files', 'tiles', 'progress'], 'readwrite', (pats, files, tiles, prog) => {
    pats.delete(id);
    files.delete(id);
    prog.delete(id);
    tiles.delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`));
  });
}

/** Asks the browser not to evict our data under storage pressure (best effort). */
export function requestPersistence() {
  return navigator.storage?.persist?.().catch(() => false);
}

/** Replaces a pattern's layout and page images after editing. Clears all stitch progress. */
export function replacePattern(pattern, tileBlobs) {
  return run(['patterns', 'tiles', 'progress'], 'readwrite', (pats, tiles, prog) => {
    pats.put(pattern);
    tiles.delete(IDBKeyRange.bound(`${pattern.id}:`, `${pattern.id}:\uffff`));
    tileBlobs.forEach((blob, n) => tiles.put({ key: `${pattern.id}:${n}`, blob }));
    prog.put({ id: pattern.id, cells: new Uint8Array(pattern.width * pattern.height), updated: Date.now() });
  });
}
