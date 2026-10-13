// The notebook: a page per student with everything written about him (notes, lesson plans, summaries,
// and what was written in the lesson reports), plus a page of general notes.

import { escapeHtml as e, todayISO, fmtDay, fmtDate, norm } from './util.js';
import * as M from './model.js';
import { el, openSheet, toast, confirmDialog, chip, editLesson, callLinks } from './ui.js';
import { getPref, setPref } from './store.js';

const GENERAL = 'general';
const kindName = (k) => (M.NOTE_KINDS.find((x) => x.id === k) || M.NOTE_KINDS[0]).name;
const KIND_STYLE = {
  note: 'background:#EEF2F7;color:#334155',
  plan: 'background:#E6ECF7;color:#2A4D8F',
  summary: 'background:#E7F3EC;color:#1E6B45',
};
const kindChip = (k) => `<span class="chip" style="${KIND_STYLE[k] || KIND_STYLE.note}">${e(kindName(k))}</span>`;

function preview(text, n = 70) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

// Lessons of a student that have something written in them.
function lessonEntries(s, studentId) {
  return M.studentHistory(s, studentId).filter((l) => l.summary || l.note || (l.tasks || []).length);
}

export function renderNotebook(app, root) {
  const who = app.params.who;
  if (who) return renderPage(app, root, who);
  renderIndex(app, root);
}

// ---------- the list: general + one row per student ----------

function renderIndex(app, root) {
  const s = app.state;
  const q = app.params.q || '';
  const wrap = el(`<div>
    <div class="row-actions" style="margin:0 0 10px;flex-wrap:nowrap">
      <input class="input" type="search" data-q placeholder="חיפוש בכל הפתקים" value="${e(q)}" style="flex:1;min-width:0">
      <button class="btn primary" data-new style="flex:none">+ פתק</button>
    </div>
    <div data-body></div>
  </div>`);
  root.appendChild(wrap);
  const body = wrap.querySelector('[data-body]');

  const paint = () => {
    const term = norm(wrap.querySelector('[data-q]').value);
    body.innerHTML = '';
    if (term) return paintSearch(app, body, term);

    const general = M.notesFor(s, null);
    const g = el(`<ul class="list card"><li class="tap" data-who="${GENERAL}">
      <span style="font-size:22px">📌</span>
      <span class="grow"><b>פתקים כלליים</b><br><span class="hint">${general.length ? `${general.length} · ${e(preview(general[0].text, 50))}` : 'רעיונות, שירים, דברים לזכור, שלא קשורים לתלמיד אחד'}</span></span><span>‹</span></li></ul>`);
    body.appendChild(g);

    const students = M.activeStudents(s).slice().sort((a, b) => a.name.localeCompare(b.name, 'he'));
    if (!students.length) {
      body.appendChild(el(`<p class="muted" style="margin:16px 4px">כשיהיו תלמידים ברשימה, לכל אחד יהיה כאן דף משלו.</p>`));
      return;
    }
    const box = el(`<div><div class="section-title">תלמידים</div><ul class="list card"></ul></div>`);
    const ul = box.querySelector('ul');
    for (const st of students) {
      const notes = M.notesFor(s, st.id);
      const lessons = lessonEntries(s, st.id);
      const latest = [...notes.map((n) => ({ d: n.date, t: n.text })), ...lessons.map((l) => ({ d: l.date, t: l.summary || l.note || (l.tasks[0] && l.tasks[0].text) }))]
        .sort((a, b) => (a.d < b.d ? 1 : -1))[0];
      const count = notes.length + lessons.length;
      ul.appendChild(el(`<li class="tap" data-who="${e(st.id)}">
        <span class="grow"><b>${e(st.name)}</b>${st.grade ? ` <span class="tag">${e(st.grade)}</span>` : ''}<br>
        <span class="hint">${latest ? `${e(fmtDate(latest.d))} · ${e(preview(latest.t, 46))}` : 'עוד לא נכתב כלום'}</span></span>
        ${count ? `<span class="tag">${count}</span>` : ''}<span>‹</span></li>`));
    }
    body.appendChild(box);
  };
  paint();

  wrap.querySelector('[data-q]').addEventListener('input', (ev) => { app.params.q = ev.target.value; paint(); });
  body.addEventListener('click', (ev) => {
    const li = ev.target.closest('[data-who]');
    if (li) app.go('notebook', { who: li.dataset.who });
  });
  wrap.querySelector('[data-new]').addEventListener('click', () => editNote(app, null, { onSaved: () => app.render() }));
}

function paintSearch(app, body, term) {
  const s = app.state;
  const hits = [];
  for (const n of s.notes || []) {
    if (norm(n.text).includes(term)) hits.push({ who: n.studentId || GENERAL, date: n.date, html: `${kindChip(n.kind)} ${e(preview(n.text, 90))}` });
  }
  for (const st of s.students) {
    if (norm(st.name).includes(term)) hits.push({ who: st.id, date: '9999', html: `<b>${e(st.name)}</b> · הדף של התלמיד` });
    for (const l of lessonEntries(s, st.id)) {
      const t = [l.summary, l.note, ...(l.tasks || []).map((x) => x.text)].join(' · ');
      if (norm(t).includes(term)) hits.push({ who: st.id, date: l.date, html: `<span class="tag">מהשיעור</span> ${e(preview(t, 90))}` });
    }
  }
  hits.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (!hits.length) { body.appendChild(el('<p class="muted" style="margin:16px 4px">לא נמצא.</p>')); return; }
  const ul = el('<ul class="list card"></ul>');
  for (const h of hits.slice(0, 80)) {
    const name = h.who === GENERAL ? 'כללי' : M.studentById(s, h.who)?.name || '';
    ul.appendChild(el(`<li class="tap" data-who="${e(h.who)}"><span class="grow">${h.html}<br><span class="hint">${e(name)}${h.date !== '9999' ? ` · ${e(fmtDate(h.date))}` : ''}</span></span><span>‹</span></li>`));
  }
  body.appendChild(ul);
}

// ---------- one page: a student's notebook, or the general one ----------

function renderPage(app, root, who) {
  const s = app.state;
  const st = who === GENERAL ? null : M.studentById(s, who);
  if (who !== GENERAL && !st) return app.go('notebook');
  const studentId = st ? st.id : null;
  const draftKey = `noteDraft.${who}`;
  const filter = getPref('notebookFilter', 'all');
  let kind = getPref(`noteKind.${who}`, st ? 'note' : 'note');

  const wrap = el(`<div>
    <div class="daynav" style="margin-bottom:8px">
      <button class="icon-btn" data-back aria-label="חזרה למחברת">›</button>
      <div class="title" style="text-align:start">${st ? `${e(st.name)}${st.grade ? ` <span class="tag">${e(st.grade)}</span>` : ''}` : '📌 פתקים כלליים'}
        <small>${st ? 'המחברת של התלמיד' : 'מה שלא שייך לתלמיד אחד'}</small></div>
      <span class="calls">${callLinks(st, { short: true })}</span>
    </div>
    <section class="page" style="margin-bottom:14px">
      <div class="seg" data-kind style="margin-bottom:6px">${M.NOTE_KINDS.map((k) => `<button type="button" data-k="${k.id}" aria-pressed="${kind === k.id}">${e(k.name)}</button>`).join('')}</div>
      <textarea class="write" data-text style="min-height:calc(var(--row) * 4)" placeholder="${st ? `מה כדאי לזכור על ${e(st.name)}? מה עשינו, מה מתכננים לשיעור הבא…` : 'רעיון, שיר ללמד, משהו לזכור…'}"></textarea>
      <div class="row-actions">
        <button class="btn primary" data-save>שמור פתק</button>
        <label class="hint">תאריך <input type="date" data-date value="${todayISO()}" style="font-size:14px;border:1px solid var(--border);border-radius:8px;padding:2px 6px"></label>
      </div>
    </section>
    ${st ? `<div class="seg" data-filter style="margin-bottom:8px">
      <button type="button" data-f="all" aria-pressed="${filter === 'all'}">הכל</button>
      <button type="button" data-f="notes" aria-pressed="${filter === 'notes'}">פתקים</button>
      <button type="button" data-f="lessons" aria-pressed="${filter === 'lessons'}">מהשיעורים</button>
    </div>` : ''}
    <div data-list></div>
  </div>`);
  root.appendChild(wrap);
  const $ = (q) => wrap.querySelector(q);
  const ta = $('[data-text]');
  ta.value = getPref(draftKey, '') || '';
  ta.addEventListener('input', () => setPref(draftKey, ta.value));

  $('[data-back]').addEventListener('click', () => app.go('notebook'));
  $('[data-kind]').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-k]');
    if (!b) return;
    kind = b.dataset.k;
    setPref(`noteKind.${who}`, kind);
    wrap.querySelectorAll('[data-kind] button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.k === kind));
  });
  $('[data-save]').addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    M.addNote(s, { studentId, kind, text, date: $('[data-date]').value || todayISO() });
    app.save();
    setPref(draftKey, '');
    toast('נשמר ✓');
    app.render();
  });
  $('[data-filter]')?.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-f]');
    if (!b) return;
    setPref('notebookFilter', b.dataset.f);
    app.render();
  });

  // The timeline: plans for what's ahead first, then everything else, newest first.
  const items = [];
  if (!st || filter !== 'lessons') {
    for (const n of M.notesFor(s, studentId)) items.push({ type: 'note', date: n.date, n });
  }
  if (st && filter !== 'notes') {
    for (const l of lessonEntries(s, st.id)) items.push({ type: 'lesson', date: l.date, l });
  }
  const today = todayISO();
  const ahead = items.filter((x) => x.type === 'note' && x.n.kind === 'plan' && x.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
  const rest = items.filter((x) => !ahead.includes(x)).sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

  const list = $('[data-list]');
  if (!items.length) {
    list.appendChild(el(`<p class="muted" style="margin:10px 4px">${st ? `עוד אין כאן כלום. מה שכותבים כאן, וגם מה שנכתב על ${e(st.name)} בדיווחים, יופיע כאן לפי תאריך.` : 'עוד אין פתקים כלליים.'}</p>`));
  }
  const card = (x) => {
    if (x.type === 'note') {
      const n = x.n;
      return el(`<div class="report-card note-card tap" data-note="${e(n.id)}">
        <div class="report-head">${kindChip(n.kind)}<span class="hint">${e(fmtDay(n.date))}</span></div>
        <div class="note-text">${e(n.text)}</div></div>`);
    }
    const l = x.l;
    return el(`<div class="report-card note-card tap from-lesson" data-lesson="${e(l.id)}" data-date="${e(l.date)}">
      <div class="report-head"><span class="tag">מהשיעור</span><span class="hint">${e(fmtDay(l.date))}</span><span class="grow"></span>${chip(s, l.status)}</div>
      ${l.summary ? `<div class="note-text">${e(l.summary)}</div>` : ''}
      ${l.note ? `<div class="note-text muted">${e(l.note)}</div>` : ''}
      ${(l.tasks || []).map((t) => `<div class="hint">${t.done ? '☑' : '☐'} ${e(t.text)}</div>`).join('')}</div>`);
  };
  if (ahead.length) {
    list.appendChild(el('<div class="section-title" style="margin-top:4px">לשיעורים הבאים</div>'));
    ahead.forEach((x) => list.appendChild(card(x)));
    if (rest.length) list.appendChild(el('<div class="section-title">קודם</div>'));
  }
  rest.forEach((x) => list.appendChild(card(x)));

  list.addEventListener('click', (ev) => {
    const nc = ev.target.closest('[data-note]');
    if (nc) {
      const n = (s.notes || []).find((x) => x.id === nc.dataset.note);
      if (n) editNote(app, n, { onSaved: () => app.render() });
      return;
    }
    const lc = ev.target.closest('[data-lesson]');
    if (lc) {
      const d = lc.dataset.date;
      const l = M.getDay(s, d).lessons.find((x) => x.id === lc.dataset.lesson);
      if (l) editLesson(s, { date: d, lesson: l, onSave: (nl) => { M.updateLesson(s, d, l.id, nl); app.save(); app.render(); } });
    }
  });
}

// ---------- new / edit note ----------

export function editNote(app, note, { studentId = null, onSaved } = {}) {
  const s = app.state;
  const isNew = !note;
  const f = { kind: note?.kind || 'note', studentId: note ? note.studentId : studentId, date: note?.date || todayISO(), text: note?.text || '' };
  const students = M.activeStudents(s).slice().sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const body = el(`<div>
    <label class="field"><span>של מי</span><select class="input" name="who"><option value="">📌 כללי</option>${students.map((x) => `<option value="${e(x.id)}" ${x.id === f.studentId ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select></label>
    <div class="field"><span>סוג</span><div class="seg" data-kind>${M.NOTE_KINDS.map((k) => `<button type="button" data-k="${k.id}" aria-pressed="${f.kind === k.id}">${e(k.name)}</button>`).join('')}</div></div>
    <label class="field"><span>תאריך</span><input class="input" type="date" name="date" value="${e(f.date)}"></label>
    <label class="field"><span>טקסט</span><textarea class="input" name="text" rows="7">${e(f.text)}</textarea></label>
  </div>`);
  body.querySelector('[data-kind]').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-k]');
    if (!b) return;
    f.kind = b.dataset.k;
    body.querySelectorAll('[data-kind] button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.k === f.kind));
  });
  const actions = [{
    label: 'שמור', cls: 'primary', grow: true, onClick: (close) => {
      const text = body.querySelector('[name=text]').value.trim();
      if (!text) { toast('הפתק ריק'); return; }
      const patch = { kind: f.kind, studentId: body.querySelector('[name=who]').value || null, date: body.querySelector('[name=date]').value || todayISO(), text };
      if (isNew) M.addNote(s, patch); else M.updateNote(s, note.id, patch);
      app.save();
      close();
      toast('נשמר ✓');
      onSaved && onSaved();
    },
  }];
  if (!isNew) {
    actions.push({
      label: 'מחק', cls: 'ghost danger', onClick: async (close) => {
        if (!await confirmDialog('למחוק את הפתק?', 'מחק', true)) return;
        M.deleteNote(s, note.id);
        app.save();
        close();
        onSaved && onSaved();
      },
    });
  }
  actions.push({ label: 'ביטול', cls: 'ghost' });
  openSheet({ title: isNew ? 'פתק חדש' : 'פתק', body, actions });
  if (isNew) setTimeout(() => body.querySelector('[name=text]').focus(), 50);
}
