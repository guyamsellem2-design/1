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

function fromB64(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || 'image/jpeg' });
}

// A picture chosen from the gallery or the camera → its id.
export async function addImage(file) {
  const id = 'img_' + uid();
  const blob = await shrink(file).catch(() => file);
  await putPhoto(id, blob);
  setQueue([...queue(), id]);
  uploadPending();
  return id;
}

// Upload whatever is waiting (after adding a picture, on sign-in, when the connection comes back).
let uploading = false;
export async function uploadPending() {
  const cfg = syncConfig();
  if (!cfg?.token || uploading) return;
  uploading = true;
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
  } finally {
    uploading = false;
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

window.addEventListener('online', () => uploadPending());
