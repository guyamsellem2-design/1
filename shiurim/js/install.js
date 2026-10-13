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
    toast('ההתקנה התחילה. בעוד כמה שניות "שיעורים" יופיע במסך הבית או ברשימת האפליקציות', 5000);
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

// Chrome says "already installed" but there is no icon, or "Open app" fails.
const TROUBLE = `<details class="help" style="margin-top:14px"><summary>כרום אומר שזה כבר מותקן, אבל אין אייקון או שזה לא נפתח?</summary>
  <p class="hint" style="margin:8px 0">לפני הכל: אם עוד לא התחברת עם מייל (☁︎ למעלה), כדאי להתחבר קודם, כדי שהנתונים יהיו שמורים גם בענן.</p>
  <ol>
    <li><b>לחפש ברשימת כל האפליקציות</b> (מחליקים למעלה במסך הבית) את "שיעורים". לפעמים האייקון נכנס לשם ולא למסך הבית.</li>
    <li><b>שיאומי, רדמי, פוקו, אופו, ריאלמי, וואווי:</b> הגדרות הטלפון ← אפליקציות ← Chrome ← הרשאות ← להפעיל <b>"קיצורי דרך במסך הבית"</b> (או "הרשאות נוספות"). אחר כך להתקין שוב.</li>
    <li><b>אם "שיעורים" מופיע בהגדרות הטלפון ← אפליקציות</b> אבל לא נפתח: להסיר אותו משם, לסגור את כרום לגמרי, לפתוח את הקישור שוב וללחוץ "התקנה".</li>
    <li><b>דרך שעובדת תמיד:</b> בכרום ⋮ ← "הוספה למסך הבית" ← לבחור <b>"יצירת קיצור דרך"</b> (ולא "התקנה"). מתקבל אייקון במסך הבית שפותח את האתר ישר.</li>
  </ol></details>`;

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
  installHelp();
}

// The instructions for this phone, plus what to do when Chrome says it's installed but it isn't there.
export function installHelp() {
  const p = platform();
  const android = p === 'android-chrome' || p === 'samsung';
  openSheet({
    title: 'התקנה כאפליקציה',
    body: el(`<div>${STEPS[p]}${android ? TROUBLE : ''}</div>`),
    actions: [{ label: 'הבנתי', cls: 'primary', grow: true }],
  });
}
