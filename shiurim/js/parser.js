// Turns a free-text day summary ("שלמה לא הגיע, בנימין - פינגרסטייל") into structured items.
// Runs entirely on the device: instant, free, works offline, and the students' names never leave the phone.
// It only extracts what was written; filling in the regular schedule happens in model.buildReview.

import { DAY_NAMES, addDays, weekday, toMin, fromMin, norm, lev, fromISO, toISO, daysBetween } from './util.js';

const HEB = '\\u0590-\\u05FF';
const NOT_HEB_AFTER = `(?![${HEB}A-Za-z])`;
const SEP_REST = `(?:\\s*[-–—:.,]+\\s*(.*)|\\s*)$`;
const WD = DAY_NAMES.join('|');

// ---------- status vocabulary ----------
// Order matters: the "absent" family is checked before "came" because "לא הגיע" contains "הגיע".
const RX = {
  absent: /(לא\s+(?:הגיע|הגיעה|הגיעו|בא|באה|באו|היה|היתה|הייתה|היו)|חסר|נעדר|חולה|חולים)/,
  noshow: /(הבריז|הבריזה|הבריזו|לא\s+הודיע|לא\s+הודיעה|לא\s+הודיעו|ללא\s+הודעה|בלי\s+להודיע|בלי\s+הודעה|נעלם|נעלמה|לא\s+ענה|שכח|שכחה|ברז)/,
  notified: /(הודיע|הודיעה|הודיעו|ביטל|ביטלה|ביטלו|התקשר|התקשרה|שלח\s+הודעה|שלחה\s+הודעה|התנצל|התנצלה|מראש)/,
  trip: /(טיול|מבחן|מבחנים|בגרות|אילוצ|סיור|שבתון|כנס|אירוע|מסיבה|ישיבתי|ישיבתית|מערכת)/,
  came: /(הגיע|הגיעה|הגיעו|השתתף|השתתפה|^\s*היה|^\s*בא(?![א-ת]))/,
};

const STATUS_STRIP = [
  /\s*לא\s+הגיע[הו]?\s+(?:ו?לא\s+הודיע[הו]?|והודיע[הו]?)/,
  /\s*לא\s+(?:הגיע[הו]?|בא[הו]?|היה|היתה|הייתה|היו)/,
  /\s*ו?לא\s+הודיע[הו]?/,
  /\s*(?:הבריז[הו]?|נעלם[ה]?)/,
  /\s*ו?(?:הודיע[הו]?|ביטל[הו]?|התקשר[ה]?)/,
  /\s*(?:הגיע[הו]?|השתתפ?ה?)(?=$|[\s,.\-–—:])/,
];
const NOT_COMING = /\s*ש?(?:הוא\s+)?לא\s+(?:יגיע|תגיע|יבוא|תבוא|יוכל|תוכל)(?:\s+היום)?/;

const TASK_RX = /^(?:ו?אני\s+)?(?:צריך|צריכה|חייב|חייבת|לזכור|משימה|תזכורת|לי\s*:)/;
const STOP_NAMES = new Set(['אני', 'היום', 'אתמול', 'כולם', 'השאר', 'כל', 'לא', 'עבדנו', 'היה', 'שיעור', 'יום', 'הוא', 'היא', 'הם', 'אנחנו', 'עוד', 'גם', 'רק', 'אחר', 'אחרי', 'לפני', 'משימה', 'תזכורת', 'צריך', 'סה"כ', 'סהכ']
  .map(norm));

// ---------- dates ----------

function resolveWeekday(wd, today) {
  // Most recent such day, today included: a report is normally about the past.
  const diff = (weekday(today) - wd + 7) % 7;
  return addDays(today, -diff);
}

function resolveDayMonth(d, m, y, today) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = fromISO(today);
  let year = y ? (y < 100 ? 2000 + y : y) : t.getFullYear();
  let iso = toISO(new Date(year, m - 1, d));
  if (!y) {
    const diff = daysBetween(today, iso);
    if (diff > 120) iso = toISO(new Date(year - 1, m - 1, d));
    else if (diff < -240) iso = toISO(new Date(year + 1, m - 1, d));
  }
  return iso;
}

// A line that names a day: "שלישי", "יום שלישי -", "שני: שלמה לא הגיע", "13/10", "אתמול:".
export function parseHeader(line, today) {
  const s = line.trim().replace(/^[*•·#]+\s*/, '');
  let m = s.match(new RegExp(`^(ב?יום\\s+)?(?:ב)?(${WD})${NOT_HEB_AFTER}(?:\\s*,?\\s*(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?)?(.*)$`));
  if (m) {
    const hasYom = !!m[1];
    const rest = m[6] || '';
    const sep = rest.match(/^\s*[-–—:.,]+\s*(.*)$/);
    if (rest.trim() === '' || sep || hasYom || m[3]) {
      const wd = DAY_NAMES.indexOf(m[2]);
      let date = m[3] ? resolveDayMonth(+m[3], +m[4], m[5] ? +m[5] : null, today) : null;
      if (!date) date = resolveWeekday(wd, today);
      return { date, rest: (sep ? sep[1] : rest).trim() };
    }
  }
  m = s.match(new RegExp(`^(היום|אתמול|שלשום|מחר)${NOT_HEB_AFTER}${SEP_REST}`));
  if (m) {
    const off = { 'היום': 0, 'אתמול': -1, 'שלשום': -2, 'מחר': 1 }[m[1]];
    return { date: addDays(today, off), rest: (m[2] || '').trim(), relative: m[1] };
  }
  m = s.match(/^(?:ב-?|ביום\s+|תאריך\s*:?\s*)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?!\d)(.*)$/)
    || s.match(/^(?:ב-?)?(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?!\d)(.*)$/);
  if (m) {
    const rest = m[4] || '';
    const sep = rest.match(/^\s*[-–—:.,]*\s*(.*)$/);
    const date = resolveDayMonth(+m[1], +m[2], m[3] ? +m[3] : null, today);
    if (date && (rest.trim() === '' || /^\s*[-–—:.,(]/.test(rest) || /^\s*(?:יום\s+)?(?:ראשון|שני|שלישי|רביעי|חמישי|שישי)/.test(rest))) {
      const r = sep[1].replace(new RegExp(`^\\(?\\s*(?:יום\\s+)?(?:${WD})\\s*\\)?\\s*[-–—:.,]*\\s*`), '');
      return { date, rest: r.trim() };
    }
  }
  return null;
}

// ---------- times ----------

function hm(h, m, ctx) {
  let H = Number(h);
  const M = Number(m || 0);
  if (H > 23 || M > 59) return null;
  const start = toMin(ctx.dayStart || '14:00');
  const end = toMin(ctx.dayEnd || '21:30');
  // "4" or "2:30" in an afternoon schedule means 16:00 / 14:30.
  if (H <= 12 && H * 60 + M < start - 90 && (H + 12) * 60 + M <= end + 60) H += 12;
  return H * 60 + M;
}

const T = '(\\d{1,2})(?::(\\d{2}))?';

function takeLeadingTime(text, ctx) {
  let m = text.match(new RegExp(`^\\s*(?:בין\\s+|מ-?)?${T}\\s*(?:[-–—]|עד)\\s*(?:ל-?)?${T}(?!\\d)\\s*[-–—:.,]?\\s*`));
  if (m) {
    const a = hm(m[1], m[2], ctx);
    const b = hm(m[3], m[4], ctx);
    if (a != null && b != null && b > a && b - a <= 240) {
      return { time: fromMin(a), len: b - a, range: true, rest: text.slice(m[0].length) };
    }
  }
  m = text.match(/^\s*(?:ב-?|בשעה\s+)?(\d{1,2}):(\d{2})(?!\d)\s*[-–—:.,]?\s*/);
  if (m) {
    const a = hm(m[1], m[2], ctx);
    if (a != null) return { time: fromMin(a), len: null, range: false, rest: text.slice(m[0].length) };
  }
  return null;
}

// Times written after the name: "הגיע ב-15:30 במקום 15:15", "14:30-15:15", "45 דק'".
function takeInlineTimes(text, ctx) {
  let out = { time: null, len: null, range: false, was: null };
  let s = text;
  const was = s.match(new RegExp(`\\s*\\(?במקום\\s*(?:ב-?\\s*|בשעה\\s+)?${T}\\)?`));
  if (was) {
    const w = hm(was[1], was[2], ctx);
    if (w != null) out.was = fromMin(w);
    s = s.replace(was[0], ' ');
  }
  let m = s.match(new RegExp(`(?:^|\\s)(?:בין\\s+|ב-?|מ-?)?${T}\\s*(?:[-–—]|עד)\\s*(?:ל-?)?${T}(?!\\d)`));
  if (m && (m[2] || m[4] || /^\s*(?:בין|ב|מ)/.test(m[0]))) {
    const a = hm(m[1], m[2], ctx);
    const b = hm(m[3], m[4], ctx);
    if (a != null && b != null && b > a && b - a <= 240) {
      out = { ...out, time: fromMin(a), len: b - a, range: true };
      s = s.replace(m[0], ' ');
    }
  }
  if (!out.time) {
    m = s.match(/(?:^|\s)(?:ב-?\s?|בשעה\s+)?(\d{1,2}):(\d{2})(?!\d)/) || s.match(/(?:^|\s)(?:ב-|בשעה\s+)(\d{1,2})(?![\d:])/);
    if (m) {
      const a = hm(m[1], m[2], ctx);
      if (a != null && a >= toMin(ctx.dayStart || '14:00') - 180 && a <= toMin(ctx.dayEnd || '21:30') + 60) {
        out.time = fromMin(a);
        s = s.replace(m[0], ' ');
      }
    }
  }
  m = s.match(/(\d{2,3})\s*(?:דקות|דק['׳]?|ד['׳])/);
  if (m) {
    out.len = Number(m[1]);
    s = s.replace(m[0], ' ');
  } else if (/שעה\s+וחצי/.test(s)) {
    out.len = 90; s = s.replace(/(?:של\s+)?שעה\s+וחצי/, ' ');
  } else if (/חצי\s+שעה/.test(s)) {
    out.len = 30; s = s.replace(/(?:של\s+)?חצי\s+שעה/, ' ');
  } else if (/שעה\s+(?:שלמה|אחת)/.test(s)) {
    out.len = 60; s = s.replace(/(?:של\s+)?שעה\s+(?:שלמה|אחת)/, ' ');
  }
  return { ...out, rest: s };
}

// ---------- names ----------

export function buildNameIndex(students) {
  const exact = new Map(); // normalised key -> Set(ids)
  const firsts = []; // {key, id}
  const add = (key, id) => {
    const k = norm(key);
    if (!k) return;
    if (!exact.has(k)) exact.set(k, new Set());
    exact.get(k).add(id);
  };
  for (const st of students) {
    if (!st.name) continue;
    add(st.name, st.id);
    const first = norm(st.name).split(' ')[0];
    add(first, st.id);
    firsts.push({ key: first, id: st.id });
    for (const a of st.aliases || []) {
      add(a, st.id);
      firsts.push({ key: norm(a), id: st.id });
    }
  }
  return { exact, firsts };
}

const WORD_RX = /[א-תA-Za-z"'׳״]+/g;

function tokens(text) {
  return [...text.matchAll(WORD_RX)].map((m) => ({ w: m[0], i: m.index, end: m.index + m[0].length }));
}

// Is there a student name at the very start of `text`? Returns {ids, end, fuzzy}.
function nameAtStart(text, index) {
  const toks = tokens(text);
  if (!toks.length) return null;
  if (text.slice(0, toks[0].i).replace(/[\s\-–—•*·:.,]/g, '') !== '') return null;
  for (let k = Math.min(3, toks.length); k >= 1; k--) {
    // Words of a multi-word name must be separated by spaces only.
    let ok = true;
    for (let j = 1; j < k; j++) if (text.slice(toks[j - 1].end, toks[j].i).trim() !== '') ok = false;
    if (!ok) continue;
    const words = toks.slice(0, k).map((t) => t.w);
    const tries = [words.join(' ')];
    if (/^ו/.test(words[0]) && words[0].length > 2) tries.push([words[0].slice(1), ...words.slice(1)].join(' '));
    for (const t of tries) {
      const hit = index.exact.get(norm(t));
      if (hit) return { ids: [...hit], end: toks[k - 1].end, fuzzy: false };
    }
  }
  // Nickname prefix ("בני" → בנימין) or a single typo ("בנימן").
  const w = norm(toks[0].w).replace(/^ו(?=.{3,})/, '');
  if (w.length >= 3 && !STOP_NAMES.has(w)) {
    const pref = [...new Set(index.firsts.filter((f) => f.key.startsWith(w) && f.key !== w).map((f) => f.id))];
    if (pref.length === 1 && w.length >= 3) return { ids: pref, end: toks[0].end, fuzzy: true };
    if (w.length >= 4) {
      const close = [...new Set(index.firsts.filter((f) => f.key.length >= 4 && lev(f.key, w) === 1).map((f) => f.id))];
      if (close.length) return { ids: close, end: toks[0].end, fuzzy: true };
    }
  }
  return null;
}

// A known name anywhere in the line ("היה שיעור מצוין עם בנימין"). Exact matches only.
function nameAnywhere(text, index) {
  const toks = tokens(text);
  for (let s = 0; s < toks.length; s++) {
    for (let k = Math.min(3, toks.length - s); k >= 1; k--) {
      const words = toks.slice(s, s + k).map((t) => t.w);
      let key = norm(words.join(' '));
      let hit = index.exact.get(key);
      if (!hit && /^[ולב]/.test(key) && key.length > 3) hit = index.exact.get(key.slice(1));
      if (hit && !STOP_NAMES.has(key)) {
        return { ids: [...hit], start: toks[s].i, end: toks[s + k - 1].end };
      }
    }
  }
  return null;
}

function hasStatusWord(text) {
  return RX.absent.test(text) || RX.noshow.test(text) || RX.notified.test(text) || RX.came.test(text);
}

// "צביקה הגיע", "צביקה - סולמות", "צביקה 14:45": the first word(s) before the status/separator/time.
function unknownNameAtStart(text) {
  const toks = tokens(text);
  if (!toks.length || text.slice(0, toks[0].i).trim() !== '') return null;
  const STATUS_AHEAD = /^\s*(?:[-–—:](?:\s|$)|\d|$|(?:לא\s+)?(?:הגיע|בא|היה|הודיע|ביטל|הבריז|התקשר|נעלם|חולה))/;
  for (let k = 1; k <= Math.min(2, toks.length); k++) {
    if (k === 2 && text.slice(toks[0].end, toks[1].i).trim() !== '') break;
    const words = toks.slice(0, k).map((t) => t.w);
    if (words.some((w) => STOP_NAMES.has(norm(w)) || /^(?:לא|גם|הגיע|בא|היה|הודיע|ביטל|הבריז|התקשר|נעלם|חולה)/.test(w))) break;
    const end = toks[k - 1].end;
    if (STATUS_AHEAD.test(text.slice(end))) return { name: words.join(' '), end };
  }
  return null;
}

// ---------- content → status / summary / tasks ----------

export function detectStatus(text, extraStatuses = []) {
  const t = text || '';
  for (const st of extraStatuses) {
    if (st.name && norm(t).includes(norm(st.name))) return st.id;
  }
  if (RX.absent.test(t)) {
    if (RX.noshow.test(t)) return 'noshow';
    if (RX.notified.test(t)) return 'notified';
    if (RX.trip.test(t)) return 'trip';
    return 'absent'; // "לא הגיע" alone: ask whether he let me know
  }
  if (RX.noshow.test(t)) return 'noshow';
  if (RX.notified.test(t) && !RX.came.test(t)) return 'notified';
  const words = t.trim().split(/\s+/).filter(Boolean).length;
  if (RX.trip.test(t) && !RX.came.test(t) && words <= 4) return 'trip';
  return null; // caller decides: content → came
}

export function stripStatusWords(text) {
  let s = text;
  for (const rx of STATUS_STRIP) {
    const m = s.match(rx);
    if (m) {
      s = s.replace(m[0], ' ');
      break;
    }
  }
  return s;
}

export function cleanup(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–—:.,;()]+/, '')
    .replace(/[\s\-–—:,;(]+$/, '')
    .replace(/^ו(?=[א-ת]{2})/, (x) => x) // keep a leading ו that is part of a word
    .replace(/\s+([,.])/g, '$1')
    .trim();
}

function topicOf(summary) {
  return cleanup(summary.replace(/^(?:עבדנו|עבדתי|למדנו|תרגלנו|התחלנו|המשכנו|חזרנו)\s+(?:על|את)?\s*/, ''));
}

function makeTask(clause, summary) {
  let t = clause
    .replace(/^\s*ו?(?:אני\s+)?(?:צריך|צריכה|חייב|חייבת)\s+/, '')
    .replace(/^\s*(?:משימה|תזכורת|לזכור)\s*:?\s*/, (m) => (/לזכור/.test(m) ? 'לזכור ' : ''))
    .replace(/^\s*לי\s*:\s*/, '');
  t = cleanup(t)
    .replace(/\s*(?:ל|עד\s+ה|לקראת\s+ה|לפני\s+ה)שיעור\s+הבא\.?$/, '')
    .trim();
  const topic = topicOf(summary || '');
  if (topic && topic.split(' ').length <= 4) {
    t = t.replace(/(^|\s)על\s+זה(?=$|\s|[,.])/, `$1על ${topic}`);
  }
  return t;
}

function analyseContent(content, ctx) {
  const times = takeInlineTimes(content, ctx);
  // Split into clauses, and split "... ואני צריך ..." too.
  const clauses = times.rest
    .split(/[,;]|\.(?!\d)|\s+(?=ו(?:אני\s+)?(?:צריך|צריכה|חייב|חייבת)\s)/)
    .map((c) => c.trim())
    .filter((c) => c && !/^[-–—:.]+$/.test(c));
  const tasks = [];
  const rest = [];
  for (const c of clauses) {
    const bare = c.replace(/^[-–—:\s]+/, '');
    if (TASK_RX.test(bare)) tasks.push(bare);
    else rest.push(c);
  }
  const statusText = rest.join(', ');
  const status = detectStatus(statusText, ctx.extraStatuses || []);
  let summary = cleanup(stripStatusWords(rest.join(', ')).replace(NOT_COMING, ' '));
  if (status === 'trip' || status === 'absent' || status === 'notified' || status === 'noshow') {
    summary = cleanup(summary.replace(/^(?:כי|בגלל|-)\s*/, ''));
  }
  return {
    time: times.time,
    len: times.len,
    range: times.range,
    was: times.was,
    status,
    summary,
    tasks: tasks.map((t) => makeTask(t, summary)).filter(Boolean),
    hasContent: !!(summary || tasks.length || status),
  };
}

// ---------- main ----------

const EVERYONE_RX = /(?:^|\s)(?:כל\s+השאר|כל\s+השאר\s+הם|כולם|כל\s+התלמידים|שאר\s+התלמידים|השאר)\s+(?:הגיעו|היו|בסדר|הגיעו\s+כרגיל|כרגיל)/;
const EXCEPT_RX = /חוץ\s+מ(?:ה|-)?\s*(.+)$/;

/**
 * @param {string} text
 * @param {{today:string, students:Array, dayStart?:string, dayEnd?:string,
 *          scheduledOn?:(date:string)=>Set<string>, extraStatuses?:Array}} ctx
 * @returns {{days: Array<{date:string, items:Array, plan:boolean, everyoneElseCame:boolean, remarks:string[]}>}}
 */
export function parseReport(text, ctx) {
  const index = buildNameIndex(ctx.students || []);
  const today = ctx.today;
  const blocks = [];
  let cur = null;
  const newBlock = (date, explicit) => {
    cur = { date, explicit, lines: [] };
    blocks.push(cur);
  };

  const rawLines = String(text || '').replace(/\r/g, '').split('\n');
  for (let line of rawLines) {
    if (!line.trim()) continue;
    // "שני: ... / שלישי: ..." on one line → split on " / " before a day name.
    const parts = line.split(new RegExp(`\\s+[/|]\\s+(?=(?:יום\\s+)?(?:${WD})\\s*[:\\-–—])`));
    for (const part of parts) {
      const h = parseHeader(part, today);
      if (h) {
        newBlock(h.date, true);
        if (h.rest) cur.lines.push(h.rest);
      } else {
        if (!cur) newBlock(today, false);
        cur.lines.push(part);
      }
    }
  }

  // The same day written twice in one note → one block.
  const merged = [];
  for (const b of blocks) {
    const prev = merged.find((x) => x.date === b.date);
    if (prev) prev.lines.push(...b.lines);
    else merged.push(b);
  }

  const days = [];
  for (const b of merged) {
    const scheduled = ctx.scheduledOn ? ctx.scheduledOn(b.date) : new Set();
    const pick = (ids) => {
      if (ids.length === 1) return { id: ids[0], alternatives: [] };
      const sched = ids.filter((id) => scheduled.has(id));
      if (sched.length === 1) return { id: sched[0], alternatives: ids.filter((x) => x !== sched[0]) };
      return { id: (sched[0] || ids[0]), alternatives: ids.slice(1), ambiguous: true };
    };

    const segs = [];
    const remarks = [];
    let everyoneElseCame = false;
    let last = null;

    for (const rawLine of b.lines) {
      let line = rawLine.replace(/^\s*(?:[-–—•*·]|\d{1,2}[.)](?!\d))\s*/, '');
      if (!line.trim()) continue;

      if (EVERYONE_RX.test(line)) {
        everyoneElseCame = true;
        const ex = line.match(EXCEPT_RX);
        if (ex) {
          for (const part of ex[1].split(/,|\s+ו(?=[א-ת])/)) {
            const n = nameAtStart(part.trim(), index);
            if (n) segs.push({ ...pick(n.ids), raw: part.trim(), content: 'לא הגיע', lineNo: rawLine });
          }
        }
        continue;
      }

      const lead = takeLeadingTime(line, ctx);
      let body = lead ? lead.rest : line;
      const lineSegs = [];

      // Split into clauses on , ; and sentence dots; a clause that starts with a name opens a new segment.
      const clauses = body.split(/(?<=[,;])|(?<=\.)(?!\d)/);
      let segInLine = null;
      for (let ci = 0; ci < clauses.length; ci++) {
        let clause = clauses[ci];
        const clauseText = clause.replace(/[,;.]$/, '');
        let n = nameAtStart(clauseText, index);
        // A time right after the comma: "בנימין 14:00, צביקה 14:45"
        let clauseLead = null;
        if (!n && ci > 0) {
          clauseLead = takeLeadingTime(clauseText, ctx);
          if (clauseLead) n = nameAtStart(clauseLead.rest, index);
        }
        if (n) {
          const src = clauseLead ? clauseLead.rest : clauseText;
          let after = src.slice(n.end);
          const ids = [n.ids];
          // "שלמה ויוסף לא הגיעו"
          let more;
          while ((more = after.match(/^\s*(?:ו-?|&|\+)\s*/)) && (more = { m: more, n: nameAtStart(after.slice(more[0].length), index) }) && more.n) {
            ids.push(more.n.ids);
            after = after.slice(more.m[0].length + more.n.end);
          }
          const group = ids.map((x) => ({ ...pick(x), raw: src.slice(0, n.end).trim(), fuzzy: n.fuzzy }));
          for (let gi = 0; gi < group.length; gi++) {
            const seg = {
              ...group[gi],
              lead: ci === 0 && gi === 0 ? lead : clauseLead,
              content: after,
            };
            lineSegs.push(seg);
            segInLine = seg;
          }
          continue;
        }
        if (ci === 0) {
          // No name at the start of the line: a name inside it, or an unknown name, or a continuation.
          const any = nameAnywhere(clauseText, index);
          if (any && hasStatusWord(body)) {
            const before = clauseText.slice(0, any.start);
            const seg = { ...pick(any.ids), raw: clauseText.slice(any.start, any.end), lead, content: before + ' ' + clauseText.slice(any.end) };
            lineSegs.push(seg);
            segInLine = seg;
            continue;
          }
          const unk = unknownNameAtStart(clauseText);
          if (unk && (lead || hasStatusWord(clauseText) || /^\s*[א-ת"'׳״\s]+\s*[-–—:]/.test(clauseText) || /\d/.test(clauseText.slice(unk.end - 1)))) {
            const seg = { id: null, raw: unk.name, unknown: true, lead, content: clauseText.slice(unk.end) };
            lineSegs.push(seg);
            segInLine = seg;
            continue;
          }
          if (any) {
            const seg = { ...pick(any.ids), raw: clauseText.slice(any.start, any.end), lead, content: clauseText.slice(0, any.start) + ' ' + clauseText.slice(any.end) };
            lineSegs.push(seg);
            segInLine = seg;
            continue;
          }
        }
        if (ci > 0 && segInLine) {
          // "בנימין 14:00, צביקה 14:45" - a new, not-yet-known student followed by a time or a status.
          const unk = unknownNameAtStart(clauseText.trimStart());
          if (unk && /^\s*(?:\d|(?:לא\s+)?(?:הגיע|בא|היה|הודיע|ביטל|הבריז|התקשר|נעלם|חולה))/.test(clauseText.trimStart().slice(unk.end))) {
            const t = clauseText.trimStart();
            const seg = { id: null, raw: unk.name, unknown: true, lead: null, content: t.slice(unk.end) };
            lineSegs.push(seg);
            segInLine = seg;
            continue;
          }
        }
        if (segInLine) segInLine.content += (segInLine.content.trim() ? ', ' : ' ') + clauseText;
        else if (last && ci === 0) {
          // A second line about the previous student.
          last.content += (last.content.trim() ? ', ' : ' ') + clauseText;
          segInLine = last;
        } else {
          const r = cleanup(clauseText);
          if (r) remarks.push(r);
        }
      }

      // "שלמה, יוסף ודוד לא הגיעו": empty segments inherit from the next one on the line.
      for (let j = lineSegs.length - 2; j >= 0; j--) {
        const s = lineSegs[j];
        if (!cleanup(s.content) && !s.lead && lineSegs[j + 1]) s.inherit = lineSegs[j + 1];
      }
      segs.push(...lineSegs);
      if (lineSegs.length) last = lineSegs[lineSegs.length - 1];
    }

    // Analyse each segment.
    const analysed = new Map();
    const analyse = (s) => {
      if (analysed.has(s)) return analysed.get(s);
      const a = analyseContent(s.content || '', ctx);
      analysed.set(s, a);
      return a;
    };
    const items = segs.map((s) => {
      const a = analyse(s);
      let src = a;
      if (!a.hasContent && s.inherit) {
        let t = s.inherit;
        while (t && !analyse(t).hasContent && t.inherit) t = t.inherit;
        if (t) src = analyse(t);
      }
      const time = s.lead ? s.lead.time : a.time;
      const len = s.lead && s.lead.len ? s.lead.len : a.len;
      return {
        studentId: s.id || null,
        alternatives: s.alternatives || [],
        ambiguous: !!s.ambiguous,
        fuzzy: !!s.fuzzy,
        name: s.raw,
        unknown: !!s.unknown,
        time: time || null,
        len: len || null,
        explicitTime: !!time,
        was: a.was,
        status: src.status || (src.hasContent || a.hasContent ? 'came' : null),
        summary: src === a ? a.summary : (a.summary || src.summary),
        tasks: a.tasks,
        mentionedOnly: !a.hasContent && !(src !== a),
      };
    });

    // A name alone ("יוסף") counts as "came" unless the whole block is a schedule.
    const plan = items.length >= 2 && items.every((it) => it.explicitTime && it.mentionedOnly);
    if (!plan) for (const it of items) if (!it.status && it.mentionedOnly) it.status = 'came';
    if (plan) for (const it of items) it.status = null;

    if (items.length || remarks.length || everyoneElseCame) {
      days.push({ date: b.date, explicitDate: b.explicit, items, plan, everyoneElseCame, remarks });
    }
  }
  return { days };
}
