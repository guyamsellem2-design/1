// Calendar: week (lessons as blocks by time and length) and month (a quick look).
// Dragging a block changes its time for that day only.

import { escapeHtml as e, toMin, fromMin, todayISO, addDays, weekday, fmtDate, fromISO, toISO, DAY_NAMES } from './util.js';
import * as M from './model.js';
import { el, editLesson, toast, pickStudent } from './ui.js';
import { reportDay } from './report.js';
import { getPref, setPref } from './store.js';

const PPM = 1.15; // pixels per minute
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

export function renderCalendar(app, root) {
  const s = app.state;
  const mode = app.params.mode || getPref('calMode', 'week');
  const anchor = app.params.date || todayISO();
  const head = el(`<div>
    <div class="seg" style="justify-content:center;margin-bottom:10px">
      <button data-mode="week" aria-pressed="${mode === 'week'}">שבוע</button>
      <button data-mode="month" aria-pressed="${mode === 'month'}">חודש</button>
    </div>
    <div class="cal-head">
      <button class="icon-btn" data-step="-1" aria-label="הקודם">›</button>
      <div class="title"></div>
      <button class="btn small ghost" data-today>היום</button>
      <button class="icon-btn" data-step="1" aria-label="הבא">‹</button>
    </div>
    <div data-body></div>
  </div>`);
  root.appendChild(head);
  head.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { setPref('calMode', b.dataset.mode); app.go('calendar', { mode: b.dataset.mode, date: anchor }); }));
  head.querySelector('[data-today]').addEventListener('click', () => app.go('calendar', { mode, date: todayISO() }));
  head.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const dir = Number(b.dataset.step);
    let d;
    if (mode === 'week') d = addDays(anchor, 7 * dir);
    else { const x = fromISO(anchor); d = toISO(new Date(x.getFullYear(), x.getMonth() + dir, 1)); }
    app.go('calendar', { mode, date: d });
  }));
  const bodyEl = head.querySelector('[data-body]');
  if (mode === 'month') renderMonth(app, bodyEl, anchor, head.querySelector('.title'));
  else renderWeek(app, bodyEl, anchor, head.querySelector('.title'));
}

function renderWeek(app, root, anchor, titleEl) {
  const s = app.state;
  const sunday = addDays(anchor, -weekday(anchor));
  const wds = s.settings.workDays.map(Number).sort();
  const dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(sunday, i)).filter((d) => wds.includes(weekday(d)) || s.days[d]?.lessons?.length);
  titleEl.textContent = `${fmtDate(dates[0] || sunday)} – ${fmtDate(dates[dates.length - 1] || addDays(sunday, 6))}`;
  let start = toMin(s.settings.dayStart);
  let end = toMin(s.settings.dayEnd);
  for (const d of dates) for (const l of M.getDay(s, d).lessons) { start = Math.min(start, toMin(l.time)); end = Math.max(end, toMin(l.time) + Number(l.len)); }
  start = Math.floor(start / 30) * 30;
  end = Math.ceil(end / 30) * 30;
  const height = (end - start) * PPM;
  const today = todayISO();
  const grid = el(`<div class="week" style="grid-template-columns:repeat(${dates.length || 1}, minmax(0,1fr))"></div>`);
  for (const d of dates) {
    const day = M.getDay(s, d);
    const col = el(`<div class="col"><h4 class="${d === today ? 'today' : ''}" role="button" title="דיווח על כל היום">${e(DAY_NAMES[weekday(d)])} ${e(fmtDate(d))}<span class="pen">✎</span></h4><div class="lane" style="height:${height}px"></div></div>`);
    const lane = col.querySelector('.lane');
    col.querySelector('h4').addEventListener('click', () => reportDay(app, d, { onSaved: () => app.render() }));
    // Tap an empty spot: a lesson at that time, this day only.
    lane.addEventListener('click', (ev) => {
      if (ev.target.closest('.blk')) return;
      const y = ev.clientY - lane.getBoundingClientRect().top;
      const t = fromMin(start + Math.floor(y / PPM / 15) * 15);
      pickStudent(s, {
        date: d, title: `שיעור ב-${t}`, exclude: day.lessons.map((l) => l.studentId).filter(Boolean),
        onPick: ({ studentId, newName }) => {
          const st = studentId && M.studentById(s, studentId);
          const slot = st && (M.slotOn(st, d) || M.currentSlot(st, d));
          const l = M.addLesson(s, d, { studentId: studentId || null, name: newName || '', time: t, len: slot ? Number(slot.len) : 30 });
          app.save();
          app.render();
          editLesson(s, { date: d, lesson: l, title: 'שיעור נוסף ליום הזה', onSave: (nl) => { M.updateLesson(s, d, l.id, nl); app.save(); app.render(); }, onDelete: () => { M.removeLessons(s, d, [l.id]); app.save(); app.render(); } });
        },
      });
    });
    for (let t = start; t < end; t += 30) lane.insertAdjacentHTML('beforeend', `<div class="hr" style="top:${(t - start) * PPM}px">${t % 60 === 0 ? fromMin(t) : ''}</div>`);
    if (day.holiday && !day.lessons.length) lane.insertAdjacentHTML('beforeend', `<div class="hol">${e(day.holiday)}</div>`);
    for (const l of day.lessons) {
      const st = l.status && M.statusById(s, l.status);
      const blk = el(`<div class="blk ${st ? '' : 'plain'}" data-id="${e(l.id)}" style="top:${(toMin(l.time) - start) * PPM}px;height:${Math.max(18, Number(l.len) * PPM - 2)}px;${st ? `background:${e(st.bg)};color:${e(st.fg)}` : ''}">
        <b>${e(M.lessonName(s, l))}</b><span dir="ltr">${e(l.time)}</span>${st && Number(l.len) >= 40 ? `<div>${e(st.name)}</div>` : ''}</div>`);
      lane.appendChild(blk);
      enableBlockDrag(blk, {
        onTap: () => editLesson(s, { date: d, lesson: l, onSave: (nl) => { M.updateLesson(s, d, l.id, nl); app.save(); app.render(); }, onDelete: () => { M.removeLessons(s, d, [l.id]); app.save(); app.render(); } }),
        onDrop: (dyPx) => {
          const delta = Math.round(dyPx / PPM / 15) * 15;
          if (!delta) { app.render(); return; }
          const nt = fromMin(Math.max(0, toMin(l.time) + delta));
          M.updateLesson(s, d, l.id, { time: nt });
          app.save();
          toast(`${M.lessonName(s, l)}: ${nt} (רק ביום הזה)`);
          app.render();
        },
        snap: (dyPx) => Math.round(dyPx / PPM / 15) * 15 * PPM,
      });
    }
    grid.appendChild(col);
  }
  if (!dates.length) grid.appendChild(el('<p class="muted">אין ימי עבודה בשבוע הזה.</p>'));
  root.appendChild(grid);
  root.appendChild(el(`<p class="hint" style="margin:10px 4px">לדיווח: לוחצים על <b>שם היום</b> כדי לסמן את כל היום, או על <b>שיעור</b> כדי לפתוח אותו. מקום ריק = הוספת שיעור. גרירה למעלה/למטה משנה שעה ליום הזה בלבד.</p>`));
}

function enableBlockDrag(blk, { onTap, onDrop, snap }) {
  blk.addEventListener('pointerdown', (ev) => {
    if (ev.button > 0) return;
    const y0 = ev.clientY;
    const x0 = ev.clientX;
    let dragging = false;
    let dy = 0;
    blk.setPointerCapture(ev.pointerId);
    const move = (mv) => {
      dy = mv.clientY - y0;
      if (!dragging && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(mv.clientX - x0)) { dragging = true; blk.classList.add('dragging'); }
      if (dragging) blk.style.transform = `translateY(${snap(dy)}px)`;
    };
    const up = () => {
      blk.removeEventListener('pointermove', move);
      blk.removeEventListener('pointerup', up);
      blk.removeEventListener('pointercancel', cancel);
      if (dragging) onDrop(dy); else onTap();
    };
    const cancel = () => {
      blk.removeEventListener('pointermove', move);
      blk.removeEventListener('pointerup', up);
      blk.removeEventListener('pointercancel', cancel);
      blk.style.transform = '';
      blk.classList.remove('dragging');
    };
    blk.addEventListener('pointermove', move);
    blk.addEventListener('pointerup', up);
    blk.addEventListener('pointercancel', cancel);
  });
}

function renderMonth(app, root, anchor, titleEl) {
  const s = app.state;
  const a = fromISO(anchor);
  const first = toISO(new Date(a.getFullYear(), a.getMonth(), 1));
  titleEl.textContent = `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  const start = addDays(first, -weekday(first));
  const today = todayISO();
  const grid = el(`<div class="month">${['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'].map((x) => `<div class="dn">${x}</div>`).join('')}</div>`);
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && fromISO(d).getMonth() !== a.getMonth()) break;
    const day = M.getDay(s, d);
    const out = fromISO(d).getMonth() !== a.getMonth();
    const dots = day.lessons.map((l) => {
      const st = l.status && M.statusById(s, l.status);
      return `<span class="dot" title="${e(M.lessonName(s, l))}" style="background:${st ? e(st.bg) : '#fff'}"></span>`;
    }).join('');
    const cell = el(`<div class="d ${out ? 'out' : ''} ${d === today ? 'today' : ''}" data-d="${d}">
      <div class="num">${fromISO(d).getDate()}</div>
      ${day.holiday ? `<div class="hl">${e(day.holiday)}</div>` : ''}
      <div class="dots">${dots}</div></div>`);
    cell.addEventListener('click', () => reportDay(app, d, {
      onSaved: () => app.render(),
      extraAction: { label: 'לתצוגת שבוע', onClick: () => app.go('calendar', { mode: 'week', date: d }) },
    }));
    grid.appendChild(cell);
  }
  root.appendChild(grid);
  const legend = s.statuses.map((x) => `<span class="chip" style="background:${e(x.bg)};color:${e(x.fg)}">${e(x.name)}</span>`).join(' ');
  root.appendChild(el(`<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${legend}<span class="chip empty">לא דווח</span></div>`));
  root.appendChild(el(`<p class="hint" style="margin:10px 4px">לחיצה על יום פותחת דיווח על כל השיעורים שלו.</p>`));
}
