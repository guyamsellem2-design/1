// Sign in with an email and a password, so the phone and the computer share the same data.

import { escapeHtml as e } from './util.js';
import { el, openSheet, toast } from './ui.js';
import { signIn } from './sync.js';

export function openSignIn(app, { onDone } = {}) {
  const body = el(`<div>
    <p style="margin-top:0">מתחברים עם אותו מייל וסיסמה בטלפון ובמחשב, וכל מה שמדווחים מופיע בשניהם.</p>
    <label class="field"><span>מייל</span><input class="input" type="email" name="email" autocomplete="username" inputmode="email" dir="ltr" placeholder="name@gmail.com"></label>
    <label class="field"><span>סיסמה (לפחות 6 תווים)</span>
      <span style="display:flex;gap:6px;align-items:center;margin:0">
        <input class="input" type="password" name="pass" autocomplete="current-password" dir="ltr" style="min-width:0">
        <button type="button" class="btn small ghost" data-show>הצג</button>
      </span></label>
    <div data-msg class="hint" style="min-height:20px"></div>
    <div data-create hidden class="banner" style="flex-direction:column;align-items:stretch">
      <span data-create-text></span>
      <button type="button" class="btn primary" data-create-btn style="margin-top:8px;justify-content:center">כן, ליצור חשבון</button>
    </div>
  </div>`);
  const $ = (q) => body.querySelector(q);
  const msg = (t, err = true) => { $('[data-msg]').textContent = t; $('[data-msg]').style.color = err ? 'var(--danger)' : 'var(--ink-2)'; };
  $('[data-show]').addEventListener('click', () => {
    const p = $('[name=pass]');
    p.type = p.type === 'password' ? 'text' : 'password';
    $('[data-show]').textContent = p.type === 'password' ? 'הצג' : 'הסתר';
  });

  let sheet;
  let busy = false;
  const go = async (create) => {
    if (busy) return;
    const email = $('[name=email]').value.trim();
    const pass = $('[name=pass]').value;
    if (!email || !email.includes('@')) { msg('צריך לכתוב מייל'); return; }
    if (pass.length < 6) { msg('הסיסמה צריכה להיות לפחות 6 תווים'); return; }
    busy = true;
    msg(create ? 'יוצר חשבון…' : 'מתחבר…', false);
    const r = await signIn(email, pass, create);
    busy = false;
    if (r.needCreate) {
      msg('', false);
      $('[data-create-text]').innerHTML = `אין עדיין חשבון עם <b dir="ltr">${e(email)}</b>. ליצור חשבון חדש עם המייל והסיסמה האלה? כדאי לזכור את הסיסמה.`;
      $('[data-create]').hidden = false;
      return;
    }
    if (r.error) { msg(r.error); return; }
    sheet.close();
    toast(r.created ? 'החשבון נוצר. מעכשיו הכל נשמר גם בענן ✓' : r.merged ? 'התחברת. מה שהיה במכשיר הזה ומה שבענן אוחדו ✓' : 'התחברת. הנתונים נטענו ✓', 3500);
    app.render();
    onDone && onDone();
  };
  $('[data-create-btn]').addEventListener('click', () => go(true));
  body.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(false); } });

  sheet = openSheet({
    title: 'התחברות עם מייל',
    body,
    actions: [
      { label: 'כניסה', cls: 'primary', grow: true, onClick: () => go(false) },
      { label: 'ביטול', cls: 'ghost' },
    ],
  });
  setTimeout(() => $('[name=email]').focus(), 50);
  return sheet;
}
