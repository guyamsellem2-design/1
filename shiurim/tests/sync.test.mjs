// Two devices editing the same data: nothing written on either one is lost.
// Run: node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { stampChanges, stampAll, mergeStates } from '../js/syncmerge.js';
import { clone } from '../js/util.js';

function edit(state, fn, now) {
  const prev = clone(state);
  fn(state);
  stampChanges(prev, state, now);
  return state;
}

function base() {
  const s = M.defaultState();
  M.addStudent(s, { name: 'שלמה', day: 2, time: '14:00', len: 30, from: '2026-09-01' });
  M.addStudent(s, { name: 'בנימין', day: 2, time: '14:30', len: 45, from: '2026-09-01' });
  return stampAll(s, 1000);
}

test('different days edited on each device are both kept', () => {
  const cloud = base();
  const phone = clone(cloud);
  const pc = clone(cloud);
  edit(phone, (s) => { M.materialize(s, '2026-10-13'); s.days['2026-10-13'].lessons[0].status = 'came'; }, 2000);
  edit(pc, (s) => { M.materialize(s, '2026-10-14'); s.days['2026-10-14'].remark = 'אסיפה'; }, 2100);
  const merged = mergeStates(pc, phone);
  assert.equal(merged.days['2026-10-13'].lessons[0].status, 'came');
  assert.equal(merged.days['2026-10-14'].remark, 'אסיפה');
});

test('the same day: the later edit wins, and a deleted day stays deleted', () => {
  const cloud = base();
  edit(cloud, (s) => { M.materialize(s, '2026-10-13'); }, 1500);
  const phone = clone(cloud);
  const pc = clone(cloud);
  edit(phone, (s) => { s.days['2026-10-13'].lessons[0].status = 'came'; }, 2000);
  edit(pc, (s) => { s.days['2026-10-13'].lessons[0].status = 'noshow'; }, 3000);
  assert.equal(mergeStates(phone, pc).days['2026-10-13'].lessons[0].status, 'noshow');
  assert.equal(mergeStates(pc, phone).days['2026-10-13'].lessons[0].status, 'noshow');
  edit(phone, (s) => { delete s.days['2026-10-13']; }, 4000);
  assert.ok(!('2026-10-13' in mergeStates(pc, phone).days));
});

test('settings travel as one block, newest wins', () => {
  const cloud = base();
  const phone = clone(cloud);
  const pc = clone(cloud);
  edit(phone, (s) => { s.teacher.name = 'גיא'; }, 2000);
  edit(pc, (s) => { s.students[0].phone = '050-1234567'; }, 2500);
  const m = mergeStates(pc, phone);
  assert.equal(m.teacher.name, 'גיא');
  assert.equal(m.students[0].phone, '050-1234567');
});

test('the same student typed on both devices before syncing becomes one', () => {
  const phone = M.defaultState();
  const a = M.addStudent(phone, { name: 'שלמה', day: 2, time: '14:00', len: 30, from: '2026-09-01' });
  M.materialize(phone, '2026-10-13');
  phone.days['2026-10-13'].lessons[0].status = 'came';
  stampAll(phone, 1000);
  const pc = M.defaultState();
  const b = M.addStudent(pc, { name: 'שלמה', day: 2, time: '14:00', len: 30, from: '2026-09-01' });
  stampAll(pc, 1200);
  const m = mergeStates(phone, pc);
  const names = m.students.filter((x) => x.name === 'שלמה');
  assert.equal(names.length, 1);
  assert.equal(names[0].id, b.id);
  assert.equal(m.days['2026-10-13'].lessons[0].studentId, b.id);
  assert.notEqual(a.id, b.id);
});
