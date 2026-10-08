// Small shared helpers: dates as 'YYYY-MM-DD' strings in local time, times as 'HH:MM'.

export const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISO(new Date());

export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export const weekday = (iso) => fromISO(iso).getDay();

export function daysBetween(a, b) {
  return Math.round((fromISO(b) - fromISO(a)) / 86400000);
}

export function toMin(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

export function fromMin(m) {
  m = Math.max(0, Math.round(m));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export const endTime = (t, len) => fromMin(toMin(t) + Number(len || 0));

export function fmtDate(iso) {
  const d = fromISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export function fmtDateFull(iso) {
  const d = fromISO(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

export function fmtDay(iso) {
  return `יום ${DAY_NAMES[weekday(iso)]}, ${fmtDate(iso)}`;
}

export function relDay(iso, today = todayISO()) {
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'היום';
  if (diff === -1) return 'אתמול';
  if (diff === 1) return 'מחר';
  return null;
}

let uidCounter = 0;
export function uid() {
  uidCounter = (uidCounter + 1) % 1e6;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + uidCounter.toString(36);
}

const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

// Normalise Hebrew for comparisons: no niqqud, no final letters, no quotes, single spaces.
export function norm(s) {
  return String(s || '')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/["'״׳`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
