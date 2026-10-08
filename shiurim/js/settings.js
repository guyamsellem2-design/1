// Settings: teacher, work days and hours, statuses, holidays, frames, photo reading, sharing, backup.

import { escapeHtml as e, DAY_NAMES, uid, fmtDateFull, todayISO } from './util.js';
import * as M from './model.js';
import { el, toast, openSheet, confirmDialog } from './ui.js';
import { backupBlob, readBackup, getPref, setPref } from './store.js';
import { getApiKey, setApiKey, testApiKey } from './ocr.js';
import { openExport } from './export.js';

export function renderSettings(app, root) {
  const s = app.state;
  const st = s.settings;
  const lastBackup = getPref('lastBackup');
  const wrap = el(`<div>
    <div class="section-title">פרטים (מופיעים בקישור לבוס ובקובץ האקסל)</div>
    <div class="card" style="padding:14px">
      <div class="two">
        <label class="field"><span>שם המורה</span><input class="input" data-k="teacher.name" value="${e(s.teacher.name)}"></label>
        <label class="field"><span>מה מלמד</span><input class="input" data-k="teacher.subject" value="${e(s.teacher.subject)}"></label>
      </div>
    </div>

    <div class="section-title">ימי עבודה ושעות</div>
    <div class="card" style="padding:14px">
      <div class="field"><span>ימי עבודה</span><div class="seg" data-days>${[0, 1, 2, 3, 4, 5].map((d) => `<button type="button" data-d="${d}" aria-pressed="${st.workDays.includes(d)}">${e(DAY_NAMES[d])}</button>`).join('')}</div></div>
      <div class="two">
        <label class="field"><span>שעת התחלה</span><input class="input" type="time" step="900" data-k="settings.dayStart" value="${e(st.dayStart)}" dir="ltr"></label>
        <label class="field"><span>שעת סיום</span><input class="input" type="time" step="900" data-k="settings.dayEnd" value="${e(st.dayEnd)}" dir="ltr"></label>
      </div>
      <div class="two">
        <label class="field"><span>תחילת שנת הלימודים</span><input class="input" type="date" data-k="settings.yearStart" value="${e(st.yearStart)}"></label>
        <label class="field"><span>סוף שנת הלימודים</span><input class="input" type="date" data-k="settings.yearEnd" value="${e(st.yearEnd)}"></label>
      </div>
    </div>

    <div class="section-title"><span class="grow">סטטוסים של נוכחות</span><button class="btn small ghost" data-resetstatus>ברירת מחדל</button></div>
    <div class="card" style="padding:14px">
      <div class="hint" style="margin-bottom:8px">שם · רקע · טקסט. הצבעים כמו בקובץ של הישיבה.</div>
      <div data-statuses></div>
      <button class="btn small" data-addstatus>+ סטטוס</button>
    </div>

    <div class="section-title"><span class="grow">חופשות</span><button class="btn small ghost" data-loadhol>טען לוח תשפ"ז</button></div>
    <div class="card" style="padding:14px">
      <div class="hint" style="margin-bottom:8px">לפי לוח משרד החינוך לתיכונים. ביום חופש לא נוצרים שיעורים, והשם מופיע בעמודת החופשות. כדאי לעבור ולוודא מול לוח הישיבה.</div>
      <div data-hols></div>
      <button class="btn small" data-addhol>+ חופשה / טיול / היעדרות</button>
    </div>

    <div class="section-title">מסגרות</div>
    <div class="card" style="padding:14px">
      <div data-frames></div>
      <button class="btn small" data-addframe>+ מסגרת (למשל בית ספר אחר)</button>
    </div>

    <div class="section-title">יצוא</div>
    <div class="card" style="padding:14px">
      <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" data-exportnames ${st.exportNames ? 'checked' : ''}> לכתוב את שם התלמיד בתא לצד הסטטוס</label>
      <div class="row-actions"><button class="btn" data-export>הורד לאקסל…</button></div>
    </div>

    <div class="section-title" id="ai">צילום מחברת (קריאת כתב יד)</div>
    <div class="card" style="padding:14px">
      <p style="margin-top:0">טקסט שכותבים או מדביקים מפוענח <b>במכשיר עצמו</b>, בחינם ובלי לשלוח שמות לשום מקום. רק תמונה של כתב יד צריכה בינה מלאכותית (Claude) כדי להפוך לטקסט.</p>
      <p class="muted" style="font-size:14px">עלות: בערך 2-3 סנט לתמונה, כלומר בערך שקל וחצי בחודש אם מצלמים שלוש פעמים בשבוע. המפתח נשמר רק בדפדפן הזה. מקבלים מפתח ב-<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a> ‏(צריך להטעין שם 5$, שיספיקו ליותר משנה).</p>
      <label class="field"><span>מפתח Claude API</span><input class="input" type="password" data-apikey value="${e(getApiKey())}" placeholder="sk-ant-..." dir="ltr" autocomplete="off"></label>
      <div class="row-actions"><button class="btn" data-savekey>שמור מפתח</button><button class="btn ghost" data-testkey>בדיקה</button></div>
    </div>

    <div class="section-title">שליחה ישר מהפתקים בטלפון</div>
    <div class="card" style="padding:14px">
      <details class="help" style="margin:0 0 8px" open><summary>אנדרואיד</summary>
        <ol><li>פותחים את האתר בכרום ← תפריט ⋮ ← "הוספה למסך הבית" / "התקנת אפליקציה".</li>
        <li>מעכשיו, בפתק: "שיתוף" ← "שיעורים". הטקסט (או התמונה) נכנס ישר לתיבה.</li></ol></details>
      <details class="help" style="margin:0"><summary>אייפון</summary>
        <p class="muted" style="font-size:14px">באייפון אתרים לא יכולים להופיע ברשימת השיתוף, אז עושים קיצור דרך פעם אחת (דקה):</p>
        <ol>
          <li>בספארי: כפתור השיתוף ← "הוסף למסך הבית".</li>
          <li>פותחים את אפליקציית <b>קיצורים</b> ← + ← "הוסף פעולה".</li>
          <li>למעלה, לוחצים על שם הקיצור ← "הצג בגיליון השיתוף" ← סוג קלט: <b>טקסט</b>. קוראים לו "שיעורים".</li>
          <li>מוסיפים פעולה <b>"קידוד URL"</b> (URL Encode) על "קלט קיצור הדרך".</li>
          <li>מוסיפים פעולה <b>"פתח כתובות URL"</b> עם הכתובת:<br><code class="kbd" dir="ltr" style="word-break:break-all" data-shortcut-url></code><br>ובסוף הכתובת מכניסים את המשתנה "טקסט מקודד".</li>
          <li>מעכשיו, בפתק: שיתוף ← "שיעורים".</li>
        </ol>
        <button class="btn small" data-copyurl>העתק את הכתובת</button>
      </details>
    </div>

    <div class="section-title">גיבוי</div>
    <div class="card" style="padding:14px">
      <p style="margin-top:0">כרגע הכל שמור <b>במכשיר הזה</b>. כדי שלא יאבד ושיהיה גם במחשב, כדאי להוריד גיבוי מדי פעם (או לחבר ענן, בהמשך).</p>
      <p class="hint">גיבוי אחרון: ${lastBackup ? e(fmtDateFull(lastBackup)) : 'עוד לא'}</p>
      <div class="row-actions"><button class="btn" data-backup>הורד גיבוי</button><button class="btn ghost" data-restore>שחזור מקובץ</button></div>
    </div>

    <div class="section-title">ענן (מהטלפון ומהמחשב יחד)</div>
    <div class="card" style="padding:14px">
      <p style="margin-top:0" class="muted">עוד לא מחובר. הפרויקט ב-Supabase שלך מושהה, וכדי להפעיל אותו צריך אישור שלך. ברגע שתאשר, החיבור ייכנס כאן, וההתחברות תהיה עם המייל.</p>
    </div>

    <div class="section-title">איפוס</div>
    <div class="card" style="padding:14px"><button class="btn danger" data-wipe>מחק את כל הנתונים במכשיר הזה</button></div>
    <p class="hint" style="text-align:center;margin-top:20px">דיווח שיעורים · גרסה 1</p>
  </div>`);
  root.appendChild(wrap);
  const $ = (q) => wrap.querySelector(q);

  // simple fields
  wrap.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
    const [a, b] = inp.dataset.k.split('.');
    if (!inp.value && inp.type !== 'text') return;
    s[a][b] = inp.value.trim();
    app.save();
    toast('נשמר ✓');
    document.getElementById('who') && app.render();
  }));
  $('[data-days]').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-d]');
    if (!b) return;
    const d = Number(b.dataset.d);
    st.workDays = st.workDays.includes(d) ? st.workDays.filter((x) => x !== d) : [...st.workDays, d].sort();
    b.setAttribute('aria-pressed', st.workDays.includes(d));
    app.save();
  });

  // statuses
  const renderStatuses = () => {
    $('[data-statuses]').innerHTML = s.statuses.map((x, i) => `<div class="status-edit">
      <input class="input" data-sn="${i}" value="${e(x.name)}" style="background:${e(x.bg)};color:${e(x.fg)};font-weight:500">
      <input type="color" data-sbg="${i}" value="${e(x.bg)}" aria-label="רקע">
      <input type="color" data-sfg="${i}" value="${e(x.fg)}" aria-label="טקסט">
      <button class="icon-btn" data-sdel="${i}" aria-label="מחק" ${x.id === 'came' ? 'disabled style="opacity:.2"' : ''}>✕</button></div>`).join('');
  };
  renderStatuses();
  $('[data-statuses]').addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.dataset.sn != null) s.statuses[t.dataset.sn].name = t.value;
    if (t.dataset.sbg != null) s.statuses[t.dataset.sbg].bg = t.value;
    if (t.dataset.sfg != null) s.statuses[t.dataset.sfg].fg = t.value;
    const i = t.dataset.sbg ?? t.dataset.sfg;
    if (i != null) { const n = wrap.querySelector(`[data-sn="${i}"]`); n.style.background = s.statuses[i].bg; n.style.color = s.statuses[i].fg; }
    app.save({ silent: true });
  });
  $('[data-statuses]').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-sdel]');
    if (!b) return;
    const x = s.statuses[b.dataset.sdel];
    if (!await confirmDialog(`למחוק את הסטטוס "${x.name}"? שיעורים שסומנו בו יישארו בלי סטטוס.`, 'מחק', true)) return;
    s.statuses.splice(Number(b.dataset.sdel), 1);
    app.save(); renderStatuses();
  });
  $('[data-addstatus]').addEventListener('click', () => {
    s.statuses.push({ id: 's' + uid(), name: 'סטטוס חדש', bg: '#DCE7F7', fg: '#1F3B6E' });
    app.save(); renderStatuses();
    wrap.querySelector(`[data-sn="${s.statuses.length - 1}"]`).select();
  });
  $('[data-resetstatus]').addEventListener('click', async () => {
    if (!await confirmDialog('להחזיר את ארבעת הסטטוסים של הישיבה עם הצבעים המקוריים?', 'החזר')) return;
    const custom = s.statuses.filter((x) => !M.DEFAULT_STATUSES.some((d) => d.id === x.id));
    s.statuses = [...JSON.parse(JSON.stringify(M.DEFAULT_STATUSES)), ...custom];
    app.save(); renderStatuses();
  });

  // holidays
  const renderHols = () => {
    const hs = s.holidays.slice().sort((a, b) => (a.from < b.from ? -1 : 1));
    $('[data-hols]').innerHTML = hs.map((h) => `<div style="display:grid;grid-template-columns:1fr 1fr 36px;gap:6px;margin-bottom:12px;align-items:center" data-hid="${e(h.id)}">
      <input class="input" data-hn value="${e(h.name)}" style="min-height:38px;padding:6px 8px;grid-column:1 / 3;font-weight:500">
      <span></span>
      <input class="input" type="date" data-hf value="${e(h.from)}" style="min-height:38px;padding:4px 6px;font-size:14px">
      <input class="input" type="date" data-ht value="${e(h.to || h.from)}" style="min-height:38px;padding:4px 6px;font-size:14px">
      <button class="icon-btn" data-hdel aria-label="מחק">✕</button></div>`).join('') || '<p class="hint">אין חופשות.</p>';
  };
  renderHols();
  $('[data-hols]').addEventListener('change', (ev) => {
    const row = ev.target.closest('[data-hid]');
    const h = s.holidays.find((x) => x.id === row.dataset.hid);
    if (!h) return;
    if (ev.target.dataset.hn != null) h.name = ev.target.value.trim();
    if (ev.target.dataset.hf != null) { h.from = ev.target.value; if (!h.to || h.to < h.from) h.to = h.from; }
    if (ev.target.dataset.ht != null) h.to = ev.target.value;
    app.save(); renderHols();
  });
  $('[data-hols]').addEventListener('click', (ev) => {
    const row = ev.target.closest('[data-hdel]')?.closest('[data-hid]');
    if (!row) return;
    s.holidays = s.holidays.filter((x) => x.id !== row.dataset.hid);
    app.save(); renderHols();
  });
  $('[data-addhol]').addEventListener('click', () => {
    const t = todayISO();
    s.holidays.push({ id: uid(), name: 'חופש', from: t, to: t });
    app.save(); renderHols();
  });
  $('[data-loadhol]').addEventListener('click', async () => {
    if (!await confirmDialog('לטעון את חופשות תשפ"ז של משרד החינוך? חופשות שכבר יש לא יוכפלו.', 'טען')) return;
    for (const h of M.HOLIDAYS_5787) if (!s.holidays.some((x) => x.from === h.from && x.name === h.name)) s.holidays.push({ id: uid(), ...h });
    app.save(); renderHols();
  });

  // frames
  const renderFrames = () => {
    $('[data-frames]').innerHTML = s.frames.map((f, i) => `<div style="display:flex;gap:6px;margin-bottom:6px"><input class="input" data-fn="${i}" value="${e(f.name)}"></div>`).join('');
  };
  renderFrames();
  $('[data-frames]').addEventListener('change', (ev) => {
    const i = ev.target.dataset.fn;
    if (i != null && ev.target.value.trim()) { s.frames[i].name = ev.target.value.trim(); app.save(); }
  });
  $('[data-addframe]').addEventListener('click', () => {
    s.frames.push({ id: 'f' + uid(), name: 'מסגרת חדשה' });
    app.save(); renderFrames();
  });

  // export
  $('[data-exportnames]').addEventListener('change', (ev) => { st.exportNames = ev.target.checked; app.save(); });
  $('[data-export]').addEventListener('click', () => openExport(app));

  // AI key
  $('[data-savekey]').addEventListener('click', () => { setApiKey($('[data-apikey]').value.trim()); toast('נשמר ✓'); });
  $('[data-testkey]').addEventListener('click', async () => {
    setApiKey($('[data-apikey]').value.trim());
    toast('בודק…');
    try { await testApiKey(); toast('המפתח עובד ✓'); } catch (err) { toast('לא עבד: ' + (err.message || err), 5000); }
  });

  // iPhone shortcut URL
  const url = new URL('./?text=', location.href).href;
  $('[data-shortcut-url]').textContent = url;
  $('[data-copyurl]').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('הועתק ✓'); } catch { toast(url, 5000); }
  });

  // backup
  $('[data-backup]').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(backupBlob(s));
    a.download = `גיבוי-שיעורים-${todayISO()}.json`;
    a.click();
    setPref('lastBackup', todayISO());
    setTimeout(() => app.render(), 300);
  });
  $('[data-restore]').addEventListener('click', () => {
    const inp = document.getElementById('backupInput');
    inp.onchange = async () => {
      const f = inp.files[0];
      inp.value = '';
      if (!f) return;
      try {
        const ns = await readBackup(f);
        if (!await confirmDialog(`לשחזר את הגיבוי? (${ns.students.length} תלמידים, ${Object.keys(ns.days).length} ימים). מה שיש עכשיו במכשיר יוחלף.`, 'שחזר', true)) return;
        app.state = ns;
        app.save();
        toast('שוחזר ✓');
        app.go('home');
      } catch (err) { toast(err.message || 'הקובץ לא נקרא'); }
    };
    inp.click();
  });
  $('[data-wipe]').addEventListener('click', async () => {
    if (!await confirmDialog('למחוק את כל התלמידים והדיווחים מהמכשיר הזה? אי אפשר לבטל. כדאי להוריד גיבוי קודם.', 'מחק הכל', true)) return;
    app.state = M.defaultState();
    app.save();
    app.go('home');
  });

  if (app.params.focus === 'ai') setTimeout(() => $('#ai').scrollIntoView({ behavior: 'smooth' }), 50);
}
