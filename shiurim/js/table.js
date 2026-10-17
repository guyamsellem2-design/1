// The whole school year as one sheet, like the yeshiva's Google Sheet:
// a row per work day, a column per 15 minutes (headers every half hour), merged cells per lesson.
// Click a cell and type, or pick a status - exactly like in Sheets. Same data as every other view.

import { escapeHtml as e, toMin, fromMin, todayISO, weekday, fmtDate, norm, endTime } from './util.js';
import * as M from './model.js';
import { detectStatus, stripStatusWords, cleanup } from './parser.js';
import { el, toast, editLesson, pickStudent } from './ui.js';
import { openExport } from './export.js';
import { reportDay } from './report.js';
import { getPref, setPref } from './store.js';

const DAY_LETTER = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const SLOT = 15;

export function slotColumns(s) {
  const start = Math.floor(toMin(s.settings.dayStart) / SLOT) * SLOT;
  const end = Math.ceil(toMin(s.settings.dayEnd) / SLOT) * SLOT;
  const cols = [];
  for (let t = start; t < end; t += SLOT) cols.push(t);
  return cols;
}

function frameOk(s, l, frame) {
  if (!frame) return true;
  if (!l.studentId) return true;
  const st = M.studentById(s, l.studentId);
  return !st || (st.frame || 'yeshiva') === frame;
}

// Lay lessons out on the slot columns: [{col, span, lesson}] plus any that fall outside the day.
export function layoutRow(s, lessons, cols) {
  const first = cols[0];
  const last = cols[cols.length - 1] + SLOT;
  const placed = [];
  const outside = [];
  let nextFree = 0;
  for (const l of lessons.slice().sort(M.byTime)) {
    const a = toMin(l.time);
    const b = a + Number(l.len);
    if (b <= first || a >= last) { outside.push(l); continue; }
    let col = Math.max(0, Math.floor((Math.max(a, first) - first) / SLOT));
    if (col < nextFree) col = nextFree; // overlapping lessons: show after the previous one
    if (col >= cols.length) { outside.push(l); continue; }
    let span = Math.max(1, Math.ceil((Math.min(b, last) - (first + col * SLOT)) / SLOT));
    span = Math.min(span, cols.length - col);
    placed.push({ col, span, lesson: l });
    nextFree = col + span;
  }
  return { placed, outside };
}

// Two ways to look at the same year:
//  "רשימה" (list) - a row per day with its lessons as readable cards; made for the phone.
//  "גיליון" (sheet) - the Excel-like grid with a column per 15 minutes, for the computer or zoomed in.
// Both can be pinched with two fingers (or ctrl + mouse wheel) to zoom in and out.
export function renderTable(app, root) {
  const s = app.state;
  const cols = slotColumns(s);
  const today = todayISO();
  const frame = getPref('tableFrame', '');
  const narrow = window.innerWidth < 700;
  const mode = getPref('tableMode', narrow ? 'list' : 'grid');
  const zoomKey = mode === 'list' ? 'tableZoomList' : 'tableZoom';
  const zoom = Number(getPref(zoomKey, mode === 'grid' && narrow ? 0.8 : 1)) || 1;
  const legend = s.statuses.map((x) => `<span class="chip" style="background:${e(x.bg)};color:${e(x.fg)}">${e(x.name)}</span>`).join('') + '<span class="chip empty">לא דווח</span>';
  const wrap = el(`<div>
    <div class="table-tools">
      <div class="seg mode-seg"><button type="button" data-mode="list" aria-pressed="${mode === 'list'}">☰ רשימה</button><button type="button" data-mode="grid" aria-pressed="${mode === 'grid'}">▦ גיליון</button></div>
      <select class="input" data-frame style="width:auto;min-height:34px;padding:2px 6px;font-size:14px;max-width:96px">
        <option value="">כל המסגרות</option>${s.frames.map((f) => `<option value="${e(f.id)}" ${frame === f.id ? 'selected' : ''}>${e(f.name)}</option>`).join('')}
      </select>
      <button class="btn small" data-today>להיום</button>
      <button class="btn small primary" data-export title="הורדה לאקסל" aria-label="הורדה לאקסל">⤓ אקסל</button>
      <span class="zoom-ctl"><button class="btn small ghost" data-zoom="-1" aria-label="הקטנה">−</button><button class="btn small ghost" data-zoom="1" aria-label="הגדלה">+</button></span>
    </div>
    <div class="table-legend">${legend}</div>
    <p class="hint table-hint">${mode === 'list'
      ? '<b>תאריך</b> = כל היום · <b>שיעור</b> = סטטוס · <b>+</b> = הוספה · 🤏 שתי אצבעות = זום'
      : '<b>תאריך</b> = כל היום · <b>תא</b> = הקלדה או סטטוס · עמודה = רבע שעה · 🤏 = זום'}</p>
    <div class="grid-wrap"><table class="grid ${mode === 'list' ? 'list-mode' : ''}"><thead></thead><tbody></tbody></table></div>
  </div>`);
  root.appendChild(wrap);
  const table = wrap.querySelector('table');
  const gridWrap = wrap.querySelector('.grid-wrap');

  // header
  if (mode === 'grid') {
    // Two header rows: the hour over its four quarters, then the minutes, so a lesson's length is easy to read.
    const h1 = document.createElement('tr');
    const h2 = document.createElement('tr');
    h2.className = 'mins';
    h1.innerHTML = `<th class="c-date" rowspan="2">תאריך</th><th class="c-hol" rowspan="2">חופשות, טיולים והיעדרויות מורה</th>`;
    for (let i = 0; i < cols.length;) {
      const t = cols[i];
      let span = 1;
      while (i + span < cols.length && Math.floor(cols[i + span] / 60) === Math.floor(t / 60)) span++;
      h1.insertAdjacentHTML('beforeend', `<th class="hour" colspan="${span}" dir="ltr">${fromMin(Math.floor(t / 60) * 60)}</th>`);
      i += span;
    }
    for (const t of cols) h2.insertAdjacentHTML('beforeend', `<th class="q${t % 60 === 0 ? ' q0' : ''}" dir="ltr">${String(t % 60).padStart(2, '0')}</th>`);
    h1.insertAdjacentHTML('beforeend', '<th class="c-rem" rowspan="2">הארות ושינויים</th>');
    table.tHead.append(h1, h2);
  } else {
    const h1 = document.createElement('tr');
    h1.innerHTML = '<th class="c-date">תאריך</th><th class="c-lessons">שיעורים</th>';
    table.tHead.appendChild(h1);
  }

  const dates = M.yearDates(s);
  const body = table.tBodies[0];
  const frag = document.createDocumentFragment();
  let prevWeek = null;
  for (const d of dates) frag.appendChild(buildRow(d, prevWeek !== null && weekday(d) <= prevWeek));

  function rowShell(d, day, weekStart) {
    prevWeek = weekday(d);
    const tr = document.createElement('tr');
    tr.dataset.date = d;
    if (d === today) tr.classList.add('today');
    if (day.holiday) tr.classList.add('holiday');
    if (weekStart) tr.classList.add('week-start');
    return tr;
  }

  function buildRow(d, weekStart) {
    const day = M.getDay(s, d);
    const tr = rowShell(d, day, weekStart);
    const lessons = day.lessons.filter((l) => frameOk(s, l, frame));
    const dateCell = `<td class="c-date tap-date" title="דיווח על כל היום">${DAY_LETTER[weekday(d)]} ${fmtDate(d)}</td>`;
    if (mode === 'list') {
      const chips = lessons.map((l, i) => {
        const st = l.status && M.statusById(s, l.status);
        const style = st ? `background:${e(st.bg)};color:${e(st.fg)};border-color:${e(st.bg)}` : '';
        return `<button type="button" class="lchip ${st ? '' : 'blank'}" style="${style}" data-kind="lesson" data-id="${e(l.id)}" data-col="${i}">
          <span class="lt" dir="ltr">${e(l.time)}–${e(endTime(l.time, l.len))}</span><span class="ln">${e(M.lessonName(s, l))}</span>${!st && l.note ? `<span class="lx">${e(l.note)}</span>` : ''}</button>`;
      }).join('');
      tr.innerHTML = `${dateCell}<td class="c-lessons">
        ${day.holiday ? `<button type="button" class="lhol" data-kind="hol" data-col="-1">🎉 ${e(day.holiday)}</button>` : ''}
        ${chips}<button type="button" class="ladd" data-kind="add" data-col="${lessons.length}" aria-label="הוספת שיעור">+</button>
        ${day.remark ? `<button type="button" class="lrem" data-kind="rem" data-col="${lessons.length + 1}">📝 ${e(day.remark)}</button>` : ''}</td>`;
      return tr;
    }
    const { placed, outside } = layoutRow(s, lessons, cols);
    let html = `${dateCell}<td class="c-hol" tabindex="0" data-kind="hol" data-col="-1">${e(day.holiday)}</td>`;
    let c = 0;
    const slotTd = (i) => `<td class="slot${cols[i] % 60 === 45 ? ' hr-end' : ''}" tabindex="0" data-kind="slot" data-col="${i}"></td>`;
    for (const p of placed) {
      for (; c < p.col; c++) html += slotTd(c);
      const l = p.lesson;
      const st = l.status && M.statusById(s, l.status);
      const text = st ? st.name : (l.note || '');
      const style = st ? `background:${e(st.bg)};color:${e(st.fg)}` : '';
      html += `<td class="lesson" colspan="${p.span}" tabindex="0" data-kind="lesson" data-id="${e(l.id)}" data-col="${p.col}" title="${e(`${M.lessonName(s, l)} ${l.time}–${endTime(l.time, l.len)} · ${l.len} דק׳${l.summary ? '\n' + l.summary : ''}${l.note && st ? '\n' + l.note : ''}`)}">
        <div class="cell ${st || text ? '' : 'blank'}" style="${style}"><span class="nm">${e(M.lessonName(s, l))}</span><span class="st">${e(text || '')}</span><span class="tm" dir="ltr">${e(l.time)}–${e(endTime(l.time, l.len))}</span></div></td>`;
      c = p.col + p.span;
    }
    for (; c < cols.length; c++) html += slotTd(c);
    const extra = outside.map((l) => `${M.lessonName(s, l)} ${l.time}`).join(', ');
    html += `<td class="c-rem" tabindex="0" data-kind="rem" data-col="${cols.length}">${e([day.remark, extra && `(מחוץ לשעות: ${extra})`].filter(Boolean).join(' '))}</td>`;
    tr.innerHTML = html;
    return tr;
  }
  body.appendChild(frag);

  const refreshRow = (d) => {
    const old = body.querySelector(`tr[data-date="${d}"]`);
    const idx = dates.indexOf(d);
    prevWeek = idx > 0 ? weekday(dates[idx - 1]) : null;
    const tr = buildRow(d, prevWeek !== null && weekday(d) <= prevWeek);
    if (old) old.replaceWith(tr);
    return tr;
  };

  // The table fills the screen down to the bottom menu.
  const fitHeight = () => {
    const top = gridWrap.getBoundingClientRect().top;
    const nav = document.getElementById('tabs');
    const navH = nav && getComputedStyle(nav).position === 'fixed' ? nav.offsetHeight : 0;
    gridWrap.style.height = Math.max(260, window.innerHeight - top - navH - 6) + 'px';
  };
  requestAnimationFrame(fitHeight);
  window.addEventListener('resize', fitHeight);

  // ---------- zoom: buttons, two-finger pinch, ctrl + wheel ----------
  let z = zoom;
  const MIN = 0.4;
  const MAX = 2.2;
  const applyZoom = (nz, focus) => {
    nz = Math.max(MIN, Math.min(MAX, nz));
    const rect = table.getBoundingClientRect();
    const fx = focus ? (focus.x - rect.left) / rect.width : 0.5;
    const fy = focus ? (focus.y - rect.top) / rect.height : 0;
    z = nz;
    table.style.setProperty('zoom', z);
    if (focus) {
      const r2 = table.getBoundingClientRect();
      gridWrap.scrollBy(r2.left + fx * r2.width - focus.x, r2.top + fy * r2.height - focus.y);
    }
  };
  const saveZoom = () => setPref(zoomKey, +z.toFixed(2));
  applyZoom(z);
  wrap.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    const r = gridWrap.getBoundingClientRect();
    applyZoom(z * (Number(b.dataset.zoom) > 0 ? 1.2 : 1 / 1.2), { x: r.left + r.width / 2, y: r.top + 40 });
    saveZoom();
  }));
  let pinch = null;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  gridWrap.addEventListener('touchstart', (ev) => {
    if (ev.touches.length === 2) {
      pinch = { d: dist(ev.touches), z };
      closeEditor();
      ev.preventDefault();
    }
  }, { passive: false });
  let raf = 0;
  gridWrap.addEventListener('touchmove', (ev) => {
    if (!pinch || ev.touches.length !== 2) return;
    ev.preventDefault();
    const nz = pinch.z * (dist(ev.touches) / pinch.d);
    const m = mid(ev.touches);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => applyZoom(nz, m));
  }, { passive: false });
  const endPinch = (ev) => { if (pinch && ev.touches.length < 2) { pinch = null; saveZoom(); } };
  gridWrap.addEventListener('touchend', endPinch);
  gridWrap.addEventListener('touchcancel', endPinch);
  gridWrap.addEventListener('wheel', (ev) => {
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    applyZoom(z * (ev.deltaY < 0 ? 1.1 : 1 / 1.1), { x: ev.clientX, y: ev.clientY });
    saveZoom();
  }, { passive: false });

  const scrollToToday = (smooth) => {
    const target = dates.find((d) => d >= today) || dates[dates.length - 1];
    const tr = target && body.querySelector(`tr[data-date="${target}"]`);
    if (tr) {
      const head = table.tHead.getBoundingClientRect().height;
      const top = tr.getBoundingClientRect().top - gridWrap.getBoundingClientRect().top + gridWrap.scrollTop;
      gridWrap.scrollTo({ top: Math.max(0, top - head - 8), behavior: smooth ? 'smooth' : 'auto' });
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(() => scrollToToday(false)));
  wrap.querySelector('[data-today]').addEventListener('click', () => scrollToToday(true));
  wrap.querySelector('[data-frame]').addEventListener('change', (ev) => { setPref('tableFrame', ev.target.value); app.render(); });
  wrap.querySelector('[data-export]').addEventListener('click', () => openExport(app));
  wrap.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { setPref('tableMode', b.dataset.mode); app.render(); }));

  // ---------- editing ----------
  let editor = null;
  const closeEditor = () => { if (editor) { editor.remove(); editor = null; } };

  function commitLessonText(d, l, text) {
    const t = text.trim();
    if (!t) return;
    const sts = s.statuses.slice().sort((a, b) => b.name.length - a.name.length);
    const exact = sts.find((x) => norm(x.name) === norm(t));
    if (exact) { M.updateLesson(s, d, l.id, { status: exact.id }); return; }
    const pref = sts.find((x) => norm(t).startsWith(norm(x.name)));
    if (pref) {
      const rest = cleanup(t.slice(pref.name.length));
      M.updateLesson(s, d, l.id, { status: pref.id, ...(rest ? { note: rest } : {}) });
      return;
    }
    const det = detectStatus(t);
    if (det && det !== 'absent') {
      const rest = cleanup(stripStatusWords(t));
      M.updateLesson(s, d, l.id, { status: det, ...(rest ? { note: rest } : {}) });
      return;
    }
    // "הגיע, עבדנו על סולמות" is handled above; anything else is kept as written.
    if (/^\s*(?:הגיע|היה)/.test(t)) {
      M.updateLesson(s, d, l.id, { status: 'came', note: cleanup(stripStatusWords(t)) || l.note });
      return;
    }
    M.updateLesson(s, d, l.id, { note: t });
  }

  function openEditor(td, initial = '') {
    closeEditor();
    const tr = td.closest('tr');
    const d = tr.dataset.date;
    const kind = td.dataset.kind;
    if (kind === 'add') {
      const day0 = M.getDay(s, d);
      pickStudent(s, {
        date: d, exclude: day0.lessons.map((l) => l.studentId).filter(Boolean),
        onPick: ({ studentId, newName }) => {
          const { id, ...fresh } = studentId ? M.newLessonFor(s, d, studentId, day0.lessons) : { name: newName, time: M.nextFreeTime(s, d), len: 30 };
          M.addLesson(s, d, fresh);
          app.save();
          refreshRow(d);
        },
        onPickMany: (ids) => { M.setDayLessons(s, d, [...day0.lessons, ...M.newLessonsFor(s, d, ids, day0.lessons)]); app.save(); refreshRow(d); },
      });
      return;
    }
    const day = M.getDay(s, d);
    const l = kind === 'lesson' ? day.lessons.find((x) => x.id === td.dataset.id) : null;
    const slotTime = kind === 'slot' ? fromMin(cols[Number(td.dataset.col)]) : null;
    let options = [];
    let placeholder = '';
    let value = initial;
    if (kind === 'lesson') {
      placeholder = l.note || (l.status ? M.statusById(s, l.status)?.name : '') || 'מקלידים, או בוחרים סטטוס';
      options = s.statuses.map((x) => ({ type: 'status', id: x.id, html: `<span class="chip" style="background:${e(x.bg)};color:${e(x.fg)}">${e(x.name)}</span>`, text: x.name }));
      options.push({ type: 'clear', html: '<span class="chip empty">ניקוי</span>', text: 'ניקוי' });
    } else if (kind === 'slot') {
      placeholder = `שם תלמיד ל-${slotTime}`;
      options = M.activeStudents(s, d).sort((a, b) => a.name.localeCompare(b.name, 'he')).map((x) => ({ type: 'student', id: x.id, html: e(x.name), text: x.name + ' ' + (x.aliases || []).join(' ') }));
    } else if (kind === 'hol') {
      placeholder = 'חופשה / טיול / היעדרות';
      if (!initial) value = day.holiday;
    } else if (kind === 'rem') {
      placeholder = 'הארות ושינויים';
      if (!initial) value = day.remark;
    }
    editor = el(`<div class="cell-editor" role="dialog">
      <div class="hint" style="margin-bottom:4px">${e(fmtDate(d))}${l ? ` · ${e(M.lessonName(s, l))} ${e(l.time)}` : slotTime ? ` · ${e(slotTime)}` : ''}</div>
      <input type="text" value="${e(value)}" placeholder="${e(placeholder)}" autocomplete="off" enterkeyhint="done">
      <ul role="listbox"></ul>
      ${l ? '<div class="more"><a href="#" data-full>פרטים מלאים</a><a href="#" data-del style="color:var(--danger)">הסר מהיום</a></div>' : ''}
    </div>`);
    document.body.appendChild(editor);
    const r = td.getBoundingClientRect();
    const w = 270;
    let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    let top = r.bottom + 4;
    if (top + 300 > window.innerHeight) top = Math.max(8, r.top - 304);
    Object.assign(editor.style, { left: left + 'px', top: top + 'px' });
    const input = editor.querySelector('input');
    const ul = editor.querySelector('ul');
    let active = -1;
    let shown = [];
    const renderOpts = () => {
      const q = norm(input.value);
      shown = options.filter((o) => !q || norm(o.text).includes(q) || norm(input.value).startsWith(norm(o.text)));
      if (kind === 'lesson' && !q) shown = options;
      if (active >= shown.length) active = shown.length - 1;
      if (q && active < 0 && shown.length && kind !== 'lesson') active = 0;
      if (q && kind === 'lesson' && shown.length === 1 && norm(shown[0].text).startsWith(q)) active = 0;
      ul.innerHTML = shown.slice(0, 30).map((o, i) => `<li role="option" data-i="${i}" aria-selected="${i === active}">${o.html}</li>`).join('');
      if (kind === 'slot' && input.value.trim() && !shown.some((o) => norm(o.text).startsWith(q))) {
        ul.insertAdjacentHTML('beforeend', `<li data-free="1" class="hint">Enter: שיעור עם "${e(input.value.trim())}"</li>`);
      }
    };
    renderOpts();
    const done = (moveDown = false) => {
      closeEditor();
      app.save();
      const nt = refreshRow(d);
      if (mode === 'list') return;
      const target = moveDown ? null : nt.querySelector(`[data-col="${td.dataset.col}"]`) || nt.querySelector('[data-col]');
      if (moveDown) {
        const nextTr = nt.nextElementSibling;
        const cell = nextTr && cellAtCol(nextTr, Number(td.dataset.col));
        (cell || nt.querySelector(`[data-col="${td.dataset.col}"]`))?.focus();
      } else target?.focus();
    };
    const choose = (o) => {
      if (o.type === 'status') M.updateLesson(s, d, l.id, { status: o.id });
      if (o.type === 'clear') M.updateLesson(s, d, l.id, { status: null, note: '' });
      if (o.type === 'student') {
        const st = M.studentById(s, o.id);
        const slot = st && (M.slotOn(st, d) || M.currentSlot(st, d));
        M.addLesson(s, d, { studentId: o.id, time: slotTime, timeSet: true, len: slot ? Number(slot.len) : 30 });
      }
      done(true);
    };
    ul.addEventListener('pointerdown', (ev) => ev.preventDefault());
    ul.addEventListener('click', (ev) => {
      const li = ev.target.closest('li');
      if (!li) return;
      if (li.dataset.free) { commitFree(); return; }
      choose(shown[Number(li.dataset.i)]);
    });
    const commitFree = () => {
      const t = input.value.trim();
      if (kind === 'lesson') { if (t) commitLessonText(d, l, t); }
      else if (kind === 'slot') { if (t) M.addLesson(s, d, { name: t, time: slotTime, len: 30, studentId: null }); }
      else if (kind === 'hol') { s.holidayOverride[d] = t; }
      else if (kind === 'rem') { s.days[d] = { ...(s.days[d] || {}), remark: t }; }
      done(true);
    };
    input.addEventListener('input', () => { active = -1; renderOpts(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); active = Math.min(shown.length - 1, active + 1); renderOpts(); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); active = Math.max(-1, active - 1); renderOpts(); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (active >= 0 && shown[active]) choose(shown[active]);
        else if (input.value.trim() || kind === 'hol' || kind === 'rem') commitFree();
        else { closeEditor(); td.focus(); }
      } else if (ev.key === 'Escape') { ev.preventDefault(); closeEditor(); td.focus(); }
      else if (ev.key === 'Tab') { ev.preventDefault(); if (input.value.trim()) commitFree(); else { closeEditor(); td.focus(); } }
    });
    editor.querySelector('[data-full]')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      closeEditor();
      editLesson(s, { date: d, lesson: l, onSave: (nl) => { M.updateLesson(s, d, l.id, nl); app.save(); refreshRow(d); }, onDelete: () => { M.removeLessons(s, d, [l.id]); app.save(); refreshRow(d); } });
    });
    editor.querySelector('[data-del]')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      M.removeLessons(s, d, [l.id]);
      done();
      toast('הוסר מהיום הזה');
    });
    // On a phone, picking a status is the usual tap; the keyboard opens only when tapping the text box.
    if (!(kind === 'lesson' && !initial && matchMedia('(pointer: coarse)').matches)) input.focus();
    if (initial) input.setSelectionRange(input.value.length, input.value.length);
  }

  const outside = (ev) => { if (editor && !editor.contains(ev.target)) closeEditor(); };
  document.addEventListener('pointerdown', outside, true);
  const obs = new MutationObserver(() => { if (!document.body.contains(wrap)) { document.removeEventListener('pointerdown', outside, true); closeEditor(); obs.disconnect(); } });
  obs.observe(document.getElementById('view'), { childList: true });
  gridWrap.addEventListener('scroll', closeEditor, { passive: true });

  body.addEventListener('click', (ev) => {
    const dc = ev.target.closest('td.c-date');
    if (dc) {
      const d = dc.closest('tr').dataset.date;
      closeEditor();
      reportDay(app, d, { onSaved: () => refreshRow(d) });
      return;
    }
    const td = ev.target.closest('[data-kind]');
    if (td) { td.focus(); openEditor(td); }
  });

  function cellAtCol(tr, col) {
    let best = null;
    for (const c of tr.querySelectorAll('[data-col]')) {
      const start = Number(c.dataset.col);
      const span = Number(c.getAttribute('colspan') || 1);
      if (col >= start && col < start + span) return c;
      if (start <= col) best = c;
    }
    return best;
  }
  body.addEventListener('keydown', (ev) => {
    const td = ev.target.closest('td[data-kind]');
    if (!td || editor || mode !== 'grid') return;
    const tr = td.closest('tr');
    const col = Number(td.dataset.col);
    let next = null;
    if (ev.key === 'ArrowLeft') next = td.nextElementSibling;
    else if (ev.key === 'ArrowRight') next = td.previousElementSibling;
    else if (ev.key === 'ArrowDown') next = tr.nextElementSibling && cellAtCol(tr.nextElementSibling, col);
    else if (ev.key === 'ArrowUp') next = tr.previousElementSibling && cellAtCol(tr.previousElementSibling, col);
    else if (ev.key === 'Enter' || ev.key === 'F2') { ev.preventDefault(); openEditor(td); return; }
    else if ((ev.key === 'Delete' || ev.key === 'Backspace') && td.dataset.kind === 'lesson') {
      ev.preventDefault();
      M.updateLesson(s, tr.dataset.date, td.dataset.id, { status: null, note: '' });
      app.save();
      refreshRow(tr.dataset.date).querySelector(`[data-col="${col}"]`)?.focus();
      return;
    } else if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      openEditor(td, ev.key);
      return;
    }
    if (next && next.matches('[data-kind]')) { ev.preventDefault(); next.focus(); next.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  });
}
