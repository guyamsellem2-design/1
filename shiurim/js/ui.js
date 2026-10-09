// Shared UI pieces: bottom sheets, toasts, status chips and the lesson editor.

import { escapeHtml as e, toMin, endTime, fmtDay, telHref } from './util.js';
import { statusById, activeStudents, lessonName, studentById } from './model.js';

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(msg, ms = 2400) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = el(`<div class="toast" role="status">${e(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

let sheetDepth = 0;
export function openSheet({ title, body, actions = [], onClose, wide = false }) {
  const scrim = el(`<div class="scrim"><div class="sheet" role="dialog" aria-modal="true" aria-label="${e(title || '')}"${wide ? ' style="max-width:900px"' : ''}><div class="grab"></div>${title ? `<h3>${e(title)}</h3>` : ''}<div class="body"></div><div class="foot"></div></div></div>`);
  const sheet = scrim.querySelector('.sheet');
  const bodyEl = sheet.querySelector('.body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.appendChild(body);
  const foot = sheet.querySelector('.foot');
  if (!actions.length) foot.remove();
  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    sheetDepth--;
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose(result);
  };
  const onKey = (ev) => {
    if (ev.key === 'Escape' && scrim === [...document.querySelectorAll('.scrim')].pop()) close();
  };
  for (const a of actions) {
    const b = el(`<button class="btn ${a.cls || ''}">${e(a.label)}</button>`);
    if (a.grow) b.classList.add('grow');
    b.addEventListener('click', () => a.onClick ? a.onClick(close, sheet) : close());
    foot.appendChild(b);
  }
  scrim.addEventListener('pointerdown', (ev) => { scrim._downOnScrim = ev.target === scrim; });
  scrim.addEventListener('click', (ev) => { if (ev.target === scrim && scrim._downOnScrim) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(scrim);
  sheetDepth++;
  return { close, sheet, body: bodyEl };
}

export function confirmDialog(text, okLabel = 'אישור', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet({
      title: '',
      body: `<p style="font-size:17px;margin:4px 0 6px">${e(text)}</p>`,
      actions: [
        { label: okLabel, cls: danger ? 'primary danger-bg' : 'primary', grow: true, onClick: (close) => { answered = true; resolve(true); close(); } },
        { label: 'ביטול', cls: 'ghost', onClick: (close) => { answered = true; resolve(false); close(); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

export function chip(state, statusId, attrs = '') {
  const st = statusId && statusById(state, statusId);
  if (!st) return `<span class="chip empty" ${attrs}>לא דווח</span>`;
  return `<span class="chip" style="background:${e(st.bg)};color:${e(st.fg)}" ${attrs}>${e(st.name)}</span>`;
}

export function chipButton(state, statusId, label, attrs = '') {
  const st = statusById(state, statusId);
  const style = st ? `background:${e(st.bg)};color:${e(st.fg)}` : '';
  return `<button type="button" class="chip" style="${style}" ${attrs}>${e(label || (st && st.name) || '')}</button>`;
}

// Dial buttons for a student and their parents (only the numbers that exist).
export function callLinks(st, { cls = 'btn small call', short = false } = {}) {
  if (!st) return '';
  const out = [];
  const me = telHref(st.phone);
  const parents = telHref(st.parentPhone);
  if (me) out.push(`<a class="${cls}" href="${e(me)}" aria-label="להתקשר ל${e(st.name)}" title="${e(st.phone)}">📞${short ? '' : ' להתקשר'}</a>`);
  if (parents) out.push(`<a class="${cls}" href="${e(parents)}" aria-label="להתקשר להורים של ${e(st.name)}" title="${e(st.parentPhone)}">📞 הורים</a>`);
  return out.join('');
}

export const timeRange = (l) => `${l.time}–${endTime(l.time, l.len)}`;

export function lenLabel(n) {
  return `${n} דק׳`;
}

// ---------- lesson editor ----------

/**
 * Edit one lesson in simple Hebrew fields. Works on a copy; onSave gets the edited lesson.
 */
export function editLesson(state, { date, lesson, title, onSave, onDelete, allowStudentChange = true }) {
  const l = JSON.parse(JSON.stringify(lesson));
  l.tasks = l.tasks || [];
  const students = activeStudents(state, date);
  const opts = students
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))
    .map((s) => `<option value="${e(s.id)}" ${s.id === l.studentId ? 'selected' : ''}>${e(s.name)}</option>`)
    .join('');
  const lens = [30, 45, 60];
  const isCustomLen = !lens.includes(Number(l.len));
  const body = el(`<div>
    <p class="muted" style="margin:-6px 0 12px;display:flex;align-items:center;gap:8px">${e(fmtDay(date))}${(() => {
      const st = l.studentId && studentById(state, l.studentId);
      return callLinks(st);
    })()}</p>
    ${allowStudentChange ? `<label class="field"><span>תלמיד</span>
      <select class="input" name="student"><option value="">— שם חופשי —</option>${opts}</select></label>
      <label class="field" data-free ${l.studentId ? 'hidden' : ''}><span>שם</span><input class="input" name="name" value="${e(l.name || '')}" placeholder="שם התלמיד"></label>` : ''}
    <div class="two">
      <label class="field"><span>שעה</span><input class="input" type="time" step="300" name="time" value="${e(l.time)}" dir="ltr"></label>
      <label class="field"><span>עד</span><input class="input" type="time" step="300" name="end" value="${e(endTime(l.time, l.len))}" dir="ltr"></label>
    </div>
    <div class="field"><span>אורך השיעור (רק בשיעור הזה)</span>
      <div class="seg" data-len>${lens.map((n) => `<button type="button" data-len="${n}" aria-pressed="${Number(l.len) === n}">${n}</button>`).join('')}
      <button type="button" data-len="other" aria-pressed="${isCustomLen}">${isCustomLen ? l.len + ' דק׳' : 'אחר'}</button></div></div>
    <div class="field"><span>נוכחות</span>
      <div class="seg" data-status>${state.statuses.map((s) => `<button type="button" data-status="${e(s.id)}" aria-pressed="${l.status === s.id}" style="${l.status === s.id ? `background:${e(s.bg)};color:${e(s.fg)};border-color:${e(s.bg)}` : ''}">${e(s.name)}</button>`).join('')}
      <button type="button" data-status="" aria-pressed="${!l.status}">בלי סטטוס</button></div></div>
    <label class="field"><span>מה עשינו (סיכום)</span><textarea class="input" name="summary" rows="2">${e(l.summary || '')}</textarea></label>
    <div class="field"><span>משימות לי</span><div data-tasks></div>
      <button type="button" class="btn small ghost" data-addtask>+ משימה</button></div>
    <label class="field"><span>הערה</span><textarea class="input" name="note" rows="2">${e(l.note || '')}</textarea></label>
  </div>`);

  const $ = (s) => body.querySelector(s);
  const renderTasks = () => {
    const box = $('[data-tasks]');
    box.innerHTML = l.tasks.map((t, i) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <input type="checkbox" data-done="${i}" ${t.done ? 'checked' : ''} aria-label="בוצע">
      <input class="input" data-task="${i}" value="${e(t.text)}" style="min-height:38px;padding:6px 10px">
      <button type="button" class="icon-btn" data-deltask="${i}" aria-label="מחק">✕</button></div>`).join('');
  };
  renderTasks();
  body.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.task != null) l.tasks[t.dataset.task].text = t.value;
  });
  body.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.dataset.done != null) l.tasks[t.dataset.done].done = t.checked;
    if (t.name === 'student') {
      l.studentId = t.value || null;
      $('[data-free]').hidden = !!l.studentId;
    }
    if (t.name === 'time') {
      const oldLen = Number(l.len);
      l.time = t.value || l.time;
      $('[name=end]').value = endTime(l.time, oldLen);
    }
    if (t.name === 'end') {
      const len = toMin(t.value) - toMin(l.time);
      if (len > 0) { l.len = len; syncLen(); }
    }
  });
  const syncLen = () => {
    body.querySelectorAll('[data-len] button').forEach((b) => {
      const v = b.dataset.len;
      const on = v === 'other' ? !lens.includes(Number(l.len)) : Number(v) === Number(l.len);
      b.setAttribute('aria-pressed', on);
      if (v === 'other') b.textContent = on ? `${l.len} דק׳` : 'אחר';
    });
    $('[name=end]').value = endTime(l.time, l.len);
  };
  body.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    if (b.dataset.len) {
      if (b.dataset.len === 'other') {
        const v = prompt('כמה דקות?', l.len);
        if (v && Number(v) > 0) l.len = Number(v);
      } else l.len = Number(b.dataset.len);
      syncLen();
    }
    if (b.dataset.status != null) {
      l.status = b.dataset.status || null;
      body.querySelectorAll('[data-status] button').forEach((x) => {
        const on = (x.dataset.status || null) === l.status;
        x.setAttribute('aria-pressed', on);
        const st = statusById(state, x.dataset.status);
        x.style.cssText = on && st ? `background:${st.bg};color:${st.fg};border-color:${st.bg}` : '';
      });
    }
    if (b.dataset.addtask != null) {
      l.tasks.push({ text: '', done: false });
      renderTasks();
      body.querySelector(`[data-task="${l.tasks.length - 1}"]`).focus();
    }
    if (b.dataset.deltask != null) {
      l.tasks.splice(Number(b.dataset.deltask), 1);
      renderTasks();
    }
  });

  const actions = [
    {
      label: 'שמור', cls: 'primary', grow: true, onClick: (close) => {
        l.summary = $('[name=summary]').value.trim();
        l.note = $('[name=note]').value.trim();
        if ($('[name=name]')) l.name = $('[name=name]').value.trim();
        l.tasks = l.tasks.filter((t) => t.text.trim());
        if (!l.studentId && !l.name) { toast('צריך לבחור תלמיד או לכתוב שם'); return; }
        close();
        onSave(l);
      },
    },
  ];
  if (onDelete) actions.push({ label: 'הסר מהיום', cls: 'ghost danger', onClick: (close) => { close(); onDelete(l); } });
  actions.push({ label: 'ביטול', cls: 'ghost' });
  const name = l.studentId ? (studentById(state, l.studentId)?.name || '') : l.name;
  return openSheet({ title: title || name || 'שיעור', body, actions });
}

export function pickStudent(state, { date, title = 'הוספת תלמיד ליום', exclude = [], onPick, allowNew = true }) {
  const body = el(`<div>
    <input class="input" type="search" placeholder="חיפוש לפי שם" autocomplete="off" data-q>
    <ul class="list card" data-list style="margin-top:10px;max-height:50vh;overflow:auto"></ul>
  </div>`);
  const q = body.querySelector('[data-q]');
  const list = body.querySelector('[data-list]');
  let sheet;
  const render = () => {
    const term = q.value.trim();
    const items = activeStudents(state, date)
      .filter((s) => !exclude.includes(s.id))
      .filter((s) => !term || s.name.includes(term) || (s.aliases || []).some((a) => a.includes(term)))
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
    list.innerHTML = items.map((s) => `<li class="tap" data-id="${e(s.id)}"><span class="grow">${e(s.name)}</span></li>`).join('')
      + (allowNew && term ? `<li class="tap" data-new="${e(term)}"><b>+ תלמיד חדש: ${e(term)}</b></li>` : '')
      + (!items.length && !term ? '<li class="muted">אין תלמידים ברשימה עדיין. כתבו שם כדי להוסיף.</li>' : '');
  };
  q.addEventListener('input', render);
  list.addEventListener('click', (ev) => {
    const li = ev.target.closest('li');
    if (!li) return;
    if (li.dataset.id) { sheet.close(); onPick({ studentId: li.dataset.id }); }
    if (li.dataset.new) { sheet.close(); onPick({ newName: li.dataset.new }); }
  });
  render();
  sheet = openSheet({ title, body, actions: [{ label: 'סגור', cls: 'ghost' }] });
  setTimeout(() => q.focus(), 50);
  return sheet;
}

export { lessonName };
