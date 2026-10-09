// The whole school year as one sheet, like the yeshiva's Google Sheet:
// a row per work day, a column per 15 minutes (headers every half hour), merged cells per lesson.
// Click a cell and type, or pick a status - exactly like in Sheets. Same data as every other view.

import { escapeHtml as e, toMin, fromMin, todayISO, weekday, fmtDate, norm } from './util.js';
import * as M from './model.js';
import { detectStatus, stripStatusWords, cleanup } from './parser.js';
import { el, toast, editLesson } from './ui.js';
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

export function renderTable(app, root) {
  const s = app.state;
  const cols = slotColumns(s);
  const today = todayISO();
  const frame = getPref('tableFrame', '');
  const zoom = getPref('tableZoom', 1);
  const wrap = el(`<div>
    <div class="table-tools">
      <button class="btn small primary" data-export>⤓ הורד לאקסל</button>
      <button class="btn small" data-today>להיום</button>
      <select class="input" data-frame style="width:auto;min-height:34px;padding:2px 8px;font-size:14px">
        <option value="">כל המסגרות</option>${s.frames.map((f) => `<option value="${e(f.id)}" ${frame === f.id ? 'selected' : ''}>${e(f.name)}</option>`).join('')}
      </select>
      <span class="grow"></span>
      <button class="btn small ghost" data-zoom="-1" aria-label="הקטנה">−</button>
      <button class="btn small ghost" data-zoom="fit">התאם לרוחב</button>
      <button class="btn small ghost" data-zoom="1" aria-label="הגדלה">+</button>
    </div>
    <p class="hint" style="margin:0 16px 8px">לדיווח: לוחצים על <b>תאריך</b> כדי לסמן את כל היום, או על <b>תא</b> כדי להקליד או לבחור סטטוס לשיעור אחד. תא ריק = הוספת שיעור.</p>
    <div class="grid-wrap"><table class="grid"><thead></thead><tbody></tbody></table></div>
  </div>`);
  root.appendChild(wrap);
  const table = wrap.querySelector('table');
  const gridWrap = wrap.querySelector('.grid-wrap');

  // header
  const hr = document.createElement('tr');
  hr.innerHTML = `<th class="c-date">תאריך</th><th class="c-hol">חופשות, טיולים והיעדרויות מורה</th>`;
  for (let i = 0; i < cols.length;) {
    const t = cols[i];
    const span = t % 30 === 0 && i + 1 < cols.length ? 2 : 1;
    hr.insertAdjacentHTML('beforeend', `<th colspan="${span}" dir="ltr">${t % 30 === 0 ? fromMin(t) : ''}</th>`);
    i += span;
  }
  hr.insertAdjacentHTML('beforeend', '<th class="c-rem">הארות ושינויים</th>');
  table.tHead.appendChild(hr);

  const dates = M.yearDates(s);
  const body = table.tBodies[0];
  const frag = document.createDocumentFragment();
  let prevWeek = null;
  for (const d of dates) frag.appendChild(buildRow(s, d, cols, frame, today, prevWeek !== null && weekday(d) <= prevWeek));
  function buildRow(s, d, cols, frame, today, weekStart) {
    const day = M.getDay(s, d);
    prevWeek = weekday(d);
    const tr = document.createElement('tr');
    tr.dataset.date = d;
    if (d === today) tr.classList.add('today');
    if (day.holiday) tr.classList.add('holiday');
    if (weekStart) tr.classList.add('week-start');
    const lessons = day.lessons.filter((l) => frameOk(s, l, frame));
    const { placed, outside } = layoutRow(s, lessons, cols);
    let html = `<td class="c-date tap-date" title="דיווח על כל היום">${DAY_LETTER[weekday(d)]} ${fmtDate(d)}</td><td class="c-hol" tabindex="0" data-kind="hol" data-col="-1">${e(day.holiday)}</td>`;
    let c = 0;
    for (const p of placed) {
      for (; c < p.col; c++) html += `<td class="slot${cols[c] % 30 === 0 ? ' half' : ''}" tabindex="0" data-kind="slot" data-col="${c}"></td>`;
      const l = p.lesson;
      const st = l.status && M.statusById(s, l.status);
      const text = st ? st.name : (l.note || '');
      const style = st ? `background:${e(st.bg)};color:${e(st.fg)}` : '';
      html += `<td class="lesson" colspan="${p.span}" tabindex="0" data-kind="lesson" data-id="${e(l.id)}" data-col="${p.col}" title="${e(`${M.lessonName(s, l)} ${l.time} · ${l.len} דק׳${l.summary ? '\n' + l.summary : ''}${l.note && st ? '\n' + l.note : ''}`)}">
        <div class="cell ${st || text ? '' : 'blank'}" style="${style}"><span class="nm">${e(M.lessonName(s, l))}</span><span class="st">${e(text || '')}</span></div></td>`;
      c = p.col + p.span;
    }
    for (; c < cols.length; c++) html += `<td class="slot${cols[c] % 30 === 0 ? ' half' : ''}" tabindex="0" data-kind="slot" data-col="${c}"></td>`;
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
    const tr = buildRow(s, d, cols, frame, today, prevWeek !== null && weekday(d) <= prevWeek);
    if (old) old.replaceWith(tr);
    return tr;
  };

  // zoom
  const applyZoom = (z) => {
    table.style.setProperty('zoom', z);
    setPref('tableZoom', z);
  };
  applyZoom(zoom);
  wrap.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
    let z = Number(getPref('tableZoom', 1));
    if (b.dataset.zoom === 'fit') {
      table.style.setProperty('zoom', 1);
      z = Math.max(0.35, Math.min(1, gridWrap.clientWidth / table.scrollWidth));
    } else z = Math.max(0.35, Math.min(1.6, +(z + Number(b.dataset.zoom) * 0.15).toFixed(2)));
    applyZoom(z);
  }));

  const scrollToToday = (smooth) => {
    const target = dates.find((d) => d >= today) || dates[dates.length - 1];
    const tr = target && body.querySelector(`tr[data-date="${target}"]`);
    if (tr) {
      const z = Number(getPref('tableZoom', 1)) || 1;
      gridWrap.scrollTo({ top: Math.max(0, tr.offsetTop * z - 60), behavior: smooth ? 'smooth' : 'auto' });
    }
  };
  requestAnimationFrame(() => scrollToToday(false));
  wrap.querySelector('[data-today]').addEventListener('click', () => scrollToToday(true));
  wrap.querySelector('[data-frame]').addEventListener('change', (ev) => { setPref('tableFrame', ev.target.value); app.render(); });
  wrap.querySelector('[data-export]').addEventListener('click', () => openExport(app));

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
        M.addLesson(s, d, { studentId: o.id, time: slotTime, len: slot ? Number(slot.len) : 30 });
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
    input.focus();
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
    const td = ev.target.closest('td[data-kind]');
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
    if (!td || editor) return;
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
