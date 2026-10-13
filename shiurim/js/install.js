// "Install as an app": Chrome's own install prompt when it offers one, and otherwise
// step-by-step instructions for the exact phone and browser in use.

import { el, openSheet, toast } from './ui.js';

let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

export const isInstalled = () =>
  matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: minimal-ui)').matches || navigator.standalone === true;
export const canPrompt = () => !!deferred;
export const onInstallChange = (fn) => listeners.add(fn);

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    deferred = ev;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
    toast('האפליקציה הותקנה ✓ אפשר לפתוח אותה ממסך הבית');
  });
}

function platform() {
  const ua = navigator.userAgent || '';
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const inApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp|GSA\/|; wv\)|Telegram/i.test(ua);
  if (inApp) return 'inapp';
  if (ios) return /CriOS/.test(ua) ? 'ios-chrome' : 'ios-safari';
  if (/SamsungBrowser/.test(ua)) return 'samsung';
  if (/Android/.test(ua)) return 'android-chrome';
  return 'desktop';
}

const STEPS = {
  inapp: `<p><b>הקישור נפתח בתוך אפליקציה אחרת</b> (וואטסאפ, ג'ימייל, פייסבוק וכדומה), ומשם אי אפשר להתקין.</p>
    <ol><li>בתפריט של המסך הזה (⋮ או …) לוחצים <b>"פתח בכרום"</b> או <b>"פתח בדפדפן"</b>.</li>
    <li>בכרום לוחצים שוב על "התקנה" באתר.</li></ol>`,
  'android-chrome': `<ol>
    <li>בכרום, לוחצים על <b>⋮</b> (שלוש הנקודות למעלה, ליד שורת הכתובת).</li>
    <li>בוחרים <b>"התקנת אפליקציה"</b>, או <b>"הוספה למסך הבית"</b> ואז <b>"התקנה"</b>.</li>
    <li>האייקון "שיעורים" יופיע במסך הבית.</li></ol>
    <p class="hint">לא מופיעה האפשרות? אולי האפליקציה כבר מותקנת. כדאי לחפש "שיעורים" במסך הבית או ברשימת האפליקציות. אם היא לא שם, כדאי לסגור את כרום לגמרי, לפתוח את הקישור שוב ולחכות כמה שניות.</p>`,
  samsung: `<ol><li>לוחצים על <b>☰</b> (התפריט למטה).</li>
    <li>בוחרים <b>"הוסף דף אל"</b> ואז <b>"מסך הבית"</b>.</li></ol>
    <p class="hint">אפשר גם לפתוח את הקישור בכרום ולהתקין משם.</p>`,
  'ios-safari': `<ol><li>לוחצים על כפתור <b>השיתוף</b> (ריבוע עם חץ למעלה) בתחתית המסך.</li>
    <li>גוללים ובוחרים <b>"הוסף למסך הבית"</b>.</li>
    <li>לוחצים <b>"הוסף"</b>. האייקון "שיעורים" יופיע במסך הבית.</li></ol>`,
  'ios-chrome': `<ol><li>לוחצים על כפתור <b>השיתוף</b> (ריבוע עם חץ למעלה) בשורת הכתובת למעלה.</li>
    <li>בוחרים <b>"הוסף למסך הבית"</b>.</li></ol>
    <p class="hint">אם אין את האפשרות הזו (גרסה ישנה של אייפון), כדאי לפתוח את הקישור בספארי: שיתוף ← "הוסף למסך הבית".</p>`,
  desktop: `<ol><li>בשורת הכתובת של כרום, בצד ימין, לוחצים על סמל ההתקנה (מסך עם חץ).</li>
    <li>או: <b>⋮</b> ← <b>"העברה, שמירה ושיתוף"</b> ← <b>"התקנת הדף כאפליקציה"</b>.</li></ol>`,
};

export async function installApp() {
  if (isInstalled()) { toast('האפליקציה כבר מותקנת ופתוחה כאפליקציה ✓'); return; }
  if (deferred) {
    const ev = deferred;
    deferred = null;
    notify();
    ev.prompt();
    try { await ev.userChoice; } catch { /* ignore */ }
    return;
  }
  const p = platform();
  openSheet({
    title: 'התקנה כאפליקציה',
    body: el(`<div>${STEPS[p]}</div>`),
    actions: [{ label: 'הבנתי', cls: 'primary', grow: true }],
  });
}
