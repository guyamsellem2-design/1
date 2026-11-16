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

test('a student added later shows up on days already opened, unless taken off that day', () => {
  const { s, ids } = setup();
  M.updateLesson(s, TUE, 'p-' + ids.shlomo, { status: 'came' }); // the day is now its own record
  const z = M.addStudent(s, { name: 'צביקה', day: 2, time: '16:45', len: 30, from: '2026-09-01' });
  z.createdOn = TUE;
  assert.ok(M.getDay(s, TUE).lessons.some((l) => l.studentId === z.id));
  assert.ok(M.updateLesson(s, TUE, 'p-' + z.id, { status: 'notified' }));
  M.removeLessons(s, TUE, [M.getDay(s, TUE).lessons.find((l) => l.studentId === ids.david).id]);
  assert.ok(!M.getDay(s, TUE).lessons.some((l) => l.studentId === ids.david));
  // a day reported before the student existed is not changed after the fact
  M.updateLesson(s, '2026-10-06', 'p-' + ids.shlomo, { status: 'came' });
  const y = M.addStudent(s, { name: 'אליה', day: 2, time: '17:15', len: 30, from: '2026-09-01' });
  y.createdOn = TUE;
  assert.ok(!M.getDay(s, '2026-10-06').lessons.some((l) => l.studentId === y.id));
  assert.ok(M.getDay(s, '2026-10-20').lessons.some((l) => l.studentId === y.id));
});

test('lessons sit at each student\'s regular time unless changed by hand for that day', () => {
  const { s, ids } = setup();
  // Added together: each at his own time, not one after the other.
  const extra = M.newLessonsFor(s, '2026-10-14', [ids.david, ids.shlomo], []);
  assert.deepEqual(extra.map((l) => [l.time, l.len]), [['15:45', 60], ['14:00', 30]]);
  // Old data placed one after the other is shown at the regular times.
  s.days['2026-10-14'] = { lessons: [{ id: 'a', studentId: ids.david, time: '14:00', len: 60, status: null }, { id: 'b', studentId: ids.shlomo, time: '15:00', len: 30, status: null }] };
  assert.deepEqual(M.getDay(s, '2026-10-14').lessons.map((l) => l.time), ['14:00', '15:45']);
  // A time changed by hand stays.
  M.updateLesson(s, '2026-10-14', 'b', { time: '17:00', timeSet: true });
  assert.equal(M.getDay(s, '2026-10-14').lessons.find((l) => l.id === 'b').time, '17:00');
  // A change in the students list moves the lessons that were not moved by hand.
  M.setSlot(M.studentById(s, ids.david), { day: 2, time: '16:00', len: 45 }, '2026-10-01');
  const d = M.getDay(s, '2026-10-14').lessons.find((l) => l.id === 'a');
  assert.deepEqual([d.time, d.len], ['16:00', 45]);
});

test('month summary per frame, holidays and lessons that happened anyway, cancelling a day', () => {
  const { s, ids } = setup();
  const p = M.addStudent(s, { name: 'אריאל', frame: 'private', day: 2, time: '17:00', len: 60, from: '2026-09-01' });
  M.updateLesson(s, TUE, 'p-' + ids.shlomo, { status: 'came' });
  M.updateLesson(s, TUE, 'p-' + ids.binyamin, { status: 'noshow' });
  M.updateLesson(s, TUE, 'p-' + ids.yosef, { status: 'trip' });
  M.updateLesson(s, TUE, 'p-' + p.id, { status: 'came' });
  // Hanukkah Tuesday: nothing planned, but the private lesson happened anyway.
  const HOL = '2026-12-08';
  assert.equal(M.getDay(s, HOL).lessons.length, 0);
  assert.deepEqual(M.regularOn(s, HOL), [ids.shlomo, ids.binyamin, ids.yosef, ids.david, p.id]);
  M.setDayLessons(s, HOL, [{ ...M.newLessonFor(s, HOL, p.id, []), status: 'came' }]);
  const oct = M.frameSummary(s, '2026-10-01', '2026-10-31');
  const yes = oct.find((r) => r.frame.id === 'yeshiva');
  assert.deepEqual([yes.came, yes.cameMin, yes.absent, yes.absentMin], [1, 30, 1, 45]);
  assert.equal(yes.sys, 1, 'a trip nobody announced counts as work hours, on its own line');
  assert.equal(yes.total, yes.came + yes.absent + yes.sys);
  assert.equal(yes.totalMin, yes.cameMin + yes.absentMin + yes.sysMin);
  assert.ok(yes.open > 0 && yes.open === yes.openPast + yes.openAhead); // unreported lessons are counted apart
  const dec = M.frameSummary(s, '2026-12-01', '2026-12-31').find((r) => r.frame.id === 'private');
  assert.ok(dec.came >= 1 && dec.cameMin >= 60);
  // Cancelling a day: no lessons, marked in the holidays column.
  M.cancelDay(s, '2026-10-20');
  assert.equal(M.getDay(s, '2026-10-20').lessons.length, 0);
  assert.equal(M.getDay(s, '2026-10-20').holiday, 'בוטל');
});

test('an activity without a student counts as work hours, in its frame', () => {
  const { s, ids } = setup();
  M.updateLesson(s, TUE, 'p-' + ids.shlomo, { status: 'came' });
  const a = M.newActivity({ name: 'הנחיית הרכב', time: '17:00', len: 60, frame: 'yeshiva' });
  M.setDayLessons(s, TUE, [...M.getDay(s, TUE).lessons, a]);
  const day = M.getDay(s, TUE);
  assert.ok(day.lessons.some((l) => l.activity && l.name === 'הנחיית הרכב'));
  assert.equal(M.statusById(s, 'activity').name, 'פעילות');
  const r = M.frameSummary(s, '2026-10-01', '2026-10-31', '2026-10-31').find((x) => x.frame.id === 'yeshiva');
  assert.deepEqual([r.act, r.actMin], [1, 60]);
  assert.equal(r.totalMin, r.cameMin + r.absentMin + r.actMin + r.sysMin);
  assert.equal(M.lessonFrame(s, a), 'yeshiva');
});

test('payments: only per-lesson frames, owed when it happened, "שילם" in writing, old data migrates', () => {
  const { s, ids } = setup();
  const priv = M.studentById(s, ids.david);
  priv.frame = 'private';
  priv.price = 150;
  const shlomo = M.studentById(s, ids.shlomo); // yeshiva: never asked about payment
  const [rv] = review(s, 'שלמה הגיע\nדוד - עבדנו על אקורדים, לא שילם\nיוסף לא הגיע');
  assert.equal(row(rv, ids.david).paid, false);
  assert.equal(row(rv, ids.shlomo).paid, undefined);
  M.applyReview(s, rv);
  assert.equal(M.paysPerLesson(s, M.getDay(s, TUE).lessons.find((l) => l.studentId === shlomo.id)), false);
  let u = M.unpaidByStudent(s, TUE);
  assert.equal(u.length, 1);
  assert.equal(u[0].student.id, ids.david);
  assert.equal(u[0].amount, 150);

  // A week later he pays, written in the report.
  const next = '2026-10-20';
  const [rv2] = review(s, 'דוד הגיע ושילם', next);
  assert.equal(row(rv2, ids.david).paid, true);
  M.applyReview(s, rv2);
  u = M.unpaidByStudent(s, next);
  assert.equal(u[0].count, 1, 'the earlier lesson is still open');
  const p = M.paymentSummary(s, 'private', '2026-10-01', '2026-10-31', next);
  assert.deepEqual([p.paid, p.unpaid, p.amountPaid, p.amountUnpaid], [1, 1, 150, 150]);

  // Marked paid from the payments list.
  M.setPaid(s, TUE, u[0].lessons[0].id, true, next);
  assert.equal(M.unpaidByStudent(s, next).length, 0);

  // A private student who didn't come owes nothing.
  const [rv3] = review(s, 'דוד לא הגיע והודיע', '2026-10-27');
  M.applyReview(s, rv3);
  assert.equal(M.unpaidByStudent(s, '2026-10-27').length, 0);

  // Data from before this feature: the private frame becomes per-lesson, the yeshiva doesn't.
  const old = M.migrate({ frames: [{ id: 'yeshiva', name: 'ישיבה' }, { id: 'private', name: 'פרטי' }] });
  assert.equal(M.perLessonFrame(old, 'private'), true);
  assert.equal(M.perLessonFrame(old, 'yeshiva'), false);
  const turnedOff = M.migrate({ ...old, frames: [{ id: 'private', name: 'פרטי', perLesson: false }] });
  assert.equal(M.perLessonFrame(turnedOff, 'private'), false, 'a choice made in settings stays');
});

test('payments: "שילמה על אוקטובר" pays that month, without making up a lesson today', () => {
  const { s, ids } = setup();
  const tamar = M.addStudent(s, { name: 'תמר', frame: 'private', day: 2, time: '17:00', len: 45, from: '2026-09-01' });
  tamar.price = 120;
  for (const d of ['2026-10-06', '2026-10-13', '2026-10-20', '2026-11-03', '2026-11-10']) {
    M.setDayLessons(s, d, M.getDay(s, d).lessons.map((l) => ({ ...l, status: 'came' })));
  }
  assert.equal(M.unpaidByStudent(s, '2026-11-16').find((u) => u.student.id === tamar.id).count, 5);

  const today = '2026-11-16'; // a Monday, no lessons for her
  const [rv] = review(s, 'תמר שילמה על אוקטובר', today);
  assert.deepEqual(rv.payments, [{ studentId: tamar.id, ym: '2026-10' }]);
  assert.ok(!rv.rows.some((r) => r.studentId === tamar.id), 'no lesson invented for today');
  M.applyReview(s, rv);
  const u = M.unpaidByStudent(s, today).find((x) => x.student.id === tamar.id);
  assert.equal(u.count, 2, 'November is still open');
  assert.equal(u.amount, 240);
  assert.ok(u.lessons.every((l) => l.date.startsWith('2026-11')));

  // In the same line as a lesson: the lesson is reported, and the month paid.
  const [rv2] = review(s, 'תמר הגיעה, שילמה לנובמבר', '2026-11-17');
  assert.equal(row(rv2, tamar.id).status, 'came');
  assert.deepEqual(rv2.payments, [{ studentId: tamar.id, ym: '2026-11' }]);

  assert.equal(M.paidMonthKey('2027-01-05', 12), '2026-12');
  assert.equal(M.paidMonthKey('2026-10-25', 11), '2026-11', 'paid in advance');
  assert.equal(M.paidMonthKey('2026-12-28', 1), '2027-01');
});

test('trips: announced in advance (not counted, to make up) vs not announced (counted)', () => {
  const { s, ids } = setup();
  const [rv] = review(s, 'שלמה ויוסף לא הגיעו - טיול, לא הודיעו לי מראש\nבנימין - טיול, הודיעו מראש\nדוד לא הגיע, טיול');
  assert.equal(row(rv, ids.shlomo).status, 'trip');
  assert.equal(row(rv, ids.yosef).status, 'trip');
  assert.equal(row(rv, ids.binyamin).status, 'tripNotice');
  assert.equal(row(rv, ids.david).status, 'trip', 'a trip reported on the day is one nobody announced');
  M.applyReview(s, rv);
  const [yes] = M.frameSummary(s, TUE, TUE, TUE);
  assert.equal(yes.sys, 3);
  assert.equal(yes.pre, 1);
  assert.equal(yes.total, 3, 'the announced one is left out');
  assert.equal(yes.totalMin, 30 + 30 + 60);

  // Data from before: the old trip status is renamed (when untouched) and the new one is added after it.
  const old = M.migrate({ statuses: [
    { id: 'came', name: 'הגיע', bg: '#11734B', fg: '#D4EDBC', counts: true },
    { id: 'trip', name: 'טיול ישיבתי / אילוצי מערכת', bg: '#753800', fg: '#FFC8AA' },
    { id: 'x1', name: 'שלי', bg: '#000', fg: '#fff' },
  ] });
  assert.deepEqual(old.statuses.map((x) => x.id), ['came', 'trip', 'tripNotice', 'x1']);
  assert.equal(old.statuses[1].name, 'טיול / אילוץ מערכת – לא הודיעו מראש');
  const again = M.migrate({ ...old, statuses: old.statuses.filter((x) => x.id !== 'tripNotice') });
  assert.ok(!again.statuses.some((x) => x.id === 'tripNotice'), 'deleting it in settings stays deleted');
});

test('make-ups: a trip announced in advance waits for a make-up date; reporting the make-up closes it', () => {
  const { s, ids } = setup();
  const [rv] = review(s, 'בנימין - טיול, הודיעו מראש');
  M.applyReview(s, rv);
  const orig = M.getDay(s, TUE).lessons.find((l) => l.studentId === ids.binyamin);
  assert.equal(orig.status, 'tripNotice');
  assert.deepEqual(M.openMakeups(s).map((x) => [x.date, x.info.state]), [[TUE, 'open']]);

  // Set a date: a real lesson on that day, at that time, counted there.
  const THU = '2026-10-15';
  const m = M.scheduleMakeup(s, TUE, orig.id, { date: THU, time: '16:00', len: 45 });
  assert.equal(M.getDay(s, THU).lessons.find((l) => l.id === m.id).time, '16:00', 'stays at the chosen time');
  assert.equal(M.openMakeups(s)[0].info.state, 'scheduled');

  // Moving it replaces the earlier make-up (no duplicates).
  const FRI = '2026-10-16';
  const m2 = M.scheduleMakeup(s, TUE, orig.id, { date: FRI, time: '10:00', len: 45 });
  assert.ok(!M.getDay(s, THU).lessons.some((l) => l.makeupFor), 'the old date is cleared');
  assert.equal(M.getDay(s, FRI).lessons.filter((l) => l.makeupFor).length, 1);

  // Reported as "came" → made up, gone from the list; the hours count on the make-up day.
  M.updateLesson(s, FRI, m2.id, { status: 'came' });
  assert.equal(M.openMakeups(s).length, 0);
  const [sum] = M.frameSummary(s, '2026-10-01', '2026-10-31', '2026-10-31');
  assert.equal(sum.pre, 1);
  assert.equal(sum.preDone, 1);

  // An editor that saved the original without its link still finds the make-up by the back-link.
  delete M.getDay(s, TUE).lessons.find((l) => l.id === orig.id).makeup;
  assert.equal(M.makeupInfo(s, TUE, M.getDay(s, TUE).lessons.find((l) => l.id === orig.id)).state, 'done');

  // Marked by hand / cancelled.
  M.cancelMakeup(s, TUE, orig.id);
  assert.ok(!M.getDay(s, FRI).lessons.some((l) => l.makeupFor));
  assert.equal(M.openMakeups(s).length, 1);
  M.setMakeupDone(s, TUE, orig.id, true);
  assert.equal(M.openMakeups(s).length, 0);
});
