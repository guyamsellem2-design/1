// Photo of a handwritten notebook page → plain text, using Claude's vision.
// Claude only transcribes; the transcribed text then goes through the same on-device parser as typed text,
// so a photo and a typed note always end up in the same review screen.

import { activeStudents } from './model.js';

const KEY = 'shiurim.anthropicKey';
const MODEL = 'claude-opus-5-5';
// @anthropic-ai/sdk 0.128.0, bundled for the browser (vendor/anthropic-sdk.mjs) so it works without a CDN.
const SDK_URL = new URL('../vendor/anthropic-sdk.mjs', import.meta.url).href;

export function getApiKey() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}
export function setApiKey(k) {
  try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch { /* ignore */ }
}
export const hasApiKey = () => !!getApiKey();

let clientPromise = null;
let clientKey = null;
async function client() {
  const key = getApiKey();
  if (!key) throw new Error('חסר מפתח Claude בהגדרות');
  if (!clientPromise || clientKey !== key) {
    clientKey = key;
    clientPromise = import(SDK_URL).then((mod) => {
      const Anthropic = mod.default || mod.Anthropic;
      // The key lives only in this browser and is sent only to Anthropic.
      return new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    });
  }
  return clientPromise;
}

export async function testApiKey() {
  const c = await client();
  await c.models.retrieve(MODEL);
}

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function compressImage(file, maxSide = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b || file), 'image/jpeg', quality));
}

const SYSTEM = `You transcribe photos of a music teacher's handwritten Hebrew notebook pages into plain text.
Copy what is written, line by line, in the original order and wording. Keep day names, dates, times and ranges
(like "14:30-15") exactly as written, and keep separators such as "-" or ":".
The page is about lessons with students; when a handwritten name plausibly matches one of the known student names,
spell it the way the list does. Do not add, summarise, translate or explain anything. If a word is unreadable, write [?].
Output only the transcription.`;

export async function transcribePhoto(blob, state) {
  const c = await client();
  const data = await toBase64(blob);
  const names = activeStudents(state).map((s) => [s.name, ...(s.aliases || [])].join(' / ')).join('\n');
  const msg = await c.beta.messages.create({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: blob.type || 'image/jpeg', data } },
        { type: 'text', text: `Known students:\n${names || '(none yet)'}\n\nTranscribe the page.` },
      ],
    }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('הבקשה נדחתה. אפשר לנסות תמונה אחרת או להקליד.');
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}
