// Gigs: an optional tab (turned on in settings). Offers, quotes, agreed gigs with tasks and free notes,
// "done", and the money after it: invoice / payment request, payment, receipt.

import { escapeHtml as e, fmtDay, fmtDate, todayISO, telHref, addDays } from './util.js';
import * as M from './model.js';
import { el, openSheet, toast, confirmDialog } from './ui.js';

const money = (n) => `₪${Math.round(Number(n)).toLocaleString('he-IL')}`;
const stageName = (id) => (M.GIG_STAGES.find((x) => x.id === id) || M.GIG_STAGES[0]).name;
const STAGE_CLS = { offer: 'gs-offer', quoted: 'gs-quoted', booked: 'gs-booked', done: 'gs-done', lost: 'gs-lost' };

function whenWhere(g) {
  const bits = [];
  if (g.date) bits.push(`${fmtDay(g.date)}${g.time ? ` ב-${g.time}` : ''}`);
  else bits.push('בלי תאריך');
  if (g.place) bits.push(g.place);
  if (g.fee) bits.push(money(g.fee));
  return bits.join(' · ');
}

// The small chips under a gig: what is done and what is left about the money, open tasks.
function gigChips(g) {
  const c = [];
  const n = M.gigOpenTasks(g);
  if (n && g.stage !== 'done' && g.stage !== 'lost') c.push(`<span class="tag">☐ ${n === 1 ? 'משימה אחת' : `${n} משימות`}</span>`);
  if (g.stage === 'done' || g.stage === 'booked') {
    if (g.invoice === 'need') c.push('<span class="tag gm-todo">חשבון עסקה: להוציא</span>');
    if (g.invoice === 'sent') c.push('<span class="tag gm-ok">חשבון עסקה ✓</span>');
    if (g.stage === 'done') c.push(g.paid ? '<span class="tag gm-ok">שולם ✓</span>' : '<span class="tag gm-todo">לא שולם</span>');
    if (g.receipt === 'need') c.push('<span class="tag gm-todo">קבלה: להוציא</span>');
    if (g.receipt === 'sent') c.push('<span class="tag gm-ok">קבלה ✓</span>');
  }
  return c.join(' ');
}

function gigRow(g, { markDone = false } = {}) {
  return el(`<li class="tap gig-row" data-gig="${e(g.id)}">
    <span class="grow"><b>${e(g.title || 'גיג')}</b> <span class="tag ${STAGE_CLS[g.stage] || ''}">${e(stageName(g.stage))}</span>
      <br><span class="hint">${e(whenWhere(g))}</span>
      ${gigChips(g) ? `<span class="gig-chips">${gigChips(g)}</span>` : ''}</span>
    ${markDone ? '<button type="button" class="btn small" data-done>בוצע ✓</button>' : ''}<span>‹</span></li>`);
}

export function renderGigs(app, root) {
  const s = app.state;
  const today = todayISO();
  const G = M.gigGroups(s, today);
  const year = (s.gigs || []).filter((g) => g.stage === 'done' && (g.date || '').slice(0, 4) === today.slice(0, 4));
  const paidSum = year.filter((g) => g.paid).reduce((a, g) => a + (Number(g.fee) || 0), 0);
  const wrap = el(`<div>
    <div class="row-actions" style="margin:0 0 6px">
      <button class="btn primary" data-new>+ גיג חדש</button>
      ${year.length ? `<span class="hint" style="align-self:center">${today.slice(0, 4)}: ${year.length === 1 ? 'גיג אחד' : `${year.length} גיגים`}${paidSum ? ` · שולם ${money(paidSum)}` : ''}</span>` : ''}
    </div>
    <div data-list></div>
  </div>`);
  root.appendChild(wrap);
  const list = wrap.querySelector('[data-list]');
  const section = (title, gigs, opts = {}) => {
    if (!gigs.length) return;
    const box = el(`<div><div class="section-title"><span class="grow">${title}</span><span class="hint">${gigs.length}</span></div><ul class="list card"></ul></div>`);
    gigs.forEach((g) => box.querySelector('ul').appendChild(gigRow(g, opts)));
    if (opts.collapsed) {
      const d = el(`<details class="gig-more"><summary>${title} (${gigs.length})</summary></details>`);
      d.appendChild(box.querySelector('ul'));
      list.appendChild(d);
    } else list.appendChild(box);
  };
  section('עבר התאריך: לסמן שבוצע?', G.past, { markDone: true });
  section('🎤 עומדים לקרות', G.upcoming);
  section('💬 הצעות', G.offers);
  section('💰 בוצע: כסף פתוח', G.money);
  section('סגור ✓', G.closed, { collapsed: true });
  section('לא יצא', G.lost, { collapsed: true });
  if (!(s.gigs || []).length) {
    list.appendChild(el(`<div class="empty-state"><div class="big">🎤</div><p>עוד אין גיגים.<br>כל הצעה שמגיעה, גם אם עוד לא בטוחה, אפשר לרשום כאן: מתי, איפה, כמה, ומה צריך להכין.</p></div>`));
  }
  wrap.querySelector('[data-new]').addEventListener('click', () => editGig(app, null));
  list.addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-gig]');
    if (!row) return;
    const g = (s.gigs || []).find((x) => x.id === row.dataset.gig);
    if (!g) return;
    if (ev.target.closest('[data-done]')) {
      M.updateGig(s, g.id, { stage: 'done' });
      app.save();
      toast('סומן שבוצע ✓');
      app.render();
      return;
    }
    editGig(app, g);
  });
}

// Add (gig = null) or edit a gig.
export function editGig(app, gig, { onSaved } = {}) {
  const s = app.state;
  const isNew = !gig;
  const g = gig ? JSON.parse(JSON.stringify(gig)) : M.newGig();
  g.tasks = g.tasks || [];
  const seg = (name, options, value) => `<div class="seg" data-seg="${name}">${options.map(([v, label]) => `<button type="button" data-v="${e(v)}" aria-pressed="${String(value) === String(v)}">${e(label)}</button>`).join('')}</div>`;
  const body = el(`<div>
    <label class="field"><span>מה</span><input class="input" name="title" value="${e(g.title)}" placeholder="למשל: חתונה של משפחת כהן, ערב שירה בקפה" autocomplete="off"></label>
    <div class="two">
      <label class="field"><span>תאריך</span><input class="input" type="date" name="date" value="${e(g.date)}"></label>
      <label class="field"><span>שעה</span><input class="input" type="time" step="300" name="time" value="${e(g.time)}" dir="ltr"></label>
    </div>
    <label class="field"><span>מקום</span><input class="input" name="place" value="${e(g.place)}" autocomplete="off"></label>
    <div class="two">
      <label class="field"><span>איש קשר</span><input class="input" name="contact" value="${e(g.contact)}" autocomplete="off"></label>
      <label class="field"><span>טלפון</span><span style="display:flex;gap:6px;align-items:center;margin:0">
        <input class="input" type="tel" inputmode="tel" name="phone" value="${e(g.phone)}" dir="ltr" placeholder="050-0000000" style="min-width:0">
        <a class="btn call" data-call href="${e(telHref(g.phone) || '#')}" ${telHref(g.phone) ? '' : 'hidden'} aria-label="חיוג" style="padding:9px 12px">📞</a></span></label>
    </div>
    <label class="field"><span>סכום ₪</span><input class="input" type="number" inputmode="numeric" min="0" step="50" name="fee" value="${e(g.fee ?? '')}" dir="ltr"></label>
    <div class="field"><span>שלב</span>${seg('stage', M.GIG_STAGES.map((x) => [x.id, x.name]), g.stage)}</div>
    <div class="gig-money" data-money>
      <div class="field"><span>חשבון עסקה / דרישת תשלום</span>${seg('invoice', [['no', 'לא צריך'], ['need', 'צריך להוציא'], ['sent', 'הוצא ✓']], g.invoice)}</div>
      <div class="field"><span>תשלום</span>${seg('paid', [['false', 'עוד לא'], ['true', 'שולם ✓']], !!g.paid)}</div>
      <div class="field"><span>קבלה</span>${seg('receipt', [['no', 'לא צריך'], ['need', 'צריך להוציא'], ['sent', 'הוצאה ✓']], g.receipt)}</div>
    </div>
    <div class="field"><span>משימות לקראת הגיג</span><div data-tasks></div>
      <button type="button" class="btn small ghost" data-addtask>+ משימה</button></div>
    <label class="field"><span>הערות</span><textarea class="input" name="notes" rows="4" placeholder="רפרטואר, ציוד, הסעה, מה סוכם, פרטים לחשבונית…">${e(g.notes)}</textarea></label>
  </div>`);
  const $ = (q) => body.querySelector(q);
  const showMoney = () => { $('[data-money]').hidden = !['booked', 'done'].includes(g.stage); };
  showMoney();
  $('[name=phone]').addEventListener('input', (ev) => {
    const href = telHref(ev.target.value);
    $('[data-call]').hidden = !href;
    if (href) $('[data-call]').href = href;
  });
  const renderTasks = () => {
    $('[data-tasks]').innerHTML = g.tasks.map((t, i) => `<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <input type="checkbox" data-done="${i}" ${t.done ? 'checked' : ''} aria-label="בוצע">
      <input class="input" data-task="${i}" value="${e(t.text)}" style="min-height:38px;padding:6px 10px">
      <button type="button" class="icon-btn" data-deltask="${i}" aria-label="מחק">✕</button></div>`).join('');
  };
  renderTasks();
  body.addEventListener('input', (ev) => { if (ev.target.dataset.task != null) g.tasks[ev.target.dataset.task].text = ev.target.value; });
  body.addEventListener('change', (ev) => { if (ev.target.dataset.done != null) g.tasks[ev.target.dataset.done].done = ev.target.checked; });
  body.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const segEl = b.closest('[data-seg]');
    if (segEl && b.dataset.v != null) {
      const k = segEl.dataset.seg;
      g[k] = k === 'paid' ? b.dataset.v === 'true' : b.dataset.v;
      segEl.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      if (k === 'stage') showMoney();
    }
    if (b.dataset.addtask != null) {
      g.tasks.push({ text: '', done: false });
      renderTasks();
      body.querySelector(`[data-task="${g.tasks.length - 1}"]`).focus();
    }
    if (b.dataset.deltask != null) { g.tasks.splice(Number(b.dataset.deltask), 1); renderTasks(); }
  });

  const actions = [{
    label: isNew ? 'הוסף' : 'שמור', cls: 'primary', grow: true, onClick: (close) => {
      for (const k of ['title', 'date', 'time', 'place', 'contact', 'phone', 'notes']) g[k] = $(`[name=${k}]`).value.trim();
      const fee = Number($('[name=fee]').value);
      g.fee = fee > 0 ? fee : null;
      g.tasks = g.tasks.filter((t) => t.text.trim());
      if (!g.title && !g.date && !g.place) { toast('צריך לפחות מה, מתי או איפה'); return; }
      if (g.paid && !gig?.paid) g.paidOn = todayISO();
      if (!g.paid) g.paidOn = null;
      if (isNew) { s.gigs = s.gigs || []; s.gigs.push(g); } else M.updateGig(s, g.id, g);
      app.save();
      close();
      toast(isNew ? 'הגיג נוסף ✓' : 'נשמר ✓');
      if (onSaved) onSaved(g); else app.render();
    },
  }];
  if (!isNew) {
    actions.push({
      label: 'מחק', cls: 'ghost danger', onClick: async (close) => {
        if (!await confirmDialog(`למחוק את "${gig.title || 'הגיג'}"?`, 'מחק', true)) return;
        M.deleteGig(s, gig.id);
        app.save();
        close();
        if (onSaved) onSaved(null); else app.render();
      },
    });
  }
  actions.push({ label: 'ביטול', cls: 'ghost' });
  openSheet({ title: isNew ? 'גיג חדש' : (gig.title || 'גיג'), body, actions });
  if (isNew) setTimeout(() => $('[name=title]').focus(), 50);
}

// The home page box (when the tab is on): gigs in the next two weeks, past ones to mark done, money to close.
export function gigsHomeBox(app, render) {
  const s = app.state;
  if (!s.settings.showGigs || !(s.gigs || []).length) return null;
  const today = todayISO();
  const G = M.gigGroups(s, today);
  const soon = G.upcoming.filter((g) => g.date && g.date <= addDays(today, 14));
  const items = [
    ...G.past.map((g) => ({ g, note: 'עבר התאריך: בוצע?' })),
    ...soon.map((g) => ({ g, note: M.gigOpenTasks(g) ? `☐ ${M.gigOpenTasks(g)} משימות פתוחות` : '' })),
    ...G.money.map((g) => ({ g, note: `💰 ${M.gigMoneyTodo(g).join(', ')}` })),
  ];
  if (!items.length) return null;
  const box = el(`<div><div class="section-title"><span class="grow">🎤 גיגים</span><button class="btn small ghost" data-all>לכל הגיגים ←</button></div><ul class="list card"></ul></div>`);
  for (const { g, note } of items.slice(0, 8)) {
    const li = el(`<li class="tap"><span class="grow"><b>${e(g.title || 'גיג')}</b><br><span class="hint">${e(g.date ? `${fmtDate(g.date)}${g.time ? ` ${g.time}` : ''}` : 'בלי תאריך')}${g.place ? ` · ${e(g.place)}` : ''}${note ? ` · ${e(note)}` : ''}</span></span><span>‹</span></li>`);
    li.addEventListener('click', () => editGig(app, g, { onSaved: render }));
    box.querySelector('ul').appendChild(li);
  }
  box.querySelector('[data-all]').addEventListener('click', () => app.go('gigs'));
  return box;
}
