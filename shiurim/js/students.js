// Students: list, add/edit (with "from date" for schedule changes), quick bulk add, history.

import { escapeHtml as e, DAY_NAMES, todayISO, fmtDate, fmtDay, norm, toMin, telHref } from './util.js';
import * as M from './model.js';
import { el, toast, openSheet, confirmDialog, chip, lenLabel } from './ui.js';

export function renderStudents(app, root) {
  const s = app.state;
  const today = todayISO();
  const list = M.activeStudents(s, today);
  const wrap = el(`<div>
    <div class="row-actions" style="margin:0 0 6px">
      <button class="btn primary" data-add>+ תלמיד</button>
      <button class="btn" data-bulk>הוספה מהירה של כמה</button>
    </div>
    <div data-groups></div>
  </div>`);
  root.appendChild(wrap);
  const groups = wrap.querySelector('[data-groups]');
  if (!list.length) {
    groups.appendChild(el(`<div class="empty-state"><div class="big">👥</div><p>עוד אין תלמידים.<br>הכי מהיר: "הוספה מהירה" והדבקה של הרשימה שכבר יש לך.</p></div>`));
  }
  for (const fr of s.frames) {
    const items = list.filter((st) => (st.frame || 'yeshiva') === fr.id).sort(sortBySlot(today));
    if (!items.length) continue;
    const box = el(`<div><div class="section-title"><span class="grow">${e(fr.name)}</span><span class="hint">${items.length}</span></div><ul class="list card"></ul></div>`);
    const ul = box.querySelector('ul');
    for (const st of items) {
      const v = M.currentSlot(st, today);
      const tel = telHref(st.phone);
      const li = el(`<li class="tap"><span class="grow"><b>${e(st.name)}</b>${st.grade ? ` <span class="tag">${e(st.grade)}</span>` : ''}${st.aliases?.length ? ` <span class="hint">(${e(st.aliases.join(', '))})</span>` : ''}</span>
        <span class="muted" style="font-size:14px">${v ? `${e(DAY_NAMES[v.day])} ${e(v.time)} · ${e(lenLabel(v.len))}` : 'בלי שעה קבועה'}</span>
        ${tel ? `<a class="icon-btn call" href="${e(tel)}" aria-label="להתקשר ל${e(st.name)}" title="${e(st.phone)}">📞</a>` : ''}<span>‹</span></li>`);
      li.addEventListener('click', (ev) => { if (!ev.target.closest('a.call')) editStudent(app, st); });
      ul.appendChild(li);
    }
    groups.appendChild(box);
  }
  wrap.querySelector('[data-add]').addEventListener('click', () => editStudent(app, null));
  wrap.querySelector('[data-bulk]').addEventListener('click', () => bulkAdd(app));
  if (app.params.bulk) { app.params.bulk = false; setTimeout(() => bulkAdd(app), 30); }
}

const sortBySlot = (date) => (a, b) => {
  const va = M.currentSlot(a, date);
  const vb = M.currentSlot(b, date);
  if (!va || !vb) return va ? -1 : vb ? 1 : a.name.localeCompare(b.name, 'he');
  return va.day - vb.day || toMin(va.time) - toMin(vb.time);
};

function defaultFrom(s) {
  // Before anything was reported, a new student belongs to the whole school year.
  return Object.keys(s.days).length ? todayISO() : s.settings.yearStart;
}

/**
 * Add (student = null) or edit a student.
 * opts: { name, day, time, len, from, onSaved(student, oneTimeOnly), oneTimeOption }
 */
export function editStudent(app, student, opts = {}) {
  const s = app.state;
  const today = todayISO();
  const isNew = !student;
  const v = student ? M.currentSlot(student, today) : null;
  const f = {
    name: student?.name || opts.name || '',
    aliases: (student?.aliases || []).join(', '),
    frame: student?.frame || 'yeshiva',
    day: v ? v.day : opts.day ?? s.settings.workDays[0],
    time: v ? v.time : opts.time || s.settings.dayStart,
    len: v ? Number(v.len) : Number(opts.len) || 30,
    notes: student?.notes || '',
    phone: student?.phone || '',
    grade: student?.grade || '',
    noSlot: student ? !v : !!opts.oneTimeOption,
  };
  const days = [...new Set([...s.settings.workDays.map(Number), Number(f.day)])].sort();
  const allDays = [0, 1, 2, 3, 4, 5].filter((d) => !days.includes(d));
  const body = el(`<div>
    <label class="field"><span>שם</span><input class="input" name="name" value="${e(f.name)}" autocomplete="off"></label>
    <div class="two">
      <label class="field"><span>טלפון</span><span style="display:flex;gap:6px;align-items:center;margin:0">
        <input class="input" type="tel" inputmode="tel" name="phone" value="${e(f.phone)}" placeholder="050-0000000" dir="ltr" autocomplete="off">
        <a class="btn call" data-call href="${e(telHref(f.phone) || '#')}" ${telHref(f.phone) ? '' : 'hidden'} aria-label="להתקשר">📞</a></span></label>
      <label class="field"><span>כיתה</span><input class="input" name="grade" value="${e(f.grade)}" placeholder="למשל: י׳2" autocomplete="off"></label>
    </div>
    <label class="field"><span>כינויים (איך שאני כותב אותו לפעמים, מופרד בפסיקים)</span><input class="input" name="aliases" value="${e(f.aliases)}" placeholder="למשל: בני, בנימין כ."></label>
    <div class="field"><span>מסגרת</span><div class="seg" data-frame>${s.frames.map((fr) => `<button type="button" data-v="${e(fr.id)}" aria-pressed="${f.frame === fr.id}">${e(fr.name)}</button>`).join('')}</div></div>
    <div class="field"><span>יום קבוע</span><div class="seg" data-day>${days.map((d) => `<button type="button" data-v="${d}" aria-pressed="${!f.noSlot && Number(f.day) === d}">${e(DAY_NAMES[d])}</button>`).join('')}
      ${allDays.length ? `<select class="input" data-otherday style="width:auto;min-height:38px;padding:4px 8px"><option value="">יום אחר…</option>${allDays.map((d) => `<option value="${d}">${e(DAY_NAMES[d])}</option>`).join('')}</select>` : ''}</div></div>
    <div class="two">
      <label class="field"><span>שעה קבועה</span><input class="input" type="time" step="300" name="time" value="${e(f.time)}" dir="ltr"></label>
      <div class="field"><span>אורך שיעור</span><div class="seg" data-len>${[30, 45, 60].map((n) => `<button type="button" data-v="${n}" aria-pressed="${f.len === n}">${n}</button>`).join('')}</div></div>
    </div>
    <div data-warn></div>
    ${!isNew ? `<label class="field" data-fromwrap hidden><span>השינוי ביום/שעה/אורך חל מתאריך (שיעורים שכבר עברו לא משתנים)</span><input class="input" type="date" name="from" value="${e(today)}"></label>` : ''}
    <label class="field"><span>הערות</span><textarea class="input" name="notes" rows="2">${e(f.notes)}</textarea></label>
    ${opts.oneTimeOption ? `<p class="hint" data-onetimehint style="margin-top:-6px">בלי יום קבוע: נכנס רק ליום הזה, והשם יזוהה מעכשיו בכתיבה. בחירת יום תהפוך אותו לשיעור קבוע.</p>` : ''}
    ${!isNew ? '<div data-history></div>' : ''}
  </div>`);
  const $ = (q) => body.querySelector(q);
  $('[name=phone]').addEventListener('input', (ev) => {
    const href = telHref(ev.target.value);
    const a = $('[data-call]');
    a.hidden = !href;
    if (href) a.href = href;
  });
  const press = (group, val) => body.querySelectorAll(`[data-${group}] button`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v) === String(val)));
  const slotChanged = () => !isNew && v && (Number(f.day) !== Number(v.day) || f.time !== v.time || Number(f.len) !== Number(v.len));
  const check = () => {
    const w = f.noSlot ? [] : M.overlaps(s, { day: f.day, time: f.time, len: f.len }, student?.id);
    $('[data-warn]').innerHTML = w.length ? `<div class="banner" style="background:var(--warn);color:var(--warn-ink)">⚠︎ חופף ל${e(w.map((x) => x.name).join(', '))} ב${e(DAY_NAMES[f.day])}</div>` : '';
    if ($('[data-fromwrap]')) $('[data-fromwrap]').hidden = !slotChanged();
  };
  body.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-v]');
    if (!b) return;
    const g = b.parentElement.dataset;
    if ('frame' in g) { f.frame = b.dataset.v; press('frame', f.frame); }
    if ('day' in g) {
      f.noSlot = !f.noSlot && Number(f.day) === Number(b.dataset.v) && !!opts.oneTimeOption;
      f.day = Number(b.dataset.v);
      press('day', f.noSlot ? -1 : f.day);
      $('[data-onetimehint]') && ($('[data-onetimehint]').hidden = !f.noSlot);
    }
    if ('len' in g) { f.len = Number(b.dataset.v); press('len', f.len); }
    check();
  });
  body.addEventListener('change', (ev) => {
    if (ev.target.name === 'time') { f.time = ev.target.value; check(); }
    if (ev.target.dataset.otherday != null && ev.target.value !== '') {
      f.day = Number(ev.target.value); f.noSlot = false;
      const seg = $('[data-day]');
      if (!seg.querySelector(`[data-v="${f.day}"]`)) seg.insertBefore(el(`<button type="button" data-v="${f.day}">${e(DAY_NAMES[f.day])}</button>`), ev.target);
      press('day', f.day); check();
    }
  });
  check();

  if (!isNew) renderHistory(s, student, $('[data-history]'));

  const actions = [{
    label: isNew ? 'הוסף' : 'שמור', cls: 'primary', grow: true, onClick: (close) => {
      const name = $('[name=name]').value.trim();
      if (!name) { toast('צריך שם'); return; }
      const aliases = $('[name=aliases]').value.split(',').map((x) => x.trim()).filter(Boolean);
      const notes = $('[name=notes]').value.trim();
      const phone = $('[name=phone]').value.trim();
      const grade = $('[name=grade]').value.trim();
      const dupe = s.students.find((x) => x !== student && !x.deleted && norm(x.name) === norm(name));
      if (dupe && isNew && !confirm(`כבר יש תלמיד בשם ${dupe.name}. להוסיף עוד אחד?`)) return;
      let st = student;
      if (isNew) {
        st = M.addStudent(s, { name, aliases, frame: f.frame, notes, phone, grade, day: f.noSlot ? null : f.day, time: f.time, len: f.len, from: opts.from && opts.from < defaultFrom(s) ? opts.from : defaultFrom(s) });
      } else {
        Object.assign(st, { name, aliases, frame: f.frame, notes, phone, grade });
        if (slotChanged() || (!v && !f.noSlot)) M.setSlot(st, { day: f.day, time: f.time, len: f.len }, $('[name=from]')?.value || today);
      }
      app.save();
      close();
      toast(isNew ? `${name} נוסף ✓` : 'נשמר ✓');
      if (opts.onSaved) opts.onSaved(st, false);
      else app.render();
    },
  }];
  if (!isNew) {
    actions.push({
      label: 'הסר', cls: 'ghost danger', onClick: async (close) => {
        if (!await confirmDialog(`להסיר את ${student.name} מהרשימה מהיום והלאה? השיעורים שכבר דווחו נשארים בטבלה ובהיסטוריה.`, 'הסר', true)) return;
        student.deleted = true;
        student.deletedFrom = today;
        app.save();
        close();
        app.render();
      },
    });
  }
  actions.push({ label: 'ביטול', cls: 'ghost' });
  openSheet({ title: isNew ? 'תלמיד חדש' : student.name, body, actions });
  if (isNew && !f.name) setTimeout(() => $('[name=name]').focus(), 50);
}

function renderHistory(s, student, box) {
  const hist = M.studentHistory(s, student.id).filter((l) => l.status || l.summary || l.note);
  if (!hist.length) { box.innerHTML = '<p class="hint">עוד אין שיעורים מדווחים לתלמיד הזה.</p>'; return; }
  const reported = hist.filter((l) => l.status);
  const came = reported.filter((l) => M.countsAsCame(s, l.status)).length;
  const pct = reported.length ? Math.round((came / reported.length) * 100) : 0;
  box.innerHTML = `<div class="section-title" style="margin-top:6px">היסטוריה · הגיע ל-${came} מתוך ${reported.length} (${pct}%)</div>
    <ul class="list card">${hist.slice(0, 40).map((l) => `<li style="align-items:flex-start;flex-direction:column;gap:2px">
      <div style="display:flex;gap:8px;align-items:center;width:100%"><b style="font-size:14px">${e(fmtDay(l.date))}</b><span class="grow"></span>${chip(s, l.status)}</div>
      ${l.summary ? `<div>${e(l.summary)}</div>` : ''}
      ${l.note ? `<div class="muted" style="font-size:14px">${e(l.note)}</div>` : ''}
      ${(l.tasks || []).map((t) => `<div class="hint">${t.done ? '☑' : '☐'} ${e(t.text)}</div>`).join('')}
    </li>`).join('')}</ul>`;
}

// "שלמה שלישי 14:00 30" per line → students. The list one already has, pasted once.
export function parseBulk(text, s) {
  const out = [];
  for (const raw of text.split('\n')) {
    let line = raw.trim().replace(/^[-•*\d.)\s]+(?=[א-ת])/, '');
    if (!line) continue;
    // Phone and class first, so their digits are not taken for a time.
    const pm = line.match(/(?:\+972[-\s]?|0)[2-9]\d?[-\s]?\d{3}[-\s]?\d{4}/);
    const phone = pm ? pm[0].trim() : '';
    if (pm) line = line.replace(pm[0], ' ');
    const gm = line.match(/(?:^|\s)כיתה\s+(\S+)/) || line.match(/(?:^|\s)(י["״][אב]\d?|(?:ט|י|יא|יב)['׳]\d?|(?:ט|י|יא|יב)\d)(?=\s|$|,)/);
    const grade = gm ? gm[1].replace(/,$/, '') : '';
    if (gm) line = line.replace(gm[0], ' ');
    line = line.replace(/\s+/g, ' ').trim();
    const dm = line.match(new RegExp(`(?:^|\\s)(?:יום\\s+)?(?:ב)?(${DAY_NAMES.join('|')})(?![\\u05D0-\\u05EA])`));
    const tm = line.match(/(\d{1,2}):(\d{2})|(?:^|\s)(\d{1,2})(?=\s|$)(?!\s*דק)/);
    const lm = line.match(/(\d{2,3})\s*(?:דק(?:ות|['׳])?|ד['׳])/) || line.match(/(?:^|\s)(30|45|60|90)(?=\s|$)/);
    const frame = /פרטי/.test(line) ? 'private' : /ישיבה/.test(line) ? 'yeshiva' : null;
    let name = line;
    const cut = [dm, tm].filter(Boolean).map((m) => m.index).sort((a, b) => a - b)[0];
    if (cut != null) name = line.slice(0, cut);
    name = name.replace(/[-–—:,]+\s*$/, '').replace(/\s*-\s*$/, '').trim();
    if (!name) continue;
    let time = null;
    if (tm) {
      let h = Number(tm[1] ?? tm[3]);
      const m = Number(tm[2] || 0);
      if (h <= 12 && h * 60 + m < toMin(s.settings.dayStart) - 90) h += 12;
      if (h <= 23) time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    let len = lm ? Number(lm[1]) : 30;
    if (tm && lm && lm.index === tm.index) len = 30;
    out.push({ name, day: dm ? DAY_NAMES.indexOf(dm[1]) : null, time, len, frame: frame || 'yeshiva', phone, grade });
  }
  return out;
}

function bulkAdd(app) {
  const s = app.state;
  const body = el(`<div>
    <p class="muted" style="margin-top:0">שורה לכל תלמיד: שם, יום, שעה, ואם רוצים גם אורך, כיתה, טלפון ו"פרטי". אפשר להדביק מהפתקים או מהאקסל.</p>
    <textarea class="input" rows="7" data-t placeholder="שלמה שלישי 14:00 30
בנימין שלישי 14:30 45
יוסף שלישי 15:15 כיתה י׳2
דוד שלישי 15:45 60 פרטי 050-1234567"></textarea>
    <div data-prev style="margin-top:10px"></div>
  </div>`);
  const ta = body.querySelector('[data-t]');
  const prev = body.querySelector('[data-prev]');
  let rows = [];
  const update = () => {
    rows = parseBulk(ta.value, s);
    prev.innerHTML = rows.length ? `<ul class="list card">${rows.map((r) => `<li><b class="grow">${e(r.name)}</b><span class="muted" style="font-size:14px">${r.day != null ? e(DAY_NAMES[r.day]) : '<span style="color:var(--danger)">בלי יום</span>'} ${e(r.time || '')} · ${r.len} דק׳${r.frame === 'private' ? ' · פרטי' : ''}${r.grade ? ` · ${e(r.grade)}` : ''}${r.phone ? ` · <span dir="ltr">${e(r.phone)}</span>` : ''}</span></li>`).join('')}</ul>` : '';
  };
  ta.addEventListener('input', update);
  openSheet({
    title: 'הוספה מהירה',
    body,
    actions: [
      {
        label: 'הוסף את כולם', cls: 'primary', grow: true, onClick: (close) => {
          if (!rows.length) { toast('לא זיהיתי שמות'); return; }
          const from = defaultFrom(s);
          for (const r of rows) M.addStudent(s, { name: r.name, frame: r.frame, phone: r.phone, grade: r.grade, day: r.day, time: r.time || (r.day != null ? s.settings.dayStart : null), len: r.len, from });
          const days = new Set(rows.map((r) => r.day).filter((d) => d != null));
          for (const d of days) if (!s.settings.workDays.includes(d)) s.settings.workDays.push(d);
          s.settings.workDays.sort();
          app.save();
          close();
          toast(`${rows.length} תלמידים נוספו ✓`);
          app.render();
        },
      },
      { label: 'ביטול', cls: 'ghost' },
    ],
  });
  setTimeout(() => ta.focus(), 50);
}

export { fmtDate };
