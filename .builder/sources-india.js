/* Every government job an MP student can apply for, beyond the MP portals the app reads directly (MPESB, MPPSC, iForms).
   discovery(): a public job-listing page (FreeJobAlert "latest notifications") is used ONLY to discover recruitments,
     incl. small MP recruiters (MANIT, AIIMS Bhopal, NCL, ESIC Indore …) and new ones nobody has listed yet. Sections kept:
     all-India ones (UPSC, SSC, Banks, Railways, Defence, Other All India, Govt Finance) + Madhya Pradesh. Other states'
     jobs (usually need that state's domicile) are left out. For each job the official notification PDF / website /
     apply link is taken from its detail page (fetched once, cached), and the app always shows the official links.
   ssc(): Staff Selection Commission notice board, read from ssc.gov.in's own API.
   upsc(): UPSC active examinations page. */
const crypto = require('crypto');
const { findApplyPage } = require('./deeplink');
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0 Mobile Safari/537.36';
const get = async (u, opt = {}) => { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
  try { const r = await fetch(u, { ...opt, signal: ctl.signal, headers: { 'User-Agent': UA, ...(opt.headers || {}) } }); if (!r.ok) throw new Error(r.status + ' ' + u); return await r.text(); } finally { clearTimeout(t); } };
const text = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;/g, '–').replace(/&#8217;/g, "'").replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const dmy = s => { const m = String(s || '').match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (!m) return null; const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
const md5 = s => crypto.createHash('md5').update(s).digest('hex');

// listing sections → category shown in the app; null = not for MP students
const SECTION = { 'Banks': 'bank', 'Other Govt Finance': 'bank', 'UPSC': 'upsc', 'SSC': 'ssc', 'Other All India': 'central', 'Defence': 'defence', 'Railways': 'railway', 'Madhya Pradesh': 'mp' };
// recruiters the app already reads from their own official MP portals
const OWN = /^(?:MP\s*)?(?:MPPSC|MPESB|MP\s*ESB|MPPEB|Vyapam|MPSSB|MP\s*PSC)\b|^MP\s*(?:Public Service Commission|Employees? Selection Board)/i;
const CAT_OF_TITLE = t => /railway|rrb|rrc\b/i.test(t) ? 'railway' : /\bbank|sbi\b|ibps|nabard|rbi\b/i.test(t) ? 'bank' : /\bssc\b/i.test(t) ? 'ssc' : /upsc/i.test(t) ? 'upsc'
  : /army|navy|air ?force|agniveer|bsf|crpf|cisf|itbp|ssb\b|assam rifles|coast guard|police/i.test(t) ? 'defence' : /teacher|tgt|pgt|prt|professor|faculty|kvs|nvs|kv\b/i.test(t) ? 'teaching' : null;

async function discovery(cache, max = 60, maxPdf = 0) {
  const html = await get('https://www.freejobalert.com/latest-notifications/'), out = [];
  const parts = html.split(/<table/i);
  for (let i = 1; i < parts.length; i++) {
    const section = text(parts[i - 1].slice(-400)).split(/Get Details|>/).pop().trim();
    const sec = Object.keys(SECTION).find(k => section.endsWith(k)); if (!sec) continue;
    for (const tr of parts[i].split('</table')[0].split(/<tr/i).slice(2)) {
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]); if (cells.length < 6) continue;
      const link = (tr.match(/href="(https:\/\/www\.freejobalert\.com\/articles\/[^"]+)"/) || [])[1]; if (!link) continue;
      const board = text(cells[1]), post = text(cells[2]), qual = text(cells[3]), advt = text(cells[4]).replace(/^–$/, ''), last = dmy(cells[5]);
      if (OWN.test(board)) continue;
      const id = (link.match(/-(\d{5,})\/?$/) || [])[1] || md5(link).slice(0, 10);
      const posts = Number((post.match(/[–-]\s*([\d,]+)\s*Posts?/i) || [])[1]?.replace(/,/g, '')) || null;
      out.push({ key: 'JOB-' + id, src: board, scope: sec === 'Madhya Pradesh' ? 'mp' : 'india', cat: SECTION[sec] === 'mp' ? (CAT_OF_TITLE(board + ' ' + post) || 'mp') : SECTION[sec],
        title: board + ' · ' + post.replace(/\s*–\s*[\d,]+\s*Posts?$/i, ''), posts, qual, advt: advt || null, date: dmy(cells[0]), last, via: 'listing', ref: link });
    }
  }
  // official links from each job's detail page: only new jobs, at most `max` per run (the rest next run)
  let fetched = 0;
  for (const x of out) {
    const c = cache[x.key];
    x.mode = modeOf(x);
    if (c && c.v === 4) { Object.assign(x, c); continue; }
    if (fetched >= max) { if (c) Object.assign(x, c); continue; } fetched++;
    try {
      const o = officialLinks(await get(x.ref)); if (c) { for (const k of ['salary', 'payLevel', 'stipend', 'salarySrc', 'pdfTried']) if (o[k] == null && c[k] != null) o[k] = c[k]; }
      Object.assign(x, o); Object.assign(o, x.mode === 'online' ? await applyCheck(x) : { applyKind: null }, { v: 4 });
      // only a home page (or no apply link): look for this job's current application page on the official site
      if (x.mode === 'online' && (o.applyKind === 'home' || o.applyKind == null || o.applyKind === 'dead') && (o.site || o.apply)) {
        const f = await findApplyPage({ ...x, ...o }).catch(() => null); if (f) Object.assign(o, f);
      }
      Object.assign(x, cache[x.key] = o);
    } catch (e) { if (c) Object.assign(x, c); }
  }
  // no salary on the job page: read it from the official notification PDF (once per job, at most maxPdf per run)
  let pdfs = 0;
  for (const x of out) { const c = cache[x.key]; if (!c || x.salary || !x.pdf || c.pdfTried || pdfs >= maxPdf) continue; pdfs++; c.pdfTried = 1;
    const s = salaryFromText(await pdfText(x.pdf)); if (s) { Object.assign(c, s); Object.assign(x, s); } }
  // same job listed in two sections: keep one
  const seen = new Set(); return out.filter(x => !seen.has(x.key) && seen.add(x.key));
}
/* official links in a listing's detail page: notification PDF, apply link, official website (never other listing sites) */
function officialLinks(html) {
  const body = html.split(/Important Links|Useful Links|Important Link/i).slice(1).join(' ') || html;
  // a link's meaning is usually in its row label ("Apply Online: Click Here"), so read the label with the link text
  const as = body.split(/<\/li>|<\/tr>|<\/p>|<br\s*\/?>/i).flatMap(chunk => [...chunk.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map(m => { const own = text(m[2]); const label = text(chunk.replace(m[0], ' ')).replace(/[:\-–|]+\s*$/, '').slice(0, 120); return { u: m[1].replace(/&amp;/g, '&'), t: /^(click|here|link|download|visit)\b/i.test(own) || own.length < 4 ? label + ' ' + own : own }; }))
    .filter(a => !/freejobalert|sarkari|telegram|whatsapp|facebook|twitter|instagram|youtube|google|cluestoday|marketshost|rojgarlive|stylishscape|t\.me|play\.google|linkedin/i.test(a.u));
  const gov = a => /\.(gov|nic|ac|edu|res)\.in\b|\.gov\b|\.org\.in\b|ibps\.in|bank|rrb|cdac|nta\.ac\.in/i.test(a.u);
  const pdf = as.find(a => /\.pdf(\?|$)/i.test(a.u) && /notification|advertisement|advt|pdf/i.test(a.t)) || as.find(a => /\.pdf(\?|$)/i.test(a.u)),
    apply = as.find(a => /apply|application|registration|register|form/i.test(a.t) && !/result|admit|answer key|\.pdf/i.test(a.t + ' ' + a.u)), site = as.find(a => /^www\.|official website|website/i.test(a.t)) || as.find(gov);
  return { pdf: pdf ? pdf.u : null, apply: apply ? apply.u : null, site: site ? site.u : null, ...salaryOf(html) };
}
/* expected salary from a job's detail page: the "Salary / Initial Salary" box (₹21,700 - ₹35,400 /month), else the
   "Pay Scale / Pay Level" row, else a stipend line. stipend:true marks training stipends (not a regular salary). */
function salaryOf(html) {
  const t = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<\/(tr|p|li|h\d|div)>/gi, '\n').replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, ' ')
    .replace(/&#8211;|&ndash;/g, '-').replace(/&#8377;|&#x20b9;/gi, '₹').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
  const L = t.split('\n').map(x => x.trim()).filter(Boolean);
  const money = /₹\s?[\d,]{4,}(?:\s*[-–]\s*₹?\s?[\d,]{4,})?(?:\s*\/\s*(?:month|pm|year|annum))?/i;
  let salary = null, level = null;
  for (let i = 0; i < L.length - 1 && !salary; i++) if (/^(?:initial\s+)?(?:salary|pay|stipend)$/i.test(L[i])) { const m = (L[i + 1].match(money) || L[i + 2] && L[i + 2].match(money) || [])[0]; if (m) salary = m; }
  const row = L.find(x => /^(?:pay\s*scale|pay\s*level|salary|pay|stipend)\s*\|/i.test(x));
  if (row) { const v = row.split('|').slice(1).join(' ').trim(); if (/level|₹|rs\.?\s?\d|\d{4,}/i.test(v)) level = v.slice(0, 80); }
  if (!salary && level) { const m = level.match(/(?:₹|Rs\.?)\s?[\d,]{4,}(?:\s*[-–\/]\s*(?:₹|Rs\.?)?\s?[\d,]{4,})?/i); if (m) salary = m[0].replace(/Rs\.?\s?/gi, '₹'); }
  const stipend = /stipend/i.test((L.find(x => money.test(x) && /stipend/i.test(x)) || '') + ' ' + (row || '')) || /^(?:stipend)/i.test(row || '');
  return { salary: salary ? salary.replace(/\s+/g, ' ') : null, payLevel: level && /level/i.test(level) ? level.replace(/^.*?(7th CPC\s*)?(pay\s*)?(level)/i, 'Level').slice(0, 40) : null, stipend: stipend || undefined };
}

/* How a job is applied for, and whether its apply link really opens that exam's application form.
   mode: 'online' | 'offline' (post the filled notification form) | 'walkin' (interview on a date)
   applyKind: 'form'   the page itself has a form / registration for this exam (AI agent can fill it)
              'portal' a recruitment portal page that leads to the form (registration / login link on it)
              'home'   just the organisation's home page (not the form) · 'dead' does not open */
function modeOf(x) {
  const t = ((x.ref || '').split('/').pop() + ' ' + x.title).toLowerCase();
  return /walk-?in/.test(t) ? 'walkin' : /offline/.test(t) && !/online/.test(t) ? 'offline' : 'online';
}
async function applyCheck(x) {
  if (!x.apply) return { applyKind: null };
  let u; try { u = new URL(x.apply); } catch (e) { return { applyKind: 'dead' }; }
  if (/forms\.gle|docs\.google\.com\/forms|forms\.(?:office|cloud\.microsoft)/.test(u.host + u.pathname)) return { applyKind: 'form' };   // Google / Microsoft form = the form itself
  let html = '';
  try { html = await get(x.apply); } catch (e) { return { applyKind: /403|401/.test(e.message) ? 'portal' : 'dead' }; }
  const inputs = (html.match(/<input(?![^>]*type=["']?(?:hidden|submit|button|search)\b)[^>]*>/gi) || []).length, sel = (html.match(/<select\b/gi) || []).length;
  const spa = /<app-root|ng-version|id=["']root["']|__next|data-reactroot/i.test(html) && html.length < 60000;
  const reg = /new\s*registration|register\s*now|click here (?:for|to) (?:new )?regist|apply online|online application|create (?:an )?account|sign\s*up|candidate login|login for (?:already )?registered/i.test(html);
  const rootOnly = (u.pathname === '/' || u.pathname === '' || /^\/(?:index|default|home)\.(?:php|aspx?|html?)$/i.test(u.pathname)) && !u.hash;
  if (!rootOnly && (inputs + sel >= 3 || reg || spa)) return { applyKind: inputs + sel >= 3 ? 'form' : 'portal' };
  if (rootOnly && /ibpsreg|digialm|rrbapply|ssc\.gov|upsconline|ncs\.gov|mponline|recruitment|rect\.|career/i.test(u.host)) return { applyKind: 'portal' };
  return { applyKind: rootOnly ? 'home' : (reg ? 'portal' : 'home') };
}

/* Expected salary straight from the official notification PDF, when the job page doesn't say. Reads "Pay Level 6",
   "Pay Matrix Level-4", "Scale of pay Rs. 25,500-81,100", "consolidated Rs. 30,000 per month", "वेतनमान …".
   A 7th-CPC level alone becomes its starting basic pay. Needs pdfjs-dist (installed on the nightly PC; the cloud job
   reuses what the PC found through the cache). */
const LEVEL_PAY = { 1: 18000, 2: 19900, 3: 21700, 4: 25500, 5: 29200, 6: 35400, 7: 44900, 8: 47600, 9: 53100, 10: 56100, 11: 67700, 12: 78800, 13: 123100, 14: 144200 };
let pdfjs = undefined;
async function pdfText(url, pages = 6) {
  if (pdfjs === undefined) { try { pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); } catch (e) { pdfjs = null; } }
  if (!pdfjs) return null;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': UA } }); if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer()); if (buf.length > 12e6 || String.fromCharCode(...buf.slice(0, 4)) !== '%PDF') return null;
    const doc = await pdfjs.getDocument({ data: buf, disableWorker: true, isEvalSupported: false, verbosity: 0 }).promise; let out = '';
    for (let i = 1; i <= Math.min(pages, doc.numPages); i++) { const c = await (await doc.getPage(i)).getTextContent(); out += c.items.map(x => x.str).join(' ') + '\n'; }
    return out.replace(/[ \t]+/g, ' ');
  } catch (e) { return null; } finally { clearTimeout(t); }
}
function salaryFromText(t) {
  if (!t) return null;
  const n = s => Number(String(s).replace(/,/g, ''));
  const money = '(?:Rs\\.?|₹|INR|रु\\.?|रुपये)\\s?([\\d,]{4,8})(?:\\s*(?:-|–|to|से)\\s*(?:Rs\\.?|₹|रु\\.?)?\\s?([\\d,]{4,8}))?';
  const near = new RegExp('(?:pay\\s*scale|scale\\s*of\\s*pay|pay\\s*band|pay\\s*matrix|basic\\s*pay|consolidated|emoluments?|remuneration|salary|stipend|honorarium|वेतनमान|वेतन|मानदेय)[^\\n]{0,90}?' + money, 'i');
  const m = t.match(near);
  if (m && n(m[1]) >= 5000 && n(m[1]) <= 400000 && (!m[2] || (n(m[2]) >= n(m[1]) && n(m[2]) <= 500000))) {
    const per = /per\s*month|p\.?\s?m\.?\b|monthly|प्रति\s*माह|मासिक/i.test(m[0] + t.slice(t.indexOf(m[0]) + m[0].length, t.indexOf(m[0]) + m[0].length + 40)) ? ' /month' : '';
    return { salary: '₹' + n(m[1]).toLocaleString('en-IN') + (m[2] ? ' - ₹' + n(m[2]).toLocaleString('en-IN') : '') + per, stipend: /stipend|मानदेय/i.test(m[0]) || undefined, salarySrc: 'pdf' };
  }
  // bank scale written with increments ("48480-2000/7-62480"): its first figure is the starting basic pay
  const bs = t.match(/(?:Rs\.?|₹)\s?([\d,]{5,6})\s*[-–]\s*[\d,]{3,5}\s*\/\s*\d/);
  if (bs && n(bs[1]) >= 10000) return { salary: '₹' + n(bs[1]).toLocaleString('en-IN') + ' /month', payLevel: 'starting basic pay', salarySrc: 'pdf' };
  // public-sector bank officer grades (JMGS-I … TEGS-VII): the national scale's starting basic pay
  const BANK = { 'JMGS-I': 48480, 'MMGS-II': 64820, 'MMGS-III': 85920, 'SMGS-IV': 102300, 'SMGS-V': 120940, 'TEGS-VI': 140500, 'TEGS-VII': 156500 };
  const g = t.match(/\b(JM|MM|SM|TE)\s*G\s*\/?\s*S\s*[-–]?\s*(VII|VI|V|IV|III|II|I)\b/);
  if (g) { const k = g[1] + 'GS-' + g[2]; if (BANK[k]) return { salary: '₹' + BANK[k].toLocaleString('en-IN') + ' /month', payLevel: k + ' (starting basic pay)', salarySrc: 'pdf' }; }
  const lv = t.match(/(?:pay\s*)?(?:matrix\s*)?level[\s\-–:]*(?:no\.?\s*)?(\d{1,2})\b/i);
  if (lv && LEVEL_PAY[+lv[1]] && /pay|cpc|matrix|वेतन/i.test(t.slice(Math.max(0, lv.index - 60), lv.index + 40))) return { salary: '₹' + LEVEL_PAY[+lv[1]].toLocaleString('en-IN') + ' /month', payLevel: 'Level ' + lv[1] + ' (starting basic pay)', salarySrc: 'pdf' };
  return null;
}

async function ssc() {
  const q = 'page=1&limit=30&contentType=notice-boards&key=createdAt&order=DESC&isAttachment=true&language=english&attributes=id,headline,examId,contentType,redirectUrl,startDate,endDate,language,createdAt';
  const j = JSON.parse(await get('https://ssc.gov.in/api/general-website/portal/records?' + q));
  return (j.data || []).map(x => { const a = (x.attachments || [])[0]; const h = text(x.headline);
    return { key: 'SSC-' + x.id, src: 'SSC', scope: 'india', cat: 'ssc', title: h, date: (x.createdAt || '').slice(0, 10), last: x.endDate ? String(x.endDate).slice(0, 10) : null,
      pdf: a ? 'https://ssc.gov.in/api/attachment/' + String(a.path).replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/') : null, site: 'https://ssc.gov.in/', via: 'official',
      stage: /admit|city|e-?admit/i.test(h) ? 'admit' : /result|marks|merit|allocation|FRTA/i.test(h) ? 'result' : /answer key/i.test(h) ? 'answer' : /notice of exam|examination,? 20\d\d\s*[-–]?\s*notice|notification/i.test(h) ? 'advert' : 'notice' }; });
}

async function upsc() {
  // the page lists each examination open for applications as a link "active-exams/<slug>"
  const html = await get('https://www.upsc.gov.in/examinations/active-exams'), out = [], seen = new Set();
  for (const m of html.matchAll(/<a href="(?:\/examinations\/)?active-exams\/([^"]+)"[^>]*>([^<]{6,200})</g)) {
    const title = text(m[2]); if (seen.has(m[1])) continue; seen.add(m[1]);
    out.push({ key: 'UPSC-' + md5(m[1]).slice(0, 10), src: 'UPSC', scope: 'india', cat: 'upsc', title, date: null, last: null,
      pdf: null, apply: 'https://upsconline.nic.in/', site: 'https://www.upsc.gov.in/examinations/active-exams/' + m[1], via: 'official' });
  }
  return out;
}

module.exports = { pdfText, salaryFromText, discovery, ssc, upsc, officialLinks, salaryOf, applyCheck, modeOf, OWN };
