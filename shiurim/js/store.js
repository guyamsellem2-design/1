// Persistence: the whole state in localStorage (small, synchronous, survives offline).
// IndexedDB only holds text shared in from the phone's share menu until the app picks it up.

import { migrate } from './model.js';

const KEY = 'shiurim.v1';
const DRAFT_KEY = 'shiurim.draft';
const listeners = new Set();

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    return migrate(raw ? JSON.parse(raw) : null);
  } catch (e) {
    console.error(e);
    return migrate(null);
  }
}

export function saveState(state, { silent = false, touch = true } = {}) {
  if (touch) state.updatedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error(e);
    alert('לא הצלחתי לשמור במכשיר (אולי הזיכרון מלא). כדאי להוריד גיבוי מההגדרות.');
  }
  if (!silent) listeners.forEach((fn) => fn(state));
}

export const onSave = (fn) => listeners.add(fn);

export function getDraft() {
  try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; }
}
export function setDraft(text) {
  try { text ? localStorage.setItem(DRAFT_KEY, text) : localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
}

export function getPref(k, def = null) {
  try { const v = localStorage.getItem('shiurim.pref.' + k); return v == null ? def : JSON.parse(v); } catch { return def; }
}
export function setPref(k, v) {
  try { localStorage.setItem('shiurim.pref.' + k, JSON.stringify(v)); } catch { /* ignore */ }
}

export async function askPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch { /* not supported */ }
}

// ---------- share inbox (IndexedDB, written by sw.js) ----------

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('shiurim', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos');
      if (!d.objectStoreNames.contains('inbox')) d.createObjectStore('inbox');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

// Things shared into the app from the phone's share menu land here (written by sw.js).
export const takeInbox = async () => {
  try {
    const item = await tx('inbox', 'readonly', (s) => s.get('shared'));
    if (item) await tx('inbox', 'readwrite', (s) => s.delete('shared'));
    return item || null;
  } catch {
    return null;
  }
};

// ---------- backup ----------

export function backupBlob(state) {
  return new Blob([JSON.stringify({ app: 'shiurim', exportedAt: new Date().toISOString(), state }, null, 1)], { type: 'application/json' });
}

export async function readBackup(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || (data.app !== 'shiurim' && !data.students)) throw new Error('זה לא קובץ גיבוי של האפליקציה');
  return migrate(data.state || data);
}
