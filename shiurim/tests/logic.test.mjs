// Acceptance tests from the spec (section 9) for the text parser and the day logic.
// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReport } from '../js/parser.js';
import * as M from '../js/model.js';

const TUE = '2026-10-13'; // a Tuesday
function setup() {
  const s = M.defaultState();
  s.settings.yearStart = '2026-09-01';
  const add = (name, time, len) => M.addStudent(s, { name, day: 2, time, len, from: '2026-09-01' });
  const ids = {
    shlomo: add('שלמה', '14:00', 30).id,
    binyamin: add('בנימין', '14:30', 45).id,
    yosef: add('יוסף', '15:15', 30).id,
    david: add('דוד', '15:45', 60).id,
  };
  return { s, ids };
}
function review(s, text, today = TUE) {
  const parsed = parseReport(text, {
    today, students: s.students, dayStart: s.settings.dayStart, dayEnd: s.settings.dayEnd,
    scheduledOn: (d) => M.scheduledIds(s, d),
  });
  return parsed.days.map((d) => M.buildReview(s, d));
}
const row = (rv, id) => rv.rows.find((r) => r.studentId === id);

test('1: short writing without times', () => {
  const { s, ids } = setup();
  const [rv] = review(s, 'שלישי\nשלמה לא הגיע\nבנימין - פינגרסטייל, אני צריך להתאמן על זה לשיעור הבא\nיוסף הגיע');
  assert.equal(rv.date, TUE);
  const sh = row(rv, ids.shlomo);
  assert.equal(sh.time, '14:00'); assert.equal(sh.status, null); assert.ok(sh.flags.askNotified);
  const b = row(rv, ids.binyamin);
  assert.equal(b.time, '14:30'); assert.equal(b.len, 45); assert.equal(b.status, 'came');
  assert.equal(b.summary, 'פינגרסטייל');
  assert.deepEqual(b.tasks.map((t) => t.text), ['להתאמן על פינגרסטייל']);
  const y = row(rv, ids.yosef);
  assert.equal(y.time, '15:15'); assert.equal(y.status, 'came');
  const d = row(rv, ids.david);
  assert.equal(d.time, '15:45'); assert.equal(d.status, null); assert.ok(d.flags.unreported);
  M.applyReview(s, rv);
  assert.equal(M.studentHistory(s, ids.binyamin)[0].summary, 'פינגרסטייל');
});

test('2: the original note with ranges sets a one-time length', () => {
  const { s, ids } = setup();
  const [rv] = review(s, 'יום שלישי -\n14-14:30 - שלמה לא הגיע\n14:30-15 - בנימין הגיע - עבדנו על פינגרסטייל, אני צריך לשבת להתאמן על זה כדי להביא לו את זה מוכן לשיעור הבא');
  const b = row(rv, ids.binyamin);
  assert.equal(b.time, '14:30'); assert.equal(b.len, 30); assert.equal(b.status, 'came');
  assert.equal(b.summary, 'עבדנו על פינגרסטייל');
  M.applyReview(s, rv);
  const next = M.getDay(s, '2026-10-20').lessons.find((l) => l.studentId === ids.binyamin);
  assert.equal(next.len, 45);
});

test('6: a different time in writing applies to that day only', () => {
  const { s, ids } = setup();
  const [rv] = review(s, 'יוסף הגיע ב-15:30 במקום 15:15');
  const y = row(rv, ids.yosef);
  assert.equal(y.time, '15:30'); assert.equal(y.len, 30); assert.equal(y.flags.timeChangedFrom, '15:15');
  M.applyReview(s, rv);
  assert.equal(M.getDay(s, '2026-10-20').lessons.find((l) => l.studentId === ids.yosef).time, '15:15');
});

test('5: arranging one day leaves the regular schedule alone', () => {
  const { s, ids } = setup();
  let ls = M.getDay(s, TUE).lessons;
  const david = ls.find((l) => l.studentId === ids.david);
  ls = [david, ...ls.filter((l) => l !== david)];
  M.setDayLessons(s, TUE, M.repack(ls, '14:00'));
  M.removeLessons(s, TUE, M.getDay(s, TUE).lessons.filter((l) => [ids.shlomo, ids.yosef].includes(l.studentId)).map((l) => l.id));
  const z = M.addStudent(s, { name: 'צביקה', from: TUE });
  M.addLesson(s, TUE, { studentId: z.id, time: M.nextFreeTime(s, TUE), len: 30 });
  const day = M.getDay(s, TUE).lessons;
  assert.deepEqual(day.map((l) => [M.lessonName(s, l), l.time]), [['דוד', '14:00'], ['בנימין', '15:30'], ['צביקה', '16:15']]);
  // "סגור רווחים" packs the rest right after David.
  M.setDayLessons(s, TUE, M.repack(M.getDay(s, TUE).lessons));
  assert.deepEqual(M.getDay(s, TUE).lessons.map((l) => l.time), ['14:00', '15:00', '15:45']);
  assert.equal(M.getDay(s, '2026-10-20').lessons.length, 4);
});

test('multi-day note, plan mode, everyone else, statuses', () => {
  const { s, ids } = setup();
  const rvs = review(s, 'שני: שלמה לא הגיע והודיע / שלישי: בנימין הבריז\nכל השאר הגיעו');
  assert.equal(rvs.length, 2);
  const [, tue] = rvs;
  assert.equal(row(tue, ids.binyamin).status, 'noshow');
  assert.equal(row(tue, ids.david).status, 'came');
  const [plan] = review(s, 'היום: בנימין 14:00, צביקה 14:45, שלמה 15:30');
  assert.ok(plan.plan);
  assert.deepEqual(plan.rows.map((r) => [r.studentId ? M.lessonName(s, r) : r.name, r.time]), [['בנימין', '14:00'], ['צביקה', '14:45'], ['שלמה', '15:30']]);
  const [trip] = review(s, 'שלמה, יוסף ודוד לא הגיעו - טיול');
  for (const id of [ids.shlomo, ids.yosef, ids.david]) assert.equal(row(trip, id).status, 'trip');
  const [nick] = review(s, 'בני - אקורדים\nיוסף התקשר וביטל\nדוד נעלם');
  assert.equal(row(nick, ids.binyamin).status, 'came');
  assert.equal(row(nick, ids.yosef).status, 'notified');
  assert.equal(row(nick, ids.david).status, 'noshow');
});

test('holidays hide the regular lessons', () => {
  const { s } = setup();
  assert.equal(M.getDay(s, '2026-12-08').holiday, 'חנוכה');
  assert.equal(M.getDay(s, '2026-12-08').lessons.length, 0);
});

test('schedule change applies from a date onwards only', () => {
  const { s, ids } = setup();
  const st = M.studentById(s, ids.shlomo);
  M.setSlot(st, { day: 3, time: '16:00', len: 45 }, '2026-11-01');
  assert.ok(M.getDay(s, TUE).lessons.some((l) => l.studentId === ids.shlomo));
  assert.ok(!M.getDay(s, '2026-11-03').lessons.some((l) => l.studentId === ids.shlomo));
  assert.equal(M.getDay(s, '2026-11-04').lessons.find((l) => l.studentId === ids.shlomo).len, 45);
});
