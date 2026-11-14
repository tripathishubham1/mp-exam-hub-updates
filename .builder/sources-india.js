/* Every government job an MP student can apply for, beyond the MP portals the app reads directly (MPESB, MPPSC, iForms).
   discovery(): a public job-listing page (FreeJobAlert "latest notifications") is used ONLY to discover recruitments,
     incl. small MP recruiters (MANIT, AIIMS Bhopal, NCL, ESIC Indore …) and new ones nobody has listed yet. Sections kept:
     all-India ones (UPSC, SSC, Banks, Railways, Defence, Other All India, Govt Finance) + Madhya Pradesh. Other states'
     jobs (usually need that state's domicile) are left out. For each job the official notification PDF / website /
     apply link is taken from its detail page (fetched once, cached), and the app always shows the official links.
   ssc(): Staff Selection Commission notice board, read from ssc.gov.in's own API.
   upsc(): UPSC active examinations page. */
const crypto = require('crypto');
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

async function discovery(cache, max = 60) {
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
    if (c && c.v === 2) { Object.assign(x, c); continue; }
    if (fetched >= max) continue; fetched++;
    try { Object.assign(x, cache[x.key] = officialLinks(await get(x.ref))); } catch (e) { }
  }
  // same job listed in two sections: keep one
  const seen = new Set(); return out.filter(x => !seen.has(x.key) && seen.add(x.key));
}
/* official links in a listing's detail page: notification PDF, apply link, official website (never other listing sites) */
function officialLinks(html) {
  const body = html.split(/Important Links|Useful Links|Important Link/i).slice(1).join(' ') || html;
  const as = [...body.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ u: m[1].replace(/&amp;/g, '&'), t: text(m[2]) }))
    .filter(a => !/freejobalert|sarkari|telegram|whatsapp|facebook|twitter|instagram|youtube|google|cluestoday|marketshost|rojgarlive|stylishscape|t\.me|play\.google|linkedin/i.test(a.u));
  const gov = a => /\.(gov|nic|ac|edu|res)\.in\b|\.gov\b|\.org\.in\b|ibps\.in|bank|rrb|cdac|nta\.ac\.in/i.test(a.u);
  const pdf = as.find(a => /\.pdf(\?|$)/i.test(a.u)), apply = as.find(a => /apply|application|registration|register|form/i.test(a.t) && !/\.pdf/i.test(a.u)), site = as.find(a => /^www\.|official website|website/i.test(a.t)) || as.find(gov);
  return { v: 2, pdf: pdf ? pdf.u : null, apply: apply ? apply.u : null, site: site ? site.u : null, ...salaryOf(html) };
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

module.exports = { discovery, ssc, upsc, officialLinks, salaryOf, OWN };
