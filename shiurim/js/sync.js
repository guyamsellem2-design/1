// Cloud sync: sign in with an email and a password, and the phone and the computer share the same data.
// The device keeps working offline as before; changes go up a moment after each save, and the other
// device's changes come down when the app opens, comes back to the foreground, or every minute.

import { replaceState, onSave } from './store.js';
import { mergeStates, stampAll } from './syncmerge.js';
import { clone } from './util.js';

const SB_URL = 'https://upuczcczyjjsuecztawp.supabase.co';
const SB_KEY = 'sb_publishable_HvUUexvx2xUlF7V9NdivRQ_U4BDd76x';
const CFG_KEY = 'shiurim.sync';
const PULL_EVERY = 60 * 1000;

let app = null;
let status = 'off'; // off | ok | busy | offline | error
let lastSync = 0;
let pushTimer = null;
let pushing = false;
let dirty = false;
let pendingRemote = null;
const statusListeners = new Set();

export function syncConfig() {
  try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { return null; }
}
function setConfig(c) {
  try { c ? localStorage.setItem(CFG_KEY, JSON.stringify(c)) : localStorage.removeItem(CFG_KEY); } catch { /* ignore */ }
}
export const isSignedIn = () => !!syncConfig()?.token;
export const syncStatus = () => ({ status, lastSync, email: syncConfig()?.email || '' });
export const onSyncStatus = (fn) => statusListeners.add(fn);
function setStatus(s) {
  status = s;
  if (s === 'ok') lastSync = Date.now();
  statusListeners.forEach((fn) => fn(syncStatus()));
}

async function rpc(fn, args) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`שגיאה מהשרת (${res.status})`), { status: res.status, detail: text });
  }
  return res.json();
}

const ERRORS = {
  bad_email: 'כתובת המייל לא נראית תקינה',
  short_password: 'הסיסמה צריכה להיות לפחות 6 תווים',
  wrong_password: 'הסיסמה לא נכונה',
  locked: 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה',
  not_found: 'אין עדיין חשבון עם המייל הזה',
};

function hasContent(s) {
  return (s.students || []).length > 0 || Object.keys(s.days || {}).length > 0 || !!(s.teacher && s.teacher.name);
}

// The state is only swapped when nothing on screen is holding on to the old one.
function safeToReplace() {
  if (!app) return false;
  if (app.view === 'review' || document.querySelector('.scrim, .cell-editor')) return false;
  const a = document.activeElement;
  if (a && a.id === 'write') return true; // the notebook draft lives in its own storage
  return !(a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox')));
}

function applyLocal(next, { announce = false } = {}) {
  const before = JSON.stringify({ d: app.state.days, s: app.state.students, g: app.state.settings, t: app.state.teacher });
  app.state = next;
  replaceState(next);
  const after = JSON.stringify({ d: next.days, s: next.students, g: next.settings, t: next.teacher });
  if (before !== after) {
    // Don't pull the page out from under someone who is typing in the notebook; the next screen shows it.
    if (document.activeElement?.id !== 'write') app.render();
    if (announce) app.toast?.('התעדכן מהמכשיר השני ✓');
  }
}

/**
 * Sign in (or create the account). Returns { ok } or { error, needCreate }.
 */
export async function signIn(email, password, create = false) {
  let r;
  try {
    r = await rpc('sync_login', { p_email: email, p_password: password, p_create: create });
  } catch (err) {
    return { error: navigator.onLine === false ? 'אין חיבור לאינטרנט' : (err.message || 'החיבור נכשל') };
  }
  if (r.error) return { error: ERRORS[r.error] || r.error, needCreate: r.error === 'not_found' };
  setConfig({ email: r.email, token: r.token, version: r.version });
  setStatus('busy');
  const local = stampAll(clone(app.state));
  let next;
  if (!r.data) next = local;
  else if (hasContent(local)) next = mergeStates(local, r.data);
  else next = clone(r.data);
  applyLocal(next);
  await pushNow();
  return { ok: true, created: !!r.created, merged: !!r.data && hasContent(local) };
}

export async function signOut() {
  const cfg = syncConfig();
  setConfig(null);
  setStatus('off');
  if (cfg?.token) rpc('sync_logout', { p_token: cfg.token }).catch(() => {});
}

function handleSignedOut() {
  setConfig(null);
  setStatus('off');
  app.toast?.('החיבור לענן נותק. צריך להתחבר שוב בהגדרות');
}

export async function pushNow() {
  const cfg = syncConfig();
  if (!cfg?.token) return;
  if (pushing) { dirty = true; return; }
  pushing = true;
  dirty = false;
  setStatus('busy');
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const c = syncConfig();
      if (!c?.token) return;
      const r = await rpc('sync_push', { p_token: c.token, p_base_version: c.version, p_data: app.state });
      if (r.error === 'signed_out') { handleSignedOut(); return; }
      if (r.error) throw new Error(r.error);
      if (r.conflict) {
        // The other device saved first: take its changes in, then try again on top of them.
        if (!safeToReplace()) { pendingRemote = r; dirty = true; setStatus('ok'); break; }
        setConfig({ ...c, version: r.version });
        applyLocal(mergeStates(app.state, r.data), { announce: true });
        continue;
      }
      setConfig({ ...c, version: r.version });
      setStatus('ok');
      break;
    }
  } catch (err) {
    console.warn('sync push', err);
    setStatus(navigator.onLine === false ? 'offline' : 'error');
    dirty = true;
  } finally {
    pushing = false;
  }
  if (dirty && status === 'ok') schedulePush(300);
}

function schedulePush(ms = 1500) {
  if (!isSignedIn()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, ms);
}

export async function pullNow() {
  const cfg = syncConfig();
  if (!cfg?.token || pushing) return;
  if (!safeToReplace()) return; // try again on the next round
  try {
    const r = await rpc('sync_pull', { p_token: cfg.token, p_known_version: cfg.version });
    if (r.error === 'signed_out') { handleSignedOut(); return; }
    if (r.error) throw new Error(r.error);
    if (r.same) { if (!dirty) setStatus('ok'); return; }
    if (!safeToReplace()) return;
    const merged = r.data ? mergeStates(app.state, r.data) : app.state;
    setConfig({ ...syncConfig(), version: r.version });
    applyLocal(merged, { announce: true });
    if (JSON.stringify(merged) !== JSON.stringify(r.data)) schedulePush(200);
    else setStatus('ok');
  } catch (err) {
    console.warn('sync pull', err);
    setStatus(navigator.onLine === false ? 'offline' : 'error');
  }
}

export function initSync(theApp) {
  app = theApp;
  onSave(() => schedulePush());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pullNow(); });
  window.addEventListener('online', () => { pushNow().then(pullNow); });
  setInterval(() => { if (document.visibilityState === 'visible') pullNow(); }, PULL_EVERY);
  // Newer data that arrived while a window was open is merged in once it closes.
  setInterval(() => {
    if (!pendingRemote || !safeToReplace()) return;
    const r = pendingRemote;
    pendingRemote = null;
    setConfig({ ...syncConfig(), version: r.version });
    applyLocal(mergeStates(app.state, r.data), { announce: true });
    pushNow();
  }, 2000);
  if (!isSignedIn()) { setStatus('off'); return; }
  setStatus('busy');
  pullNow().then(() => { if (dirty) schedulePush(100); });
}
