// App shell: navigation, the notebook (write → review → save) and the day arranger.

import { todayISO, addDays, weekday, fmtDay, fmtDate, relDay, escapeHtml as e, DAY_NAMES, uid, toMin } from './util.js';
import * as M from './model.js';
import { parseReport } from './parser.js';
import { loadState, saveState, getDraft, setDraft, askPersistence, takeInbox, getPref, setPref, backupBlob } from './store.js';
import { el, toast, openSheet, confirmDialog, chip, chipButton, editLesson, pickStudent, timeRange } from './ui.js';
import { renderStudents, editStudent } from './students.js';
import { renderSettings } from './settings.js';
import { renderTable } from './table.js';
import { renderCalendar } from './calendar.js';

const app = {
  state: loadState(),
  view: 'home',
  params: {},
  pending: null, // the review in progress, never saved until "שמור"
  save(opts) {
    saveState(this.state, opts);
  },
  go(view, params = {}) {
    this.view = view;
    this.params = params;
    try { history.replaceState(null, '', view === 'home' ? location.pathname : `#${view}`); } catch { /* file:// */ }
    render();
    window.scrollTo(0, 0);
  },
  render: () => render(),
};
window.__app = app; // handy for debugging and tests

const viewEl = document.getElementById('view');

function render() {
  const s = app.state;
  document.getElementById('who').innerHTML = s.teacher.name
    ? `<b>${e(s.teacher.name)}</b><span>${e(s.teacher.subject || '')}</span>`
    : `<b>דיווח שיעורים</b><span>${e(s.teacher.subject || '')}</span>`;
  document.querySelectorAll('#tabs button').forEach((b) => {
    const active = b.dataset.view === app.view || (app.view === 'review' && b.dataset.view === 'home');
    b.toggleAttribute('aria-current', false);
    if (active) b.setAttribute('aria-current', 'page');
  });
  viewEl.className = app.view === 'table' ? 'wide' : '';
  viewEl.innerHTML = '';
  const views = { home: renderHome, review: renderReview, day: renderDay, table: renderTable, calendar: renderCalendar, students: renderStudents, settings: renderSettings };
  (views[app.view] || renderHome)(app, viewEl);
}

// ============================================================
// Notebook: "מה היה היום?"
// ============================================================

const PLACEHOLDER = `שלישי
שלמה לא הגיע
בנימין - פינגרסטייל, אני צריך להתאמן על זה לשיעור הבא
יוסף הגיע ב-15:30`;

function reportDay(s) {
  // Today if it is a work day; otherwise the last work day (that is what one reports about).
  const wds = s.settings.workDays.map(Number);
  let d = todayISO();
  for (let i = 0; i < 7 && !wds.includes(weekday(d)); i++) d = addDays(d, -1);
  return d;
}

function renderHome(app, root) {
  const s = app.state;
  const today = todayISO();
  const page = el(`<div>
    <section class="page">
      <h2>מה היה היום? <small>${e(fmtDay(today))}</small></h2>
      <textarea class="write" id="write" placeholder="${e(PLACEHOLDER)}" aria-label="מה היה היום"></textarea>
      <div class="row-actions">
        <button class="btn primary" id="btnParse">סדר לי את זה ←</button>
        <button class="btn ghost" id="btnPaste" title="הדבקה">📋 הדבקה</button>
      </div>
    </section>
    <div id="homeMore"></div>
  </div>`);
  root.appendChild(page);
  const ta = page.querySelector('#write');
  ta.value = getDraft();
  const btn = page.querySelector('#btnParse');
  const syncBtn = () => { btn.disabled = !ta.value.trim(); };
  syncBtn();
  ta.addEventListener('input', () => { setDraft(ta.value); syncBtn(); });
  btn.addEventListener('click', () => startReview(ta.value));
  page.querySelector('#btnPaste').addEventListener('click', async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t) { ta.value = (ta.value ? ta.value + '\n' : '') + t; setDraft(ta.value); syncBtn(); ta.focus(); }
    } catch { toast('לחיצה ארוכה בתיבה ← "הדבק"'); ta.focus(); }
  });

  const more = page.querySelector('#homeMore');

  if (!s.students.length) {
    more.appendChild(el(`<div class="card" style="padding:16px;margin-top:16px">
      <b>צעד ראשון: רשימת התלמידים</b>
      <p class="muted" style="margin:6px 0 12px">כשהמערכת מכירה את התלמידים והשעות הקבועות שלהם, מספיק לכתוב "שלמה לא הגיע" והיא משלימה את השאר לבד.</p>
      <button class="btn primary" data-go="bulk">הוספת תלמידים</button>
    </div>`));
    more.querySelector('[data-go=bulk]').addEventListener('click', () => app.go('students', { bulk: true }));
  }

  // The day at a glance
  const d = reportDay(s);
  const day = M.getDay(s, d);
  const title = d === today ? 'היום במערכת' : `${relDay(d, today) || fmtDay(d)}`;
  if (day.lessons.length || day.holiday) {
    const box = el(`<div><div class="section-title"><span class="grow">${e(title)}</span><button class="btn small ghost" data-open>לסידור היום ←</button></div>
      <div class="card" style="padding:4px 12px"><ul class="lines"></ul></div></div>`);
    const ul = box.querySelector('ul');
    if (day.holiday) ul.appendChild(el(`<li class="line" style="grid-template-columns:1fr"><span>🎉 ${e(day.holiday)}</span></li>`));
    for (const l of day.lessons) {
      const li = el(`<li class="line" data-id="${e(l.id)}">
        <span class="mark ${l.status ? '' : 'q'}">${l.status ? '✓' : '·'}</span>
        <span class="time">${e(l.time)}</span>
        <span class="name">${e(M.lessonName(s, l))}</span>
        <span class="what">${chip(s, l.status)}${l.summary ? ` <span class="sub">${e(l.summary)}</span>` : ''}</span></li>`);
      li.addEventListener('click', () => editLesson(s, {
        date: d, lesson: l,
        onSave: (nl) => { M.updateLesson(s, d, l.id, nl); app.save(); render(); toast('נשמר ✓'); },
      }));
      ul.appendChild(li);
    }
    box.querySelector('[data-open]').addEventListener('click', () => app.go('day', { date: d }));
    more.appendChild(box);
  }

  // Days that still have lessons without a status (only since the app started being used).
  const firstReported = Object.keys(s.days).filter((k) => (s.days[k].lessons || []).some((l) => l.status)).sort()[0];
  if (firstReported) {
    const gaps = [];
    for (const dd of M.yearDates(s, firstReported, addDays(today, -1)).reverse()) {
      if (dd === d) continue;
      const n = M.getDay(s, dd).lessons.filter((l) => !l.status).length;
      if (n) gaps.push({ d: dd, n });
      if (gaps.length >= 4) break;
    }
    if (gaps.length) {
      const box = el(`<div><div class="section-title">ימים שעוד לא סגורים</div><ul class="list card"></ul></div>`);
      for (const g of gaps) {
        const li = el(`<li class="tap"><span class="grow">${e(fmtDay(g.d))}</span><span class="tag">${g.n} בלי סטטוס</span><span>‹</span></li>`);
        li.addEventListener('click', () => app.go('day', { date: g.d }));
        box.querySelector('ul').appendChild(li);
      }
      more.appendChild(box);
    }
  }

  // Everything lives on this device until cloud sync is connected: nudge a backup every two weeks.
  const reportedDays = Object.keys(s.days).length;
  const lastBackup = getPref('lastBackup');
  if (reportedDays >= 3 && (!lastBackup || addDays(lastBackup, 14) <= today)) {
    const box = el(`<div class="banner" style="margin-top:16px"><span class="grow">💾 הדיווחים שמורים רק במכשיר הזה. כדאי להוריד גיבוי.</span><button class="btn small" data-bk>גיבוי</button></div>`);
    box.querySelector('[data-bk]').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(backupBlob(s));
      a.download = `גיבוי-שיעורים-${today}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 2000);
      setPref('lastBackup', today);
      box.remove();
    });
    more.appendChild(box);
  }

  // My tasks
  const tasks = M.openTasks(s);
  if (tasks.length) {
    const box = el(`<div><div class="section-title">משימות שלי</div><ul class="list card"></ul></div>`);
    for (const t of tasks.slice(0, 12)) {
      const li = el(`<li><input type="checkbox" aria-label="בוצע"><span class="grow">${e(t.text)}<br><span class="hint">${e(t.name)} · ${e(fmtDate(t.date))}</span></span></li>`);
      li.querySelector('input').addEventListener('change', () => {
        const rec = s.days[t.date];
        const l = rec && rec.lessons.find((x) => x.id === t.lessonId);
        if (l && l.tasks[t.index]) l.tasks[t.index].done = true;
        app.save();
        li.style.opacity = '.4';
        setTimeout(render, 400);
      });
      box.querySelector('ul').appendChild(li);
    }
    more.appendChild(box);
  }

  if (!ta.value && s.students.length) setTimeout(() => { if (matchMedia('(min-width: 900px)').matches) ta.focus(); }, 50);
}

// ============================================================
// Review: looks like the notebook, one "שמור" button
// ============================================================

function parseCtx(s) {
  return {
    today: todayISO(),
    students: M.activeStudents(s),
    dayStart: s.settings.dayStart,
    dayEnd: s.settings.dayEnd,
    scheduledOn: (d) => M.scheduledIds(s, d),
    extraStatuses: s.statuses.filter((x) => !M.DEFAULT_STATUSES.some((d) => d.id === x.id)),
  };
}

function startReview(text) {
  const s = app.state;
  const parsed = parseReport(text, parseCtx(s));
  if (!parsed.days.length) {
    toast('לא מצאתי פה שיעורים. אפשר לנסות לכתוב שם של תלמיד בתחילת שורה.');
    return;
  }
  app.pending = {
    text,
    days: parsed.days.map((pd) => ({ parsed: pd, review: M.buildReview(s, pd) })),
  };
  app.go('review');
}

const STATUS_WORD = { came: 'הגיע', notified: 'לא הגיע והודיע', noshow: 'לא הגיע לא הודיע', trip: 'טיול / אילוצים' };

function renderReview(app, root) {
  const s = app.state;
  const p = app.pending;
  if (!p) return app.go('home');
  const wrap = el(`<div></div>`);
  root.appendChild(wrap);

  p.days.forEach((pd, di) => {
    const rv = pd.review;
    const page = el(`<section class="page" style="margin-bottom:14px">
      <h2 style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span>${e(fmtDay(rv.date))}</span>
        <label class="hint" style="font-weight:400">שינוי תאריך <input type="date" value="${e(rv.date)}" data-date style="font-size:14px;border:1px solid var(--border);border-radius:8px;padding:2px 6px"></label>
      </h2>
      ${rv.plan ? '<p class="hint" style="margin:0 0 6px">זה נראה כמו סידור יום: השיעורים יוחלפו בסדר שכתבת, ליום הזה בלבד.</p>' : ''}
      ${M.holidayOn(s, rv.date) ? `<div class="banner holiday">🎉 ${e(M.holidayOn(s, rv.date))} — לפי הלוח זה יום חופש</div>` : ''}
      <ul class="lines"></ul>
      <div class="row-actions" data-bulk></div>
      <label class="field" style="margin-top:10px"><span>הארות ושינויים ליום</span><input class="input" data-remark value="${e(rv.remark || '')}" placeholder="למשל: שיעור קצר בגלל אסיפה"></label>
    </section>`);
    const ul = page.querySelector('ul');

    rv.rows.forEach((r) => {
      const name = r.studentId ? M.lessonName(s, r) : r.name;
      const attn = !r.status;
      const flags = [];
      if (r.flags.timeChangedFrom) flags.push(`השעה שונתה היום מ-${r.flags.timeChangedFrom}`);
      if (r.flags.extra) flags.push('לא בלוח של היום');
      if (r.flags.fuzzy) flags.push(`זוהה מתוך "${r.flags.fuzzy}"`);
      if (r.flags.ambiguous) flags.push('יש כמה תלמידים בשם הזה — לחצו לבחירה');
      if (r.flags.isNew && !r.studentId) flags.push('תלמיד חדש?');
      const defLen = r.studentId ? M.defaultLen(s, r, rv.date) : null;
      if (defLen && Number(r.len) !== defLen) flags.push(`${r.len} דק׳ (בדרך כלל ${defLen})`);
      const what = [];
      if (r.status) what.push(chip(s, r.status));
      else if (r.flags.unreported) what.push('<span class="chip empty">לא דווח</span>');
      else if (r.flags.askNotified) what.push('<span class="chip" style="background:#FDECEC;color:#8A1C1C">לא הגיע</span>');
      if (r.summary) what.push(`<span>${e(r.summary)}</span>`);
      if (r.tasks?.length) what.push(`<span class="sub">משימה: ${e(r.tasks.map((t) => t.text).join(' · '))}</span>`);
      if (r.note) what.push(`<span class="sub">${e(r.note)}</span>`);
      const li = el(`<li class="line ${attn ? 'attn' : ''}" data-row="${e(r.id)}">
        <span class="mark ${attn ? 'q' : ''}">${attn ? '?' : '✓'}</span>
        <span class="time">${e(r.time)}</span>
        <span class="name">${e(name)}</span>
        <span class="what">${what.join(' · ')}${flags.length ? `<div class="sub">${e(flags.join(' · '))}</div>` : ''}<div class="choices"></div></span>
      </li>`);
      const choices = li.querySelector('.choices');
      if (!r.status) {
        if (r.flags.askNotified) {
          choices.innerHTML = chipButton(s, 'notified', 'הודיע', 'data-set="notified"') + chipButton(s, 'noshow', 'לא הודיע', 'data-set="noshow"');
        } else {
          choices.innerHTML = chipButton(s, 'came', 'הגיע', 'data-set="came"') + chipButton(s, 'notified', 'לא הגיע · הודיע', 'data-set="notified"') + chipButton(s, 'noshow', 'לא הגיע · לא הודיע', 'data-set="noshow"');
        }
      }
      if (!r.studentId && r.name) {
        choices.insertAdjacentHTML('beforeend', `<button type="button" class="btn small" data-newstudent>+ להוסיף לרשימה</button><button type="button" class="btn small ghost" data-whois>זה בעצם…</button>`);
      }
      if (r.flags.ambiguous) choices.insertAdjacentHTML('beforeend', `<button type="button" class="btn small ghost" data-whois>מי מהם?</button>`);
      if (!choices.innerHTML) choices.remove();

      li.addEventListener('click', (ev) => {
        const b = ev.target.closest('button');
        if (b && b.dataset.set) {
          r.status = b.dataset.set;
          render();
          return;
        }
        if (b && b.dataset.newstudent != null) {
          editStudent(app, null, {
            name: r.name, day: weekday(rv.date), time: r.time, len: r.len, from: rv.date,
            onSaved: (st) => { r.studentId = st.id; r.name = ''; r.flags.isNew = false; render(); },
          });
          return;
        }
        if (b && b.dataset.whois != null) {
          const typed = r.flags.fuzzy || r.name;
          pickStudent(s, {
            date: rv.date, title: `מי זה "${typed || name}"?`, allowNew: false,
            onPick: ({ studentId }) => {
              r.studentId = studentId;
              const st = M.studentById(s, studentId);
              if (r.name && st && !st.aliases?.includes(r.name) && r.name !== st.name) {
                st.aliases = [...(st.aliases || []), r.name];
                toast(`מעכשיו "${r.name}" = ${st.name}`);
              }
              r.name = '';
              r.flags.isNew = false;
              r.flags.ambiguous = null;
              const slot = st && M.slotOn(st, rv.date);
              if (slot && !r.flags.timeChangedFrom) { r.time = slot.time; r.len = Number(slot.len); }
              // If he was already on the day's list, merge into that row.
              const dup = rv.rows.find((x) => x !== r && x.studentId === studentId && !x.mentioned);
              if (dup) { r.time = dup.time; rv.rows = rv.rows.filter((x) => x !== dup); }
              render();
            },
          });
          return;
        }
        editLesson(s, {
          date: rv.date, lesson: r,
          onSave: (nl) => { Object.assign(r, nl); render(); },
          onDelete: () => { rv.rows = rv.rows.filter((x) => x !== r); render(); },
        });
      });
      ul.appendChild(li);
    });

    const bulk = page.querySelector('[data-bulk]');
    const unreported = rv.rows.filter((r) => !r.status && r.flags.unreported);
    if (unreported.length) {
      const b = el(`<button class="btn small">כל השאר הגיעו (${unreported.length})</button>`);
      b.addEventListener('click', () => { unreported.forEach((r) => { r.status = 'came'; }); render(); });
      bulk.appendChild(b);
    }
    const add = el(`<button class="btn small ghost">+ שיעור</button>`);
    add.addEventListener('click', () => pickStudent(s, {
      date: rv.date, exclude: rv.rows.map((r) => r.studentId).filter(Boolean),
      onPick: ({ studentId, newName }) => {
        const st = studentId && M.studentById(s, studentId);
        const slot = st && (M.slotOn(st, rv.date) || M.currentSlot(st, rv.date));
        rv.rows.push({ id: uid(), studentId: studentId || null, name: newName || '', time: M.nextFreeTime(s, rv.date, rv.rows), len: slot ? Number(slot.len) : 30, status: 'came', summary: '', note: '', tasks: [], mentioned: true, flags: { isNew: !studentId } });
        rv.rows.sort(M.byTime);
        render();
      },
    }));
    bulk.appendChild(add);

    page.querySelector('[data-remark]').addEventListener('input', (ev) => { rv.remark = ev.target.value; });
    page.querySelector('[data-date]').addEventListener('change', (ev) => {
      const nd = ev.target.value;
      if (!nd) return;
      pd.parsed = { ...pd.parsed, date: nd };
      pd.review = M.buildReview(s, pd.parsed);
      render();
    });
    wrap.appendChild(page);
  });

  const left = p.days.reduce((n, pd) => n + pd.review.rows.filter((r) => !r.status).length, 0);
  const foot = el(`<div class="row-actions" style="position:sticky;bottom:calc(var(--nav-h) + env(safe-area-inset-bottom) + 8px);background:var(--paper);padding:8px 0;border-radius:12px">
    <button class="btn primary grow" style="justify-content:center" data-save>שמור</button>
    <button class="btn ghost" data-back>חזרה לכתיבה</button>
  </div>`);
  if (left) foot.insertAdjacentHTML('afterbegin', `<span class="hint" style="width:100%">${left} שיעורים בלי סטטוס — אפשר לשמור גם ככה ולהשלים אחר כך</span>`);
  foot.querySelector('[data-save]').addEventListener('click', () => {
    for (const pd of p.days) {
      M.applyReview(s, pd.review);
    }
    app.save();
    setDraft('');
    const dates = p.days.map((pd) => pd.review.date);
    app.pending = null;
    toast(dates.length > 1 ? `נשמרו ${dates.length} ימים ✓` : 'נשמר ✓ מופיע בטבלה, ביומן ובהיסטוריה');
    app.go('home');
  });
  foot.querySelector('[data-back]').addEventListener('click', () => { app.pending = null; app.go('home'); });
  wrap.appendChild(foot);
}

// ============================================================
// Day arranger: one-time changes, the regular schedule never moves
// ============================================================

function stepWorkday(s, d, dir) {
  const wds = s.settings.workDays.map(Number);
  let x = d;
  for (let i = 0; i < 14; i++) {
    x = addDays(x, dir);
    if (wds.includes(weekday(x)) || s.days[x]?.lessons?.length) return x;
  }
  return addDays(d, dir);
}

function renderDay(app, root) {
  const s = app.state;
  const date = app.params.date || reportDay(s);
  const day = M.getDay(s, date);
  const selecting = !!app.params.selecting;
  const selected = new Set(app.params.selected || []);
  const rel = relDay(date);
  const wrap = el(`<div>
    <div class="daynav">
      <button class="icon-btn" data-step="-1" aria-label="יום קודם">›</button>
      <div class="title"><label style="cursor:pointer">${e(fmtDay(date))}<input type="date" value="${e(date)}" data-pick style="position:absolute;opacity:0;width:1px;height:1px"></label><small>${e(rel || '')}${day.custom ? `${rel ? ' · ' : ''}שונה מהמערכת הקבועה` : ''}</small></div>
      <button class="icon-btn" data-step="1" aria-label="יום הבא">‹</button>
    </div>
    ${day.holiday ? `<div class="banner holiday">🎉 ${e(day.holiday)}</div>` : ''}
    <div class="row-actions" style="margin:0 0 10px">
      ${selecting
        ? `<button class="btn danger" data-delsel ${selected.size ? '' : 'disabled'}>מחק מהיום (${selected.size})</button><button class="btn ghost" data-selall>סמן הכל</button><button class="btn ghost" data-cancelsel>סיום</button>`
        : `<button class="btn primary" data-add>+ הוסף</button><button class="btn" data-select ${day.lessons.length ? '' : 'disabled'}>בחירה</button><button class="btn ghost" data-more>עוד…</button>`}
    </div>
    <ul class="list card arr"></ul>
    <p class="hint" style="margin:10px 4px">גוררים ב-☰ כדי לשנות סדר (השעות מסתדרות לפי האורך של כל אחד). כל שינוי כאן הוא ליום הזה בלבד. אפשר גם לכתוב במחברת: <span class="kbd">היום: בנימין 14:00, צביקה 14:45</span></p>
    <label class="field"><span>הארות ושינויים</span><textarea class="input" data-remark rows="2" placeholder="יופיע בעמודה האחרונה בטבלה">${e(day.remark)}</textarea></label>
  </div>`);
  root.appendChild(wrap);
  const ul = wrap.querySelector('ul');
  if (!day.lessons.length) ul.appendChild(el(`<li class="muted" style="justify-content:center">${day.holiday ? 'יום חופש — אין שיעורים במערכת' : 'אין שיעורים ביום הזה'}</li>`));
  for (const l of day.lessons) {
    const sub = [l.summary, l.note].filter(Boolean).join(' · ');
    const li = el(`<li class="tap" data-id="${e(l.id)}">
      ${selecting ? `<input type="checkbox" ${selected.has(l.id) ? 'checked' : ''} aria-label="בחירה">` : '<span class="handle" aria-label="גרירה">☰</span>'}
      <span class="t">${e(timeRange(l))}</span>
      <span class="n">${e(M.lessonName(s, l))}${sub ? `<small>${e(sub)}</small>` : ''}</span>
      ${chip(s, l.status)}
    </li>`);
    ul.appendChild(li);
  }

  const setParams = (p) => { app.params = { ...app.params, date, ...p }; render(); };
  wrap.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => app.go('day', { date: stepWorkday(s, date, Number(b.dataset.step)) })));
  wrap.querySelector('[data-pick]').addEventListener('change', (ev) => ev.target.value && app.go('day', { date: ev.target.value }));
  const titleLabel = wrap.querySelector('.daynav label');
  titleLabel.addEventListener('click', (ev) => {
    const inp = wrap.querySelector('[data-pick]');
    if (inp.showPicker) { ev.preventDefault(); try { inp.showPicker(); } catch { /* ignore */ } }
  });
  wrap.querySelector('[data-remark]').addEventListener('change', (ev) => {
    // A remark alone does not freeze the lessons; they keep following the regular schedule.
    s.days[date] = { ...(s.days[date] || {}), remark: ev.target.value.trim() };
    app.save();
    toast('נשמר ✓');
  });

  ul.addEventListener('click', (ev) => {
    const li = ev.target.closest('li[data-id]');
    if (!li || ev.target.closest('.handle')) return;
    const id = li.dataset.id;
    if (selecting) {
      selected.has(id) ? selected.delete(id) : selected.add(id);
      setParams({ selected: [...selected] });
      return;
    }
    const l = day.lessons.find((x) => x.id === id);
    editLesson(s, {
      date, lesson: l,
      onSave: (nl) => { M.updateLesson(s, date, id, nl); app.save(); render(); },
      onDelete: () => { M.removeLessons(s, date, [id]); app.save(); render(); toast('הוסר מהיום הזה'); },
    });
  });

  if (!selecting) enableDrag(ul, (order) => {
    const lessons = order.map((id) => day.lessons.find((l) => l.id === id));
    const start = day.lessons[0].time;
    M.setDayLessons(s, date, M.repack(lessons, start));
    app.save();
    render();
  });

  const q = (sel) => wrap.querySelector(sel);
  q('[data-add]')?.addEventListener('click', () => pickStudent(s, {
    date, exclude: day.lessons.map((l) => l.studentId).filter(Boolean),
    onPick: ({ studentId, newName }) => {
      const add = (sid, name) => {
        const st = sid && M.studentById(s, sid);
        const slot = st && (M.slotOn(st, date) || M.currentSlot(st, date));
        const l = M.addLesson(s, date, { studentId: sid || null, name: name || '', time: M.nextFreeTime(s, date), len: slot ? Number(slot.len) : 30 });
        app.save();
        render();
        editLesson(s, { date, lesson: l, title: 'שיעור נוסף ליום הזה', onSave: (nl) => { M.updateLesson(s, date, l.id, nl); app.save(); render(); } });
      };
      if (newName) {
        editStudent(app, null, { name: newName, day: weekday(date), time: M.nextFreeTime(s, date), from: date, oneTimeOption: true, onSaved: (st) => add(st.id) });
      } else add(studentId);
    },
  }));
  q('[data-select]')?.addEventListener('click', () => setParams({ selecting: true, selected: [] }));
  q('[data-cancelsel]')?.addEventListener('click', () => setParams({ selecting: false, selected: [] }));
  q('[data-selall]')?.addEventListener('click', () => setParams({ selected: day.lessons.map((l) => l.id) }));
  q('[data-delsel]')?.addEventListener('click', () => {
    M.removeLessons(s, date, [...selected]);
    app.save();
    toast(`${selected.size} הוסרו מהיום הזה`);
    setParams({ selecting: false, selected: [] });
  });
  q('[data-more]')?.addEventListener('click', () => {
    const body = el(`<ul class="list card">
      <li class="tap" data-a="pack">סגור רווחים (כל שיעור מיד אחרי הקודם)</li>
      <li class="tap" data-a="clear" style="color:var(--danger)">נקה את כל היום</li>
      ${day.custom ? '<li class="tap" data-a="reset">החזר את היום למערכת הקבועה</li>' : ''}
      <li class="tap" data-a="write">כתיבת סדר היום במחברת</li>
    </ul>`);
    const sh = openSheet({ title: 'עוד פעולות ליום הזה', body, actions: [{ label: 'סגור', cls: 'ghost' }] });
    body.addEventListener('click', async (ev) => {
      const a = ev.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      sh.close();
      if (a === 'pack') { M.setDayLessons(s, date, M.repack(day.lessons)); app.save(); render(); }
      if (a === 'clear' && await confirmDialog('לנקות את כל השיעורים מהיום הזה? המערכת הקבועה לא משתנה.', 'נקה', true)) {
        M.setDayLessons(s, date, []); app.save(); render();
      }
      if (a === 'reset' && await confirmDialog('להחזיר את היום למערכת הקבועה? מה שדווח ביום הזה יימחק.', 'החזר', true)) {
        const remark = s.days[date]?.remark;
        delete s.days[date];
        if (remark) s.days[date] = { remark };
        app.save(); render();
      }
      if (a === 'write') {
        const txt = `${relDay(date) === 'היום' ? 'היום' : fmtDate(date)}: ` + day.lessons.map((l) => `${M.lessonName(s, l)} ${l.time}`).join(', ');
        setDraft(txt);
        app.go('home');
      }
    });
  });
}

// Pointer-based drag on the ☰ handle; works with touch and mouse.
function enableDrag(ul, onDrop) {
  ul.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest('.handle');
    if (!handle) return;
    const li = handle.closest('li');
    ev.preventDefault();
    li.classList.add('dragging');
    const startOrder = [...ul.querySelectorAll('li[data-id]')].map((x) => x.dataset.id);
    // Listen on the document: moving the row in the DOM would drop a pointer capture on the handle.
    const move = (mv) => {
      mv.preventDefault();
      const items = [...ul.querySelectorAll('li[data-id]')];
      for (const other of items) {
        if (other === li) continue;
        const r = other.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const liIdx = items.indexOf(li);
        const oIdx = items.indexOf(other);
        if (oIdx < liIdx && mv.clientY < mid) { ul.insertBefore(li, other); break; }
        if (oIdx > liIdx && mv.clientY > mid) { ul.insertBefore(li, other.nextSibling); break; }
      }
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      li.classList.remove('dragging');
      const order = [...ul.querySelectorAll('li[data-id]')].map((x) => x.dataset.id);
      if (order.join() !== startOrder.join()) onDrop(order);
    };
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  });
}

// ============================================================
// Boot
// ============================================================

document.getElementById('tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-view]');
  if (b) app.go(b.dataset.view);
});
document.getElementById('btnSettings').addEventListener('click', () => app.go('settings'));

async function receiveShared() {
  const params = new URLSearchParams(location.search);
  let text = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join('\n');
  if (params.has('shared')) {
    const inbox = await takeInbox();
    if (inbox) text = [inbox.title, inbox.text, inbox.url].filter(Boolean).join('\n');
  }
  if (params.toString()) { try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ } }
  if (text.trim()) {
    const prev = getDraft();
    setDraft(prev ? prev + '\n' + text : text);
    app.go('home');
    toast('הטקסט נכנס לתיבה. בודקים ולוחצים "סדר לי את זה"');
    return true;
  }
  return false;
}

(async function boot() {
  const hashView = location.hash.replace('#', '');
  const shared = await receiveShared();
  if (!shared) app.go(['day', 'table', 'calendar', 'students', 'settings'].includes(hashView) ? hashView : 'home');
  askPersistence();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  if (!getPref('seenWelcome') && !app.state.teacher.name) {
    setPref('seenWelcome', true);
    welcome();
  }
})();

function welcome() {
  const s = app.state;
  const body = el(`<div>
    <p>כותבים בסוף היום כמו במחברת, והאתר מסדר לבד: טבלת נוכחות לבוס, היסטוריה לכל תלמיד וקובץ אקסל במבנה של הישיבה.</p>
    <label class="field"><span>השם שלך</span><input class="input" name="n" placeholder="למשל: גיא אמסלם"></label>
    <label class="field"><span>מה את/ה מלמד/ת</span><input class="input" name="sub" value="${e(s.teacher.subject)}"></label>
  </div>`);
  openSheet({
    title: 'שלום! 👋',
    body,
    actions: [{
      label: 'יאללה', cls: 'primary', grow: true, onClick: (close) => {
        s.teacher.name = body.querySelector('[name=n]').value.trim();
        s.teacher.subject = body.querySelector('[name=sub]').value.trim();
        app.save();
        close();
        render();
        if (!s.students.length) app.go('students', { bulk: true });
      },
    }],
  });
}

export { app, render, startReview };
