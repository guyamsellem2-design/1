// Pictures in the notebook. Each picture is shrunk on the phone (to about 1600px, JPEG), kept on the
// device, and - when signed in - also uploaded to the cloud, so the other device can show it.
// A note only keeps the picture ids; the pictures themselves never go into the synced data.

import { uid } from './util.js';
import { putPhoto, getPhoto, delPhoto } from './store.js';
import { rpc, syncConfig } from './sync.js';

const QUEUE_KEY = 'shiurim.imgQueue';
const urls = new Map();

function queue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function setQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify([...new Set(q)])); } catch { /* ignore */ }
}

export async function shrink(file, maxSide = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
}

const toB64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

function b64Bytes(b64) {
  const bin = atob(b64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const fromB64 = (b64, mime) => new Blob([b64Bytes(b64)], { type: mime || 'image/jpeg' });

// A picture chosen from the gallery or the camera → its id.
export async function addImage(file) {
  const id = 'img_' + uid();
  const blob = await shrink(file).catch(() => file);
  await putPhoto(id, blob);
  setQueue([...queue(), id]);
  uploadPending();
  return id;
}

// Upload whatever is waiting (after adding a picture or a file, on sign-in, when the connection comes back).
let uploading = false;
export async function uploadPending() {
  const cfg = syncConfig();
  if (!cfg?.token || uploading) return;
  uploading = true;
  try {
    await uploadImages(cfg);
    await uploadFiles(cfg);
  } finally {
    uploading = false;
  }
}

async function uploadImages(cfg) {
  try {
    for (const id of queue()) {
      const blob = await getPhoto(id).catch(() => null);
      if (!blob) { setQueue(queue().filter((x) => x !== id)); continue; }
      const r = await rpc('sync_file_put', { p_token: cfg.token, p_id: id, p_mime: blob.type || 'image/jpeg', p_data: await toB64(blob) });
      if (r && (r.ok || r.error === 'too_big')) setQueue(queue().filter((x) => x !== id));
      else break;
    }
  } catch (err) {
    console.warn('image upload', err);
  }
}

// A displayable address for a picture: from the device, or downloaded from the cloud the first time.
export async function imageURL(id) {
  if (urls.has(id)) return urls.get(id);
  let blob = await getPhoto(id).catch(() => null);
  if (!blob) {
    const cfg = syncConfig();
    if (!cfg?.token) return null;
    try {
      const r = await rpc('sync_file_get', { p_token: cfg.token, p_id: id });
      if (!r || !r.data) return null;
      blob = fromB64(r.data, r.mime);
      await putPhoto(id, blob).catch(() => {});
    } catch { return null; }
  }
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export async function deleteImage(id) {
  await delPhoto(id).catch(() => {});
  setQueue(queue().filter((x) => x !== id));
  const cfg = syncConfig();
  if (cfg?.token) rpc('sync_file_delete', { p_token: cfg.token, p_id: id }).catch(() => {});
}

// ---------- files (PDF, audio, anything) ----------
// Kept on the device as they are (not shrunk). In the cloud a file goes up in parts of 1.5MB, so a large
// file never needs one big request, and an interrupted upload continues from the part it stopped at.

const FILE_QUEUE = 'shiurim.fileQueue';
const FILE_PROGRESS = 'shiurim.fileProgress';
const PART = 1536 * 1024;
export const MAX_FILE = 25 * 1024 * 1024;

const readJSON = (k, def) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? def; } catch { return def; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const fileQueue = () => readJSON(FILE_QUEUE, []);
const setFileQueue = (q) => writeJSON(FILE_QUEUE, [...new Set(q)]);
function fileProgress(id, next) {
  const p = readJSON(FILE_PROGRESS, {});
  if (next === undefined) return p[id] || 0;
  if (next === null) delete p[id]; else p[id] = next;
  writeJSON(FILE_PROGRESS, p);
}
function fileDone(id) {
  setFileQueue(fileQueue().filter((x) => x !== id));
  fileProgress(id, null);
}

// A file chosen on the device → what the note keeps about it (the file itself stays out of the data).
export async function addFile(file) {
  const id = 'file_' + uid();
  await putPhoto(id, file);
  setFileQueue([...fileQueue(), id]);
  uploadPending();
  return { id, name: String(file.name || 'קובץ').slice(0, 200), mime: String(file.type || '').slice(0, 120), size: file.size };
}

async function uploadFiles(cfg) {
  try {
    for (const id of fileQueue()) {
      const blob = await getPhoto(id).catch(() => null);
      if (!blob) { fileDone(id); continue; }
      const parts = Math.max(1, Math.ceil(blob.size / PART));
      for (let i = fileProgress(id); i < parts; i++) {
        const r = await rpc('sync_part_put', {
          p_token: cfg.token, p_id: id, p_part: i, p_parts: parts,
          p_mime: (blob.type || 'application/octet-stream').slice(0, 120),
          p_data: await toB64(blob.slice(i * PART, (i + 1) * PART)),
        });
        if (r && (r.error === 'too_big' || r.error === 'bad_data')) { fileDone(id); break; }
        if (!r || !r.ok) return; // signed out, cloud full or unreachable: try again later
        fileProgress(id, i + 1);
      }
      if (fileQueue().includes(id) && fileProgress(id) >= parts) fileDone(id);
    }
  } catch (err) {
    console.warn('file upload', err);
  }
}

// Is the file already on this device?
export async function fileIsLocal(id) {
  return !!(await getPhoto(id).catch(() => null));
}

// The file itself: from the device, or downloaded from the cloud (part by part) the first time.
export async function fileBlob(id) {
  const local = await getPhoto(id).catch(() => null);
  if (local) return local;
  const cfg = syncConfig();
  if (!cfg?.token) return null;
  try {
    const first = await rpc('sync_part_get', { p_token: cfg.token, p_id: id, p_part: 0 });
    if (!first || first.data == null) return null;
    const chunks = [b64Bytes(first.data)];
    for (let i = 1; i < (first.parts || 1); i++) {
      const r = await rpc('sync_part_get', { p_token: cfg.token, p_id: id, p_part: i });
      if (!r || r.data == null) return null;
      chunks.push(b64Bytes(r.data));
    }
    const blob = new Blob(chunks, { type: first.mime || '' });
    await putPhoto(id, blob).catch(() => {});
    return blob;
  } catch { return null; }
}

export async function fileURL(id) {
  if (urls.has(id)) return urls.get(id);
  const blob = await fileBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export async function deleteFile(id) {
  await delPhoto(id).catch(() => {});
  fileDone(id);
  const cfg = syncConfig();
  if (cfg?.token) rpc('sync_part_delete', { p_token: cfg.token, p_id: id }).catch(() => {});
}

window.addEventListener('online', () => uploadPending());
