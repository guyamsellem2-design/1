// Report a whole day in one sheet: one tap per lesson for attendance, a line for what we did.
// Opened from the table (tap a date) and the calendar (tap a day). Nothing is saved before "שמור".

import { escapeHtml as e, fmtDay, endTime, telHref, clone } from './util.js';
import * as M from './model.js';
import { el, openSheet, editLesson, pickStudent, toast } from './ui.js';

export function reportDay(app, date, { onSaved, extraAction } = {}) {
  const s = app.state;
  const day = M.getDay(s, date);
  const lessons = clone(day.lessons);
  let remark = day.remark;
  const before = JSON.stringify({ lessons, remark });

  const body = el(`<div>
    ${day.holiday ? `<div class="banner holiday">🎉 ${e(day.holiday)}</div>` : ''}
    <div data-list></div>
    <div class="row-actions" style="margin-top:4px">
      <button type="button" class="btn small" data-rest>כל השאר הגיעו</button>
      <button type="button" class="btn small ghost" data-add>+ שיעור</button>
    </div>
    <label class="field" style="margin-top:12px"><span>הארות ושינויים</span><input class="input" data-remark value="${e(remark)}" placeholder="יופיע בעמודה האחרונה בטבלה"></label>
  </div>`);
  const list = body.querySelector('[data-list]');

  const render = () => {
    list.innerHTML = lessons.length ? '' : `<p class="muted">${day.holiday ? 'יום חופש, אין שיעורים במערכת.' : 'אין שיעורים ביום הזה.'}</p>`;
    lessons.sort(M.byTime).forEach((l, i) => {
      const st = l.studentId && M.studentById(s, l.studentId);
      const tel = st && telHref(st.phone);
      const card = el(`<div class="report-card" data-i="${i}">
        <div class="report-head">
          <span class="t" dir="ltr">${e(l.time)}–${e(endTime(l.time, l.len))}</span>
          <button type="button" class="link-btn" data-edit><b>${e(M.lessonName(s, l))}</b>${st?.grade ? ` <span class="tag">${e(st.grade)}</span>` : ''}</button>
          <span class="grow"></span>
          ${tel ? `<a class="icon-btn" href="${e(tel)}" aria-label="להתקשר">📞</a>` : ''}
        </div>
        <div class="seg report-status">${s.statuses.map((x) => `<button type="button" data-status="${e(x.id)}" aria-pressed="${l.status === x.id}" style="${l.status === x.id ? `background:${e(x.bg)};color:${e(x.fg)};border-color:${e(x.bg)}` : ''}">${e(x.name)}</button>`).join('')}</div>
        <input class="input" data-summary value="${e(l.summary || '')}" placeholder="מה עשינו (לא חובה)" style="margin-top:8px;min-height:40px">
      </div>`);
      list.appendChild(card);
    });
  };
  render();

  list.addEventListener('click', (ev) => {
    const card = ev.target.closest('[data-i]');
    if (!card) return;
    const l = lessons[Number(card.dataset.i)];
    const b = ev.target.closest('button');
    if (b && b.dataset.status) {
      l.status = l.status === b.dataset.status ? null : b.dataset.status;
      render();
    } else if (b && b.dataset.edit != null) {
      editLesson(s, {
        date, lesson: l,
        onSave: (nl) => { Object.assign(l, nl); render(); },
        onDelete: () => { lessons.splice(lessons.indexOf(l), 1); render(); },
      });
    }
  });
  list.addEventListener('input', (ev) => {
    const card = ev.target.closest('[data-i]');
    if (card && ev.target.dataset.summary != null) lessons[Number(card.dataset.i)].summary = ev.target.value;
  });
  body.querySelector('[data-remark]').addEventListener('input', (ev) => { remark = ev.target.value; });
  body.querySelector('[data-rest]').addEventListener('click', () => {
    lessons.forEach((l) => { if (!l.status) l.status = 'came'; });
    render();
  });
  body.querySelector('[data-add]').addEventListener('click', () => pickStudent(s, {
    date, exclude: lessons.map((l) => l.studentId).filter(Boolean), allowNew: true,
    onPick: ({ studentId, newName }) => {
      const st = studentId && M.studentById(s, studentId);
      const slot = st && (M.slotOn(st, date) || M.currentSlot(st, date));
      lessons.push({ id: 'n' + Date.now().toString(36), studentId: studentId || null, name: newName || '', time: M.nextFreeTime(s, date, lessons), len: slot ? Number(slot.len) : 30, status: 'came', summary: '', note: '', tasks: [] });
      render();
    },
  }));

  const actions = [{
    label: 'שמור', cls: 'primary', grow: true, onClick: (close) => {
      lessons.forEach((l) => { l.summary = (l.summary || '').trim(); });
      remark = remark.trim();
      if (JSON.stringify({ lessons, remark }) !== before) {
        if (JSON.stringify(lessons) !== JSON.stringify(day.lessons)) M.setDayLessons(s, date, lessons);
        s.days[date] = { ...(s.days[date] || {}), remark };
        app.save();
        toast('נשמר ✓');
      }
      close();
      onSaved && onSaved();
    },
  }];
  if (extraAction) actions.push({ label: extraAction.label, cls: 'ghost', onClick: (close) => { close(); extraAction.onClick(); } });
  actions.push({ label: 'ביטול', cls: 'ghost' });
  return openSheet({ title: `דיווח · ${fmtDay(date)}`, body, actions });
}
