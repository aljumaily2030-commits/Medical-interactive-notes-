/**
 * Markdown Studio — storage.js
 * IndexedDB persistence layer: files, autosave, version snapshots, settings.
 *
 * DB name  : markdown-studio
 * Version  : 3
 * Stores:
 *   files      { id, name, content, createdAt, updatedAt }
 *   snapshots  { id (auto), fileId, content, savedAt, label }
 *   settings   { key, value }
 *   images     { id, name, path, mime, dataUrl, width, height }
 */

const DB_NAME    = 'markdown-studio';
const DB_VERSION = 3;
const MAX_SNAPSHOTS_PER_FILE = 50;

// ─── open ──────────────────────────────────────────────────────────────────

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldV = e.oldVersion;

      // files store
      if (!db.objectStoreNames.contains('files')) {
        const fs = db.createObjectStore('files', { keyPath: 'id' });
        fs.createIndex('updatedAt', 'updatedAt');
      }

      // snapshots store (v2)
      if (!db.objectStoreNames.contains('snapshots')) {
        const ss = db.createObjectStore('snapshots', {
          keyPath: 'id', autoIncrement: true
        });
        ss.createIndex('fileId', 'fileId');
        ss.createIndex('savedAt', 'savedAt');
      }

      // settings store (v2)
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }

      // images store (v3)
      if (!db.objectStoreNames.contains('images')) {
        const is = db.createObjectStore('images', { keyPath: 'id' });
        is.createIndex('path', 'path', { unique: false });
      }
    };

    req.onsuccess = (e) => {
      _db = e.target.result;
      resolve(_db);
    };
    req.onerror  = () => reject(req.error);
  });
}

// ─── low-level helpers ─────────────────────────────────────────────────────

function tx(store, mode = 'readonly') {
  return _db.transaction(store, mode).objectStore(store);
}

function promisify(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function getAll(store) {
  return new Promise((res, rej) => {
    const req = tx(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function clearStore(store) {
  return promisify(tx(store, 'readwrite').clear());
}

function toPlainData(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

// ─── FILES ─────────────────────────────────────────────────────────────────

export async function getAllFiles() {
  await openDB();
  return getAll('files');
}

export async function getFile(id) {
  await openDB();
  return promisify(tx('files').get(id));
}

export async function saveFile(file) {
  await openDB();
  const stored = toPlainData(file);
  stored.updatedAt = Date.now();
  if (!stored.createdAt) stored.createdAt = stored.updatedAt;
  return promisify(tx('files', 'readwrite').put(stored));
}

export async function deleteFile(id) {
  await openDB();
  // delete the file itself
  await promisify(tx('files', 'readwrite').delete(id));
  // delete all its snapshots
  await deleteSnapshotsForFile(id);
}

export async function replaceAllFiles(files = []) {
  await openDB();
  await clearStore('files');
  for (const file of files) {
    await promisify(tx('files', 'readwrite').put(toPlainData(file)));
  }
}

// ─── AUTOSAVE ──────────────────────────────────────────────────────────────

let _autosaveTimer  = null;
let _autosaveDelay  = 2000; // ms
let _autosaveVersion = 0;
let _autosaveQueue = Promise.resolve();
const _latestAutosaveByFile = new Map();

/**
 * Schedule an autosave. Resets the timer on every call (debounce).
 * @param {object}   file      – the current file object (id, name, content …)
 * @param {function} onSaved   – optional callback after save completes
 */
export function scheduleAutosave(file, onSaved, onError, onSaving) {
  clearTimeout(_autosaveTimer);
  const version = ++_autosaveVersion;
  const fileId = file?.id || "__default__";
  _latestAutosaveByFile.set(fileId, version);

  _autosaveTimer = setTimeout(async () => {
    _autosaveQueue = _autosaveQueue
      .then(async () => {
        if (_latestAutosaveByFile.get(fileId) !== version) return;
        if (typeof onSaving === 'function') onSaving();
        await saveFile({ ...file });
        if (_latestAutosaveByFile.get(fileId) !== version) return;
        if (typeof onSaved === 'function') onSaved();
      })
      .catch((error) => {
        if (typeof onError === 'function') onError(error);
      });
  }, _autosaveDelay);
}

export function setAutosaveDelay(ms) {
  _autosaveDelay = ms;
}

export function cancelAutosave() {
  clearTimeout(_autosaveTimer);
  _autosaveVersion++;
  _latestAutosaveByFile.clear();
}

// ─── SNAPSHOTS ─────────────────────────────────────────────────────────────

export async function createSnapshot(fileId, content, label = '') {
  await openDB();
  const snap = {
    fileId,
    content,
    savedAt: Date.now(),
    label: label || new Date().toLocaleString(),
  };
  const id = await promisify(tx('snapshots', 'readwrite').add(snap));

  // Prune old snapshots — keep only the most recent MAX_SNAPSHOTS_PER_FILE
  await pruneSnapshots(fileId);
  return id;
}

export async function getSnapshots(fileId) {
  await openDB();
  return new Promise((res, rej) => {
    const idx   = tx('snapshots').index('fileId');
    const range = IDBKeyRange.only(fileId);
    const req   = idx.getAll(range);
    req.onsuccess = () => {
      // Sort newest first
      const sorted = (req.result || []).sort((a, b) => b.savedAt - a.savedAt);
      res(sorted);
    };
    req.onerror = () => rej(req.error);
  });
}

export async function getSnapshot(id) {
  await openDB();
  return promisify(tx('snapshots').get(id));
}

export async function getAllSnapshots() {
  await openDB();
  return getAll('snapshots');
}

export async function deleteSnapshot(id) {
  await openDB();
  return promisify(tx('snapshots', 'readwrite').delete(id));
}

async function deleteSnapshotsForFile(fileId) {
  const snaps = await getSnapshots(fileId);
  const store = tx('snapshots', 'readwrite');
  for (const s of snaps) {
    store.delete(s.id);
  }
}

async function pruneSnapshots(fileId) {
  const snaps = await getSnapshots(fileId); // already sorted newest-first
  if (snaps.length <= MAX_SNAPSHOTS_PER_FILE) return;
  const toDelete = snaps.slice(MAX_SNAPSHOTS_PER_FILE);
  const store = tx('snapshots', 'readwrite');
  for (const s of toDelete) {
    store.delete(s.id);
  }
}

export async function replaceAllSnapshots(snapshots = []) {
  await openDB();
  await clearStore('snapshots');
  for (const snapshot of snapshots) {
    const stored = toPlainData(snapshot);
    if (stored.id == null) delete stored.id;
    await promisify(tx('snapshots', 'readwrite').add(stored));
  }
}

// ─── IMAGES ────────────────────────────────────────────────────────────────

export async function getAllImages() {
  await openDB();
  return getAll('images');
}

export async function saveImage(image) {
  await openDB();
  return promisify(tx('images', 'readwrite').put(toPlainData(image)));
}

export async function deleteImage(id) {
  await openDB();
  return promisify(tx('images', 'readwrite').delete(id));
}

export async function replaceAllImages(images = []) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = _db.transaction('images', 'readwrite');
    const store = transaction.objectStore('images');
    store.clear();
    for (const image of images) {
      store.put(toPlainData(image));
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// ─── SETTINGS ──────────────────────────────────────────────────────────────

export async function getSetting(key, defaultValue = null) {
  await openDB();
  try {
    const row = await promisify(tx('settings').get(key));
    return row ? row.value : defaultValue;
  } catch (_) {
    return defaultValue;
  }
}

export async function setSetting(key, value) {
  await openDB();
  return promisify(tx('settings', 'readwrite').put({ key, value: toPlainData(value) }));
}

export async function deleteSetting(key) {
  await openDB();
  return promisify(tx('settings', 'readwrite').delete(key));
}

export async function getAllSettings() {
  await openDB();
  const rows = await getAll('settings');
  const out  = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function replaceAllSettings(settings = {}) {
  await openDB();
  await clearStore('settings');
  for (const [key, value] of Object.entries(settings || {})) {
    await setSetting(key, value);
  }
}

export async function exportWorkspaceData() {
  await openDB();
  return {
    exportedAt: new Date().toISOString(),
    dbVersion: DB_VERSION,
    files: await getAllFiles(),
    snapshots: await getAllSnapshots(),
    settings: await getAllSettings(),
    images: await getAllImages(),
  };
}

export async function importWorkspaceData(data) {
  await openDB();
  const files = Array.isArray(data?.files) ? data.files : [];
  const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
  const settings = data?.settings && typeof data.settings === 'object'
    ? data.settings
    : {};
  const images = Array.isArray(data?.images)
    ? data.images
    : Array.isArray(settings.imageLibrary)
      ? settings.imageLibrary
      : [];
  await replaceAllFiles(files);
  await replaceAllSnapshots(snapshots);
  await replaceAllSettings(settings);
  await replaceAllImages(images);
  await deleteSetting('imageLibrary');
}

// ─── MIGRATION: localStorage → IndexedDB ──────────────────────────────────
// Run once on startup. If old data exists in localStorage, import it.

export async function migrateFromLocalStorage() {
  const migrated = await getSetting('ls_migrated', false);
  if (migrated) return;

  try {
    const raw = localStorage.getItem('md_studio_files');
    if (raw) {
      const files = JSON.parse(raw);
      if (Array.isArray(files)) {
        for (const f of files) {
          // Only import if not already in IDB
          const existing = await getFile(f.id).catch(() => null);
          if (!existing) await saveFile(f);
        }
      }
    }
  } catch (e) {
    console.warn('[storage] migration from localStorage failed:', e);
  }

  await setSetting('ls_migrated', true);
}
