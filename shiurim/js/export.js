// "הורד לאקסל": a file shaped like the yeshiva's sheet - a row per work day, 15-minute columns with
// half-hour headers, merged cells per lesson, the same four values with a dropdown and the same colours
// (as conditional formatting, so changing the dropdown in Excel/Sheets recolours the cell).

import { escapeHtml as e, toMin, fromMin, todayISO, addDays, fromISO, toISO, weekday, fmtDateFull, DAY_NAMES } from './util.js';
import * as M from './model.js';
import { el, openSheet, toast } from './ui.js';
import { slotColumns, layoutRow } from './table.js';

let excelPromise = null;
function loadExcel() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelPromise) {
    excelPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = new URL('../vendor/exceljs.min.js', import.meta.url).href;
      sc.onload = () => resolve(window.ExcelJS);
      sc.onerror = () => { excelPromise = null; reject(new Error('טעינת רכיב האקסל נכשלה. צריך חיבור לאינטרנט בפעם הראשונה.')); };
      document.head.appendChild(sc);
    });
  }
  return excelPromise;
}

const argb = (hex) => 'FF' + String(hex || '#000000').replace('#', '').toUpperCase().padStart(6, '0');

function frameOk(s, l, frame) {
  if (!frame || !l.studentId) return true;
  const st = M.studentById(s, l.studentId);
  return !st || (st.frame || 'yeshiva') === frame;
}

export async function buildWorkbook(s, { from, to, frame = 'yeshiva', names = false }, ExcelJS) {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.teacher.name || 'דיווח שיעורים';
  wb.created = new Date();
  const ws = wb.addWorksheet('נוכחות', { views: [{ rightToLeft: true, state: 'frozen', xSplit: 2, ySplit: 3 }] });
  const cols = slotColumns(s);
  const nCols = 2 + cols.length + 1;
  const thin = { style: 'thin', color: { argb: 'FFD1D5DB' } };
  const border = { top: thin, bottom: thin, left: thin, right: thin };
  const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };

  ws.columns = [
    { width: 20 }, { width: 22 },
    ...cols.map(() => ({ width: 6.5 })),
    { width: 34 },
  ];

  // Title rows
  const frameName = frame ? (s.frames.find((f) => f.id === frame)?.name || '') : '';
  ws.mergeCells(1, 1, 1, nCols);
  const t = ws.getCell(1, 1);
  t.value = [s.teacher.name, s.teacher.subject, frameName && `(${frameName})`].filter(Boolean).join(' · ') || 'דיווח שיעורים';
  t.font = { bold: true, size: 14 };
  t.alignment = { horizontal: 'right', vertical: 'middle', readingOrder: 'rtl' };
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, nCols);
  ws.getCell(2, 1).value = `${fmtDateFull(from)} – ${fmtDateFull(to)}`;
  ws.getCell(2, 1).font = { color: { argb: 'FF6B7280' } };
  ws.getCell(2, 1).alignment = { horizontal: 'right' };

  // Header row
  const H = 3;
  const hr = ws.getRow(H);
  hr.getCell(1).value = 'תאריך';
  hr.getCell(2).value = 'חופשות, טיולים והיעדרויות מורה';
  for (let i = 0; i < cols.length; i++) {
    if (cols[i] % 30 === 0) hr.getCell(3 + i).value = fromMin(cols[i]);
  }
  for (let i = 0; i < cols.length;) {
    if (cols[i] % 30 === 0 && i + 1 < cols.length && cols[i + 1] % 30 !== 0) { ws.mergeCells(H, 3 + i, H, 4 + i); i += 2; } else i += 1;
  }
  hr.getCell(nCols).value = 'הארות ושינויים';
  hr.height = 30;
  for (let c = 1; c <= nCols; c++) {
    const cell = hr.getCell(c);
    cell.font = { bold: true };
    cell.fill = headFill;
    cell.border = border;
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder: 'rtl' };
  }

  // Data rows
  const statusNames = s.statuses.map((x) => x.name.replace(/,/g, ' '));
  const validation = {
    type: 'list',
    allowBlank: true,
    formulae: [`"${statusNames.join(',')}"`],
    showErrorMessage: false, // free text is allowed, like in the original sheet
  };
  const dates = M.yearDates(s, from, to);
  let r = H + 1;
  const holidayFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBF3E4' } };
  for (const d of dates) {
    const day = M.getDay(s, d);
    const row = ws.getRow(r);
    const dc = row.getCell(1);
    dc.value = `${DAY_NAMES[weekday(d)]} ${fmtDateFull(d)}`;
    dc.alignment = { horizontal: 'right', readingOrder: 'rtl' };
    row.getCell(2).value = day.holiday || null;
    row.getCell(2).alignment = { horizontal: 'center', wrapText: true };
    if (day.holiday) row.getCell(2).fill = holidayFill;
    for (let c = 1; c <= nCols; c++) row.getCell(c).border = border;
    for (let i = 0; i < cols.length; i++) {
      const cell = row.getCell(3 + i);
      cell.dataValidation = validation;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, shrinkToFit: false, readingOrder: 'rtl' };
      if (day.holiday) cell.fill = holidayFill;
    }
    const lessons = day.lessons.filter((l) => frameOk(s, l, frame));
    const { placed, outside } = layoutRow(s, lessons, cols);
    for (const p of placed) {
      const l = p.lesson;
      const st = l.status && M.statusById(s, l.status);
      const nm = M.lessonName(s, l);
      let value = st ? st.name : (l.note || '');
      if (names) value = value ? `${value} · ${nm}` : nm;
      const c0 = 3 + p.col;
      if (p.span > 1) ws.mergeCells(r, c0, r, c0 + p.span - 1);
      const cell = row.getCell(c0);
      cell.value = value || null;
      if (!names && nm) cell.note = { texts: [{ text: [`${nm} ${l.time}`, l.summary, st && l.note].filter(Boolean).join('\n') }] };
    }
    const rem = [day.remark, outside.length ? `(מחוץ לשעות: ${outside.map((l) => `${M.lessonName(s, l)} ${l.time}`).join(', ')})` : ''].filter(Boolean).join(' ');
    row.getCell(nCols).value = rem || null;
    row.getCell(nCols).alignment = { horizontal: 'right', wrapText: true, readingOrder: 'rtl' };
    row.height = 22;
    r++;
  }
  const lastRow = Math.max(H + 1, r - 1);

  // Colours follow the value, exactly like the yeshiva sheet.
  if (dates.length) {
    const first = ws.getCell(H + 1, 3).address;
    const ref = `${first}:${ws.getCell(lastRow, 2 + cols.length).address}`;
    const rules = s.statuses
      .slice()
      .sort((a, b) => b.name.length - a.name.length)
      .map((x, i) => ({
        type: 'expression',
        priority: i + 1,
        stopIfTrue: true,
        formulae: [`LEFT(${first},${x.name.length})="${x.name.replace(/"/g, '""')}"`],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: argb(x.bg) }, fgColor: { argb: argb(x.bg) } },
          font: { color: { argb: argb(x.fg) } },
        },
      }));
    ws.addConditionalFormatting({ ref, rules });
  }

  // Hours summary
  const sum = wb.addWorksheet('סיכום שעות', { views: [{ rightToLeft: true }] });
  sum.columns = [{ width: 26 }, { width: 14 }, { width: 14 }];
  sum.addRow([`סיכום ${fmtDateFull(from)} – ${fmtDateFull(to)}${frameName ? ` · ${frameName}` : ''}`]).font = { bold: true, size: 13 };
  sum.addRow([]);
  const hdr = sum.addRow(['תלמיד', 'שיעורים שהגיע', 'שעות']);
  hdr.font = { bold: true };
  hdr.eachCell((c) => { c.fill = headFill; c.border = border; });
  const per = new Map();
  let total = 0;
  const counts = Object.fromEntries(s.statuses.map((x) => [x.id, 0]));
  let unreported = 0;
  for (const d of dates) {
    for (const l of M.getDay(s, d).lessons.filter((x) => frameOk(s, x, frame))) {
      if (l.status && counts[l.status] != null) counts[l.status]++;
      else if (!l.status && d <= todayISO()) unreported++;
      if (!M.countsAsCame(s, l.status)) continue;
      const k = l.studentId || 'n:' + l.name;
      const cur = per.get(k) || { name: M.lessonName(s, l), n: 0, min: 0 };
      cur.n++; cur.min += Number(l.len);
      per.set(k, cur);
      total += Number(l.len);
    }
  }
  for (const p of [...per.values()].sort((a, b) => a.name.localeCompare(b.name, 'he'))) {
    const row = sum.addRow([p.name, p.n, +(p.min / 60).toFixed(2)]);
    row.eachCell((c) => { c.border = border; });
  }
  const tr = sum.addRow(['סך הכל', [...per.values()].reduce((a, b) => a + b.n, 0), +(total / 60).toFixed(2)]);
  tr.font = { bold: true };
  tr.eachCell((c) => { c.border = border; c.fill = headFill; });
  sum.addRow([]);
  sum.addRow(['נוכחות לפי סטטוס']).font = { bold: true };
  for (const x of s.statuses) {
    const row = sum.addRow([x.name, counts[x.id]]);
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(x.bg) } };
    row.getCell(1).font = { color: { argb: argb(x.fg) } };
  }
  if (unreported) sum.addRow(['לא דווח', unreported]);

  return { wb, totalMinutes: total };
}

export function openExport(app) {
  const s = app.state;
  const today = todayISO();
  const t = fromISO(today);
  const monthStart = toISO(new Date(t.getFullYear(), t.getMonth(), 1));
  const prevStart = toISO(new Date(t.getFullYear(), t.getMonth() - 1, 1));
  const prevEnd = addDays(monthStart, -1);
  const presets = [
    { label: 'החודש', from: monthStart, to: addDays(toISO(new Date(t.getFullYear(), t.getMonth() + 1, 1)), -1) },
    { label: 'החודש הקודם', from: prevStart, to: prevEnd },
    { label: 'מתחילת השנה עד היום', from: s.settings.yearStart, to: today },
    { label: 'כל השנה', from: s.settings.yearStart, to: s.settings.yearEnd },
  ];
  const f = { from: presets[2].from, to: presets[2].to, frame: s.frames.some((x) => x.id === 'yeshiva') ? 'yeshiva' : '', names: !!s.settings.exportNames };
  const body = el(`<div>
    <div class="seg" data-presets style="margin-bottom:12px">${presets.map((p, i) => `<button type="button" data-p="${i}" aria-pressed="${i === 2}">${e(p.label)}</button>`).join('')}</div>
    <div class="two">
      <label class="field"><span>מתאריך</span><input class="input" type="date" name="from" value="${f.from}"></label>
      <label class="field"><span>עד תאריך</span><input class="input" type="date" name="to" value="${f.to}"></label>
    </div>
    <label class="field"><span>מסגרת</span><select class="input" name="frame"><option value="">הכל</option>${s.frames.map((x) => `<option value="${e(x.id)}" ${x.id === f.frame ? 'selected' : ''}>${e(x.name)}</option>`).join('')}</select></label>
    <label style="display:flex;gap:8px;align-items:center;margin-bottom:8px"><input type="checkbox" name="names" ${f.names ? 'checked' : ''}> לכתוב את שם התלמיד בתא לצד הסטטוס</label>
    <p class="hint" data-sum></p>
  </div>`);
  const $ = (q) => body.querySelector(q);
  const updSum = () => {
    const sm = M.hoursSummary(s, $('[name=from]').value, $('[name=to]').value);
    $('[data-sum]').textContent = `בטווח הזה (כל המסגרות): ${(sm.totalMinutes / 60).toFixed(1).replace('.0', '')} שעות שבהן תלמידים הגיעו.`;
  };
  updSum();
  body.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-p]');
    if (!b) return;
    const p = presets[Number(b.dataset.p)];
    $('[name=from]').value = p.from;
    $('[name=to]').value = p.to;
    body.querySelectorAll('[data-p]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    updSum();
  });
  body.addEventListener('change', updSum);
  openSheet({
    title: 'הורדה לאקסל',
    body,
    actions: [
      {
        label: '⤓ הורד', cls: 'primary', grow: true, onClick: async (close, sheet) => {
          const opts = { from: $('[name=from]').value, to: $('[name=to]').value, frame: $('[name=frame]').value, names: $('[name=names]').checked };
          if (!opts.from || !opts.to || opts.from > opts.to) { toast('טווח התאריכים לא תקין'); return; }
          const btn = sheet.querySelector('.foot .primary');
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner"></span> מכין…';
          try {
            const ExcelJS = await loadExcel();
            const { wb } = await buildWorkbook(s, opts, ExcelJS);
            const buf = await wb.xlsx.writeBuffer();
            const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const name = `נוכחות-${(s.teacher.name || 'שיעורים').replace(/\s+/g, '-')}-${opts.from}-עד-${opts.to}.xlsx`;
            const file = new File([blob], name, { type: blob.type });
            if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
              try { await navigator.share({ files: [file], title: name }); close(); return; } catch (err) { if (err && err.name === 'AbortError') { close(); return; } }
            }
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 2000);
            close();
            toast('הקובץ ירד ✓');
          } catch (err) {
            console.error(err);
            toast(err.message || 'היצוא נכשל', 5000);
            btn.disabled = false;
            btn.textContent = '⤓ הורד';
          }
        },
      },
      { label: 'ביטול', cls: 'ghost' },
    ],
  });
}
