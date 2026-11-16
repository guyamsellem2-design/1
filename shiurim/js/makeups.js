// Make-up lessons: a lesson cancelled by a trip / school constraint announced in advance is made up later.
// Here: the list of what still waits for a make-up, and a sheet to set its date (or mark it already made up).

import { escapeHtml as e, fmtDay, fmtDate, todayISO, addDays } from './util.js';
import * as M from './model.js';
import { el, openSheet, toast, callLinks } from './ui.js';

const whenText = (w) => `${fmtDay(w.date)} ב-${w.time}`;

// The short line shown on the cancelled lesson: "להשלמה" / "השלמה נקבעה ל…" / "הושלם ✓".
export function makeupLabel(info) {
  if (!info) return '';
  if (info.state === 'done') return info.when ? `הושלם ✓ (${fmtDate(info.when.date)})` : 'הושלם ✓';
  if (info.state === 'scheduled') return info.missed ? `ההשלמה ב-${fmtDate(info.when.date)} לא התקיימה` : `השלמה נקבעה ל${whenText(info.when)}`;
  return 'עוד לא נקבעה השלמה';
}

export function openMakeup(app, date, lessonId, { onDone } = {}) {
  const s = app.state;
  const l = (s.days[date]?.lessons || []).find((x) => x.id === lessonId);
  if (!l) return null;
  const st = l.studentId && M.studentById(s, l.studentId);
  const info = M.makeupInfo(s, date, l) || { state: 'open' };
  const slot = st && M.currentSlot(st, todayISO());
  const defDate = info.when?.date || (todayISO() > date ? todayISO() : addDays(date, 1));
  const defTime = info.when?.time || slot?.time || l.time;
  const body = el(`<div>
    <p class="muted" style="margin:-6px 0 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="grow">השיעור של ${e(fmtDay(date))} ב-${e(l.time)} בוטל (טיול / אילוץ מערכת, הודיעו מראש).</span>${callLinks(st)}</p>
    <div class="banner" style="margin:0 0 12px">${e(makeupLabel(info))}</div>
    <div class="two">
      <label class="field"><span>תאריך ההשלמה</span><input class="input" type="date" name="date" value="${e(defDate)}"></label>
      <label class="field"><span>שעה</span><input class="input" type="time" step="300" name="time" value="${e(defTime)}" dir="ltr"></label>
    </div>
    <p class="hint" style="margin:0">שיעור ההשלמה נכנס ליום שבחרת כשיעור רגיל (${Number(l.len)} דק׳), ונספר בשעות של אותו יום. כשמדווחים עליו "הגיע", השיעור הזה מסומן כהושלם.</p>
  </div>`);
  const $ = (q) => body.querySelector(q);
  const done = (msg) => { app.save(); toast(msg); onDone && onDone(); };
  const actions = [{
    label: info.state === 'scheduled' ? 'שנה מועד' : 'קבע מועד', cls: 'primary', grow: true, onClick: (close) => {
      const d = $('[name=date]').value;
      const t = $('[name=time]').value;
      if (!d || !t) { toast('צריך תאריך ושעה'); return; }
      M.scheduleMakeup(s, date, lessonId, { date: d, time: t, len: l.len });
      close();
      done(`ההשלמה נקבעה ל${fmtDay(d)} ב-${t} ✓`);
    },
  }];
  if (info.state === 'done' && info.manual) {
    actions.push({ label: 'עוד לא הושלם', cls: '', onClick: (close) => { M.setMakeupDone(s, date, lessonId, false); close(); done('סומן שעוד לא הושלם'); } });
  } else if (info.state !== 'done') {
    actions.push({ label: '✓ כבר הושלם', cls: '', onClick: (close) => { M.setMakeupDone(s, date, lessonId, true); close(); done('סומן שהושלם ✓'); } });
  }
  if (info.state === 'scheduled') {
    actions.push({ label: 'בטל מועד', cls: 'ghost danger', onClick: (close) => { M.cancelMakeup(s, date, lessonId); close(); done('המועד בוטל, השיעור חזר לרשימת ההשלמות'); } });
  }
  actions.push({ label: 'סגור', cls: 'ghost' });
  return openSheet({ title: `📅 השלמה · ${M.lessonName(s, l)}`, body, actions });
}

// The home page box: lessons waiting to be made up, oldest first.
export function makeupBox(app, render) {
  const list = M.openMakeups(app.state);
  if (!list.length) return null;
  const box = el(`<div><div class="section-title"><span class="grow">📅 שיעורים להשלמה</span><span class="hint" style="font-weight:400">${list.length}</span></div><ul class="list card"></ul></div>`);
  for (const { date, l, info } of list.slice(0, 15)) {
    const li = el(`<li class="tap"><span class="grow"><b>${e(M.lessonName(app.state, l))}</b><br><span class="hint">בוטל ${e(fmtDay(date))}</span></span>
      <span class="tag ${info.state === 'scheduled' && !info.missed ? 'mk-set' : 'mk-open'}">${info.state === 'scheduled' && !info.missed ? `נקבע: ${e(fmtDate(info.when.date))} ${e(info.when.time)}` : info.missed ? 'לא התקיים' : 'לקבוע מועד'}</span><span>‹</span></li>`);
    li.addEventListener('click', () => openMakeup(app, date, l.id, { onDone: render }));
    box.querySelector('ul').appendChild(li);
  }
  return box;
}
