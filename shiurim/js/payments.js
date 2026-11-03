// Payments of private lessons: which lessons were paid and which not yet.
// The yeshiva pays a salary, so only frames marked "תשלום לכל שיעור" (פרטי) are involved.

import { escapeHtml as e, fmtDay, todayISO } from './util.js';
import * as M from './model.js';
import { el, openSheet, toast, callLinks } from './ui.js';

export const money = (n) => `₪${Math.round(n).toLocaleString('he-IL')}`;

// "3 שיעורים · ₪450", or just the count when the student has no price.
export function owedLabel(u) {
  const n = u.count === 1 ? 'שיעור אחד' : `${u.count} שיעורים`;
  return u.amount ? `${n} · ${money(u.amount)}` : n;
}

// The small toggle on a lesson card: "💰 שולם" / "₪ לא שולם".
export function payButton(l, attrs = 'data-pay') {
  return `<button type="button" class="pay-chip ${l.paid ? 'on' : ''}" ${attrs} aria-pressed="${!!l.paid}">${l.paid ? '💰 שולם' : '₪ לא שולם'}</button>`;
}

// A student's unpaid lessons: tick what was paid, or "שילם על הכל".
export function openPayments(app, studentId, { onDone } = {}) {
  const s = app.state;
  const today = todayISO();
  const u = M.unpaidByStudent(s, today).find((x) => x.student.id === studentId);
  const st = M.studentById(s, studentId);
  if (!st) return null;
  const lessons = u ? u.lessons : [];
  const price = Number(st.price) || 0;
  const body = el(`<div>
    <p class="muted" style="margin:-6px 0 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <span class="grow">${lessons.length ? `${e(owedLabel(u))} שעוד לא שולמו` : 'הכל שולם ✓'}</span>${callLinks(st)}</p>
    <ul class="list card pay-list">${lessons.map((l) => `<li><label class="grow" style="display:flex;align-items:center;gap:10px;cursor:pointer">
      <input type="checkbox" data-pay-id="${e(l.id)}" data-date="${e(l.date)}">
      <span class="grow">${e(fmtDay(l.date))} <span class="hint" dir="ltr">${e(l.time)}</span>${l.summary ? `<br><span class="hint">${e(l.summary)}</span>` : ''}</span>
      ${price ? `<span class="hint">${money(price)}</span>` : ''}</label></li>`).join('')}</ul>
    ${lessons.length > 1 ? '<p class="hint" style="margin:8px 2px 0">מסמנים את מה ששולם ולוחצים "שמור". שיעור שסומן בטעות אפשר להחזיר מהשיעור עצמו.</p>' : ''}
    ${price ? '' : `<p class="hint" style="margin:8px 2px 0">אפשר לכתוב מחיר לשיעור בכרטיס של ${e(st.name)} ברשימת התלמידים, ואז יופיע גם הסכום.</p>`}
  </div>`);
  const mark = (pairs) => {
    for (const { date, id } of pairs) M.setPaid(s, date, id, true, today);
    app.save();
    toast(pairs.length === 1 ? 'סומן ששולם ✓' : `${pairs.length} שיעורים סומנו ששולמו ✓`);
    onDone && onDone();
  };
  const actions = [];
  if (lessons.length === 1) {
    body.querySelector('[data-pay-id]').checked = true;
    actions.push({ label: 'שילם ✓', cls: 'primary', grow: true, onClick: (close) => { close(); mark([{ date: lessons[0].date, id: lessons[0].id }]); } });
  } else if (lessons.length) {
    actions.push({
      label: 'שמור', cls: 'primary', grow: true, onClick: (close) => {
        const picked = [...body.querySelectorAll('[data-pay-id]:checked')].map((x) => ({ date: x.dataset.date, id: x.dataset.payId }));
        close();
        if (picked.length) mark(picked);
      },
    });
    if (lessons.length > 1) {
      actions.push({ label: 'שילם על הכל', cls: '', onClick: (close) => { close(); mark(lessons.map((l) => ({ date: l.date, id: l.id }))); } });
    }
  }
  actions.push({ label: lessons.length ? 'ביטול' : 'סגור', cls: 'ghost' });
  return openSheet({ title: `💰 תשלומים · ${st.name}`, body, actions });
}

// The home page box: who still owes, oldest first. Nothing when everything is paid.
export function unpaidBox(app, render) {
  const list = M.unpaidByStudent(app.state);
  if (!list.length) return null;
  const total = list.reduce((a, u) => a + (u.amount || 0), 0);
  const box = el(`<div><div class="section-title"><span class="grow">💰 עוד לא שולם</span>${total ? `<span class="hint" style="font-weight:400">סה"כ ${money(total)}</span>` : ''}</div><ul class="list card"></ul></div>`);
  for (const u of list.slice(0, 12)) {
    const li = el(`<li class="tap"><span class="grow"><b>${e(u.student.name)}</b><br><span class="hint">מ-${e(fmtDay(u.oldest))}</span></span><span class="tag pay-tag">${e(owedLabel(u))}</span><span>‹</span></li>`);
    li.addEventListener('click', () => openPayments(app, u.student.id, { onDone: render }));
    box.querySelector('ul').appendChild(li);
  }
  return box;
}
