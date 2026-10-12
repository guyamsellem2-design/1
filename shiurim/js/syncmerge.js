// Merging the same data edited on two devices.
// Every save stamps what changed (per day, per student, and the settings as one block). When the phone and
// the computer both changed things, each day / student / the settings come from whichever side touched them
// last, and deleted days stay deleted. Pure functions, so they are tested in node.

import { clone, norm } from './util.js';

const GLOBAL_KEYS = ['teacher', 'settings', 'frames', 'statuses', 'holidays', 'holidayOverride'];

export function ensureMeta(state) {
  if (!state.sync || typeof state.sync !== 'object') state.sync = {};
  const m = state.sync;
  m.days = m.days || {};
  m.students = m.students || {};
  m.tomb = m.tomb || {};
  m.globalAt = m.globalAt || 0;
  return m;
}

const globalOf = (s) => JSON.stringify(GLOBAL_KEYS.map((k) => s[k]));

// Compare with the last saved version and stamp whatever changed.
export function stampChanges(prev, next, now = Date.now()) {
  const m = ensureMeta(next);
  if (!prev) return next;
  const pd = prev.days || {};
  const nd = next.days || {};
  for (const d of new Set([...Object.keys(pd), ...Object.keys(nd)])) {
    const a = pd[d] === undefined ? undefined : JSON.stringify(pd[d]);
    const b = nd[d] === undefined ? undefined : JSON.stringify(nd[d]);
    if (a === b) continue;
    if (b === undefined) { m.tomb[d] = now; delete m.days[d]; } else { m.days[d] = now; delete m.tomb[d]; }
  }
  const ps = new Map((prev.students || []).map((x) => [x.id, JSON.stringify(x)]));
  for (const st of next.students || []) {
    if (ps.get(st.id) !== JSON.stringify(st)) m.students[st.id] = now;
  }
  if (globalOf(prev) !== globalOf(next)) m.globalAt = now;
  return next;
}

// First time a device joins: everything it has counts as edited now.
export function stampAll(state, now = Date.now()) {
  const m = ensureMeta(state);
  for (const d of Object.keys(state.days || {})) m.days[d] = m.days[d] || now;
  for (const st of state.students || []) m.students[st.id] = m.students[st.id] || now;
  m.globalAt = m.globalAt || now;
  return state;
}

function remapStudent(state, fromId, toId) {
  for (const rec of Object.values(state.days || {})) {
    for (const l of rec.lessons || []) if (l.studentId === fromId) l.studentId = toId;
  }
}

/**
 * Merge the remote state into the local one. Returns a new object; neither input is changed.
 */
export function mergeStates(localIn, remoteIn) {
  if (!remoteIn) return clone(localIn);
  const local = clone(localIn);
  const remote = clone(remoteIn);
  const lm = ensureMeta(local);
  const rm = ensureMeta(remote);
  const out = clone(local);
  const om = ensureMeta(out);

  // Settings and lists: as one block, newest wins.
  if (rm.globalAt > lm.globalAt) {
    for (const k of GLOBAL_KEYS) out[k] = remote[k];
    om.globalAt = rm.globalAt;
  }

  // The same student entered separately on both devices (same name, different id): keep one.
  const remoteByName = new Map();
  for (const st of remote.students || []) if (!st.deleted) remoteByName.set(norm(st.name), st);
  const localIds = new Set((local.students || []).map((x) => x.id));
  for (const st of out.students || []) {
    const twin = remoteByName.get(norm(st.name));
    if (twin && twin.id !== st.id && !st.deleted && !localIds.has(twin.id) && !(remote.students || []).some((x) => x.id === st.id)) {
      remapStudent(out, st.id, twin.id);
      om.students[twin.id] = Math.max(om.students[st.id] || 0, rm.students[twin.id] || 0);
      delete om.students[st.id];
      st.id = twin.id;
    }
  }

  // Students: by id, newest wins.
  const byId = new Map((out.students || []).map((x) => [x.id, x]));
  for (const st of remote.students || []) {
    const mine = byId.get(st.id);
    const rt = rm.students[st.id] || 0;
    const lt = om.students[st.id] || 0;
    if (!mine) { byId.set(st.id, st); om.students[st.id] = rt; } else if (rt > lt) { byId.set(st.id, st); om.students[st.id] = rt; }
  }
  out.students = [...byId.values()];

  // Days: by date, newest wins; a deletion is a change too.
  const dates = new Set([...Object.keys(out.days || {}), ...Object.keys(remote.days || {}), ...Object.keys(lm.tomb), ...Object.keys(rm.tomb)]);
  out.days = out.days || {};
  for (const d of dates) {
    const lt = Math.max(lm.days[d] || 0, lm.tomb[d] || 0);
    const rt = Math.max(rm.days[d] || 0, rm.tomb[d] || 0);
    const localHas = d in (local.days || {});
    const remoteHas = d in (remote.days || {});
    if (rt > lt) {
      if (remoteHas) { out.days[d] = remote.days[d]; om.days[d] = rm.days[d]; delete om.tomb[d]; } else { delete out.days[d]; om.tomb[d] = rm.tomb[d]; delete om.days[d]; }
    } else if (!localHas && remoteHas && !lm.tomb[d]) {
      out.days[d] = remote.days[d];
      om.days[d] = rm.days[d] || 0;
    }
  }
  out.updatedAt = Math.max(local.updatedAt || 0, remote.updatedAt || 0);
  return out;
}
