// The data and the rules: regular schedule, one-time changes per day, holidays.
// Pure functions over a plain state object, so the same logic serves the notebook, the table,
// the calendar and the export - one source of truth, several views.

import { uid, weekday, toMin, fromMin, addDays, norm, clone, todayISO } from './util.js';

export const DEFAULT_STATUSES = [
  { id: 'came', name: 'הגיע', bg: '#11734B', fg: '#D4EDBC', counts: true },
  { id: 'notified', name: 'לא הגיע והודיע', bg: '#FFE5A0', fg: '#473821' },
  { id: 'noshow', name: 'לא הגיע לא הודיע', bg: '#B10202', fg: '#FFCFC9' },
  { id: 'trip', name: 'טיול ישיבתי / אילוצי מערכת', bg: '#753800', fg: '#FFC8AA' },
];

// תשפ"ז, from the Ministry of Education calendar (high schools). Editable in settings.
export const HOLIDAYS_5787 = [
  { from: '2026-09-11', to: '2026-09-13', name: 'ראש השנה' },
  { from: '2026-09-20', to: '2026-09-24', name: 'יום כיפור' },
  { from: '2026-09-25', to: '2026-10-04', name: 'סוכות' },
  { from: '2026-12-06', to: '2026-12-12', name: 'חנוכה' },
  { from: '2027-03-23', to: '2027-03-24', name: 'פורים' },
  { from: '2027-04-13', to: '2027-04-28', name: 'פסח' },
  { from: '2027-05-12', to: '2027-05-12', name: 'יום העצמאות' },
  { from: '2027-06-10', to: '2027-06-11', name: 'שבועות' },
];

export function defaultState() {
  return {
    version: 1,
    teacher: { name: '', subject: 'גיטרה' },
    settings: {
      workDays: [1, 2, 3], // שני, שלישי, רביעי
      dayStart: '14:00',
      dayEnd: '21:30',
      yearStart: '2026-09-01',
      yearEnd: '2027-06-20',
      exportNames: false,
    },
    frames: [
      { id: 'yeshiva', name: 'ישיבה' },
      { id: 'private', name: 'פרטי' },
    ],
    statuses: clone(DEFAULT_STATUSES),
    students: [],
    days: {},
    holidays: HOLIDAYS_5787.map((h) => ({ id: uid(), ...h })),
    holidayOverride: {},
    updatedAt: 0,
  };
}

export function migrate(s) {
  const d = defaultState();
  if (!s || typeof s !== 'object') return d;
  const out = { ...d, ...s };
  out.teacher = { ...d.teacher, ...(s.teacher || {}) };
  out.settings = { ...d.settings, ...(s.settings || {}) };
  out.frames = s.frames?.length ? s.frames : d.frames;
  out.statuses = s.statuses?.length ? s.statuses : d.statuses;
  out.students = s.students || [];
  out.days = s.days || {};
  out.holidays = s.holidays || d.holidays;
  out.holidayOverride = s.holidayOverride || {};
  return out;
}

// ---------- students & regular schedule ----------

export const studentById = (state, id) => state.students.find((s) => s.id === id);

// The regular slot of a student on a given date. Changes apply from a date onwards, never backwards.
export function slotOn(student, date) {
  if (!student) return null;
  if (student.deleted && (!student.deletedFrom || date >= student.deletedFrom)) return null;
  const versions = (student.schedule || []).filter((v) => v.from <= date).sort((a, b) => (a.from < b.from ? -1 : 1));
  return versions.length ? versions[versions.length - 1] : null;
}

export function currentSlot(student, date = todayISO()) {
  const v = slotOn(student, date);
  if (v) return v;
  const sorted = (student.schedule || []).slice().sort((a, b) => (a.from < b.from ? -1 : 1));
  return sorted[0] || null;
}

export function activeStudents(state, date = todayISO()) {
  return state.students.filter((s) => !(s.deleted && (!s.deletedFrom || s.deletedFrom <= date)));
}

export function addStudent(state, { name, aliases = [], frame = 'yeshiva', day, time, len = 30, notes = '', phone = '', parentPhone = '', grade = '', from }) {
  const st = {
    id: uid(),
    name: name.trim(),
    aliases,
    frame,
    notes,
    phone,
    parentPhone,
    grade,
    startDate: null,
    schedule: day != null && time ? [{ from: from || '2000-01-01', day: Number(day), time, len: Number(len) }] : [],
  };
  state.students.push(st);
  return st;
}

// Change the regular slot from `from` onwards. Days already reported keep what happened.
export function setSlot(student, { day, time, len }, from) {
  student.schedule = (student.schedule || []).filter((v) => v.from < from);
  student.schedule.push({ from, day: Number(day), time, len: Number(len) });
}

export function overlaps(state, { day, time, len }, exceptId, date = todayISO()) {
  const a = toMin(time);
  const b = a + Number(len);
  return activeStudents(state, date).filter((s) => {
    if (s.id === exceptId) return false;
    const v = currentSlot(s, date);
    if (!v || Number(v.day) !== Number(day)) return false;
    const c = toMin(v.time);
    const d = c + Number(v.len);
    return a < d && c < b;
  });
}

// ---------- holidays ----------

export function holidayOn(state, date) {
  if (Object.prototype.hasOwnProperty.call(state.holidayOverride || {}, date)) return state.holidayOverride[date] || '';
  const h = (state.holidays || []).find((x) => x.from <= date && date <= (x.to || x.from));
  return h ? h.name : '';
}

// ---------- days ----------

function plannedLessons(state, date) {
  if (holidayOn(state, date)) return [];
  const wd = weekday(date);
  const out = [];
  for (const st of state.students) {
    const v = slotOn(st, date);
    if (v && Number(v.day) === wd) {
      out.push({ id: 'p-' + st.id, studentId: st.id, time: v.time, len: Number(v.len), status: null, summary: '', note: '', tasks: [] });
    }
  }
  return out.sort(byTime);
}

export const byTime = (a, b) => toMin(a.time) - toMin(b.time);

export function getDay(state, date) {
  const rec = state.days[date];
  const lessons = rec && rec.lessons ? rec.lessons : plannedLessons(state, date);
  return {
    date,
    lessons: lessons.slice().sort(byTime),
    custom: !!(rec && rec.lessons),
    remark: rec?.remark || '',
    holiday: holidayOn(state, date),
  };
}

export function scheduledIds(state, date) {
  return new Set(getDay(state, date).lessons.map((l) => l.studentId).filter(Boolean));
}

// From here on, the day is its own record: changes to it never touch the regular schedule.
export function materialize(state, date) {
  if (!state.days[date]) state.days[date] = {};
  const rec = state.days[date];
  if (!rec.lessons) rec.lessons = clone(plannedLessons(state, date));
  return rec;
}

export function setDayLessons(state, date, lessons) {
  const rec = materialize(state, date);
  rec.lessons = lessons.map((l) => ({ ...l })).sort(byTime);
}

export function updateLesson(state, date, id, patch) {
  const rec = materialize(state, date);
  const l = rec.lessons.find((x) => x.id === id);
  if (!l) return null;
  Object.assign(l, patch);
  rec.lessons.sort(byTime);
  return l;
}

export function removeLessons(state, date, ids) {
  const rec = materialize(state, date);
  rec.lessons = rec.lessons.filter((l) => !ids.includes(l.id));
}

export function addLesson(state, date, lesson) {
  const rec = materialize(state, date);
  const l = { id: uid(), studentId: null, name: '', time: '14:00', len: 30, status: null, summary: '', note: '', tasks: [], ...lesson };
  rec.lessons.push(l);
  rec.lessons.sort(byTime);
  return l;
}

export function nextFreeTime(state, date, lessons) {
  const ls = lessons || getDay(state, date).lessons;
  if (!ls.length) return state.settings.dayStart;
  return fromMin(Math.max(...ls.map((l) => toMin(l.time) + Number(l.len))));
}

// Drag-to-reorder: lessons follow each other from the day's first start time, each with its own length.
export function repack(lessons, startTime) {
  let t = toMin(startTime ?? (lessons[0] && lessons[0].time) ?? '14:00');
  return lessons.map((l) => {
    const out = { ...l, time: fromMin(t) };
    t += Number(l.len);
    return out;
  });
}

export function lessonName(state, l) {
  if (l.studentId) {
    const st = studentById(state, l.studentId);
    if (st) return st.name;
  }
  return l.name || '—';
}

export function defaultLen(state, l, date) {
  const st = l.studentId && studentById(state, l.studentId);
  const v = st && (slotOn(st, date) || currentSlot(st, date));
  return v ? Number(v.len) : 30;
}

// ---------- from parsed text to a review of the day ----------

/**
 * Merge what was written with what the schedule already knows.
 * Returns rows for the confirmation screen; nothing is saved here.
 */
export function buildReview(state, parsedDay) {
  const date = parsedDay.date;
  const day = getDay(state, date);
  let rows = day.lessons.map((l) => ({ ...clone(l), mentioned: false, flags: {} }));

  if (parsedDay.plan) {
    // "היום: בנימין 14:00, צביקה 14:45" replaces the whole day.
    rows = parsedDay.items.map((it) => {
      const prev = rows.find((r) => it.studentId && r.studentId === it.studentId);
      const st = it.studentId && studentById(state, it.studentId);
      const slot = st && (slotOn(st, date) || currentSlot(st, date));
      return {
        id: prev ? prev.id : uid(),
        studentId: it.studentId,
        name: it.studentId ? '' : it.name,
        time: it.time || (slot && slot.time) || state.settings.dayStart,
        len: it.len || (slot && Number(slot.len)) || 30,
        status: prev ? prev.status : null,
        summary: prev ? prev.summary : '',
        note: prev ? prev.note : '',
        tasks: prev ? prev.tasks : [],
        mentioned: true,
        flags: { isNew: !it.studentId, planned: true },
      };
    });
    return { date, rows: rows.sort(byTime), remark: [day.remark, ...parsedDay.remarks].filter(Boolean).join(' · '), plan: true };
  }

  for (const it of parsedDay.items) {
    let row = it.studentId ? rows.find((r) => r.studentId === it.studentId && !r.mentioned) || rows.find((r) => r.studentId === it.studentId) : null;
    if (!row && !it.studentId) row = rows.find((r) => !r.studentId && r.name && norm(r.name) === norm(it.name));
    if (!row) {
      const st = it.studentId && studentById(state, it.studentId);
      const slot = st && (slotOn(st, date) || currentSlot(st, date));
      row = {
        id: uid(),
        studentId: it.studentId,
        name: it.studentId ? '' : it.name,
        time: it.time || (slot && slot.time) || nextFreeTime(state, date, rows),
        len: it.len || (slot && Number(slot.len)) || 30,
        status: null,
        summary: '',
        note: '',
        tasks: [],
        mentioned: false,
        flags: { extra: !!it.studentId, isNew: !it.studentId },
      };
      rows.push(row);
    }
    const prevTime = row.time;
    if (it.time && it.time !== row.time) {
      row.flags.timeChangedFrom = prevTime;
      row.time = it.time;
    }
    if (it.len) row.len = it.len;
    row.status = it.status === 'absent' ? null : it.status || row.status;
    if (it.status === 'absent') row.flags.askNotified = true;
    if (it.summary) row.summary = row.summary && row.mentioned ? `${row.summary}, ${it.summary}` : it.summary;
    if (it.tasks.length) row.tasks = [...(row.mentioned ? row.tasks : []), ...it.tasks.map((t) => ({ text: t, done: false }))];
    if (it.ambiguous) row.flags.ambiguous = it.alternatives;
    if (it.fuzzy) row.flags.fuzzy = it.name;
    row.mentioned = true;
  }

  for (const r of rows) {
    if (!r.mentioned && !r.status) {
      if (parsedDay.everyoneElseCame) r.status = 'came';
      else r.flags.unreported = true;
    }
  }
  return {
    date,
    rows: rows.sort(byTime),
    remark: [day.remark, ...parsedDay.remarks].filter(Boolean).join(' · '),
    plan: false,
  };
}

export function needsAttention(row) {
  return !!(row.flags && (row.flags.unreported || row.flags.askNotified || row.flags.isNew)) && !row.status;
}

// Save a confirmed review. Unknown names that the user approved become students.
export function applyReview(state, review) {
  const lessons = review.rows.map((r) => {
    const { mentioned, flags, ...l } = r;
    return { ...l, len: Number(l.len) };
  });
  const rec = materialize(state, review.date);
  rec.lessons = lessons.sort(byTime);
  if (review.remark != null) rec.remark = review.remark;
}

// ---------- tasks ----------

export function openTasks(state) {
  const out = [];
  for (const [date, rec] of Object.entries(state.days)) {
    for (const l of rec.lessons || []) {
      (l.tasks || []).forEach((t, i) => {
        if (!t.done) out.push({ date, lessonId: l.id, index: i, text: t.text, studentId: l.studentId, name: lessonName(state, l) });
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

// ---------- history & stats ----------

export function studentHistory(state, studentId) {
  const out = [];
  for (const [date, rec] of Object.entries(state.days)) {
    for (const l of rec.lessons || []) if (l.studentId === studentId) out.push({ date, ...l });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export function statusById(state, id) {
  return state.statuses.find((s) => s.id === id);
}

export function countsAsCame(state, statusId) {
  if (!statusId) return false;
  if (statusId === 'came') return true;
  const s = statusById(state, statusId);
  return !!(s && s.counts);
}

// Work days of the school year (plus any other day that has lessons).
export function yearDates(state, from, to) {
  const start = from || state.settings.yearStart;
  const end = to || state.settings.yearEnd;
  const wds = new Set(state.settings.workDays.map(Number));
  const out = new Set();
  for (let d = start; d <= end; d = addDays(d, 1)) if (wds.has(weekday(d))) out.add(d);
  for (const [d, rec] of Object.entries(state.days)) if (d >= start && d <= end && (rec.lessons?.length || rec.remark)) out.add(d);
  return [...out].sort();
}

export function hoursSummary(state, from, to) {
  const per = new Map();
  let total = 0;
  for (const d of yearDates(state, from, to)) {
    for (const l of getDay(state, d).lessons) {
      if (!countsAsCame(state, l.status)) continue;
      total += Number(l.len);
      const k = l.studentId || 'name:' + (l.name || '');
      const cur = per.get(k) || { name: lessonName(state, l), minutes: 0, lessons: 0 };
      cur.minutes += Number(l.len);
      cur.lessons += 1;
      per.set(k, cur);
    }
  }
  return { totalMinutes: total, perStudent: [...per.values()].sort((a, b) => b.minutes - a.minutes) };
}
