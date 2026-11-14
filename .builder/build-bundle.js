#!/usr/bin/env node
/* Builds the signed update bundle every phone downloads.
     feed.json    exams (stable key + every lifecycle stage from the official portal) + open "items" (what the app lists) + adverts
     events.json  what changed, newest first: new exam · date extended · late-fee window · edit/correction open · admit card out ·
                  interview letter · corrigendum · applications closed · removed.  Each event: time + official link.
     rules.json   human-approved eligibility rules (tools/rules/rules.json)
     agent.js, fieldmodel.js, fieldmodel-data.js   fill agent + on-device model
     manifest.json {v, at, files:{name:{sha256,size}}} + manifest.sig (ECDSA P-256 / SHA-256, IEEE-P1363, base64)
   No student data is ever part of the bundle.
   Local:  node tools/publish/build-bundle.js [outDir]          (nightly; also refreshes agent + model unless FEED_ONLY=1)
   CI:     BUNDLE_CI=1 SIGNING_KEY="<pem>" node .builder/build-bundle.js .   (GitHub Actions every 15 min: notices + events only) */
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const CI = !!process.env.BUNDLE_CI;
const ROOT = path.join(__dirname, '..', '..'), OUT = path.resolve(process.argv[2] || path.join(__dirname, 'out'));
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0 Mobile Safari/537.36';
const get = async (u, opt = {}) => { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 45000);
  try { const r = await fetch(u, { ...opt, signal: ctl.signal, headers: { 'User-Agent': UA, ...(opt.headers || {}) } }); if (!r.ok) throw new Error(r.status + ' ' + u); return await r.text(); } finally { clearTimeout(t); } };
const text = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const flags = t => ({ court: /न्यायालय|कोर्ट|याचिका|court/i.test(t), edit: /^EDIT|संशोधन|correction/i.test(t) });
const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const parseD = s => { const d = new Date(s); return isNaN(d) ? null : d; };

/* ---------- sources ---------- */
async function esb() {
  const html = await get('https://esb.mponline.gov.in/'), out = [];
  for (const tbl of html.split('<table class="service-table">').slice(1)) {
    let cur = null;
    for (const tr of tbl.split(/<tr>/i).slice(1)) {
      const th = tr.match(/<th colspan="\d+">([\s\S]*?)<\/th>/); if (th) { cur = text(th[1]); continue; }
      const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]); if (!cur || tds.length < 5) continue;
      const d = s => (text(s).match(/\d{1,2} [A-Za-z]{3} \d{4}/) || [])[0] || null;
      const start = d(tds[2]), last = d(tds[3]); if (!start && !last) continue;
      const links = [...tds[4].matchAll(/href="([^"]+)"/g)].map(m => m[1].trim().replace(/&amp;/g, '&')).filter(h => h && h !== '#');
      const pdf = links.find(h => /\.pdf$/i.test(h)), ap = links.find(h => !/\.pdf$/i.test(h));
      const apply = ap ? (ap.startsWith('http') ? ap : 'https://esb.mponline.gov.in' + ap) : null;
      const nid = apply && (apply.match(/[?&]id=(\d+)/) || [])[1];
      out.push({ key: 'ESB-' + (nid || crypto.createHash('md5').update(cur).digest('hex').slice(0, 8)), src: 'ESB', title: cur, kind: text(tds[1]),
        stages: [{ kind: text(tds[1]), stage: 'apply', start, end: last, url: apply, pdf: pdf || null }], start, last, pdf: pdf || null, apply, ...flags(cur) });
    }
  }
  return out;
}
const STAGE = k => /refund/i.test(k) ? 'refund' : /pay for unpaid|duplicate receipt|status/i.test(k) ? null : /edit/i.test(k) ? 'edit'
  : /admit/i.test(k) ? 'admit' : /interview|call ?letter/i.test(k) ? 'interview' : /corrigendum/i.test(k) ? 'corrigendum'
  : /advertisement/i.test(k) ? 'advert' : /application form|apply/i.test(k) ? 'apply' : 'other';
async function mppscHub() {
  const base = 'https://mppsc.mponline.gov.in', html = await get(base + '/Portal/Examinations/MPPSC/Attestation/Home/Home.aspx'), out = [];
  const minYear = today.getFullYear() - 1;
  for (const t of html.split('<table class="mppsc_table">').slice(1)) {
    const hi = text((t.match(/main-head">([\s\S]*?)<\/th>/) || [])[1]); const en = text((t.match(/<\/tr>\s*<tr><th>([\s\S]*?)<\/th>/) || [])[1]);
    const stages = [];
    for (const m of t.matchAll(/<tr><td><span>([\s\S]*?)<\/span><\/td><td>([^<]*)<\/td><td>([^<]*)<\/td>\s*<td><a href="([^"]*)"/g)) {
      const kind = text(m[1]), st = STAGE(kind); if (!st) continue;
      const u = m[4].trim(); const url = u.startsWith('http') ? u : base + u;
      const start = /\d/.test(m[2]) ? m[2].trim() : null, end = /\d/.test(m[3]) ? m[3].trim() : null;
      const late = (kind.match(/late fees?\s*(?:rs\.?\s*)?([\d,]+)/i) || [])[1];
      stages.push({ kind, stage: st, start, end, url, lateFee: late ? Number(late.replace(/,/g, '')) : 0, court: /court/i.test(kind) });
    }
    const code = (stages.map(s => s.url).join(' ').match(/\/MPPSC\/(\d{4})\/([A-Za-z0-9_]+)\//) || []);
    const year = Number(code[1]) || Number((en.match(/20\d\d/) || hi.match(/20\d\d/) || [])[0]) || 0;
    if (year < minYear) continue;
    const ap = stages.filter(s => s.stage === 'apply' && s.end).sort((a, b) => parseD(b.end) - parseD(a.end))[0] || null;
    const adv = stages.find(s => s.stage === 'advert');
    out.push({ code: code[2] || null, key: 'MPPSC-' + (code[2] || crypto.createHash('md5').update(hi + en).digest('hex').slice(0, 8)), src: 'MPPSC', hub: true, year,
      title: (hi + (en && en !== hi ? ' · ' + en : '')), en, stages, kind: ap ? ap.kind : null, start: ap ? ap.start : null, last: ap ? ap.end : null,
      apply: ap && /Declaration\.aspx/i.test(ap.url) ? ap.url : null, lateFee: ap ? ap.lateFee : 0, court: !!(ap && ap.court), edit: false, pdf: adv ? adv.url : null });
  }
  // one code can hold several subject tables (e.g. Assistant Professor 2025): add the subject to keep keys unique and stable
  const n = {}; out.forEach(x => n[x.key] = (n[x.key] || 0) + 1);
  out.forEach(x => { if (n[x.key] > 1) x.key += '-' + crypto.createHash('md5').update(x.title).digest('hex').slice(0, 6); });
  // exact advertisement number for exams that are open (the declaration page names it)
  for (const x of out.filter(x => x.apply && parseD(x.last) >= today)) {
    try { const d = await get(x.apply); const a = d.match(/<a href="([^"]+\.pdf)\s*"[^>]*onclick="IsAdvertisementValidate[^>]*>([^<]*)</); if (a) { x.pdf = a[1].trim(); x.advt = text(a[2]); } } catch (e) { }
  }
  return out;
}
async function mppscAdverts() {
  const html = await get('https://mppsc.mp.gov.in/Advertisement/ajaxPaginationData/0', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: 'page=0&exam=' });
  const out = [];
  for (const tr of html.split(/<tr>/i).slice(2)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]); if (tds.length < 4) continue;
    const title = text(tds[1]), m = title.match(/Dated (\d{2})\/(\d{2})\/(\d{4})/);
    const a = (tds[tds.length - 2].match(/href='([^']+)'/) || tds[tds.length - 2].match(/href="([^"]+)"/) || [])[1], det = (tds[tds.length - 1].match(/href="([^"]+)"/) || [])[1];
    out.push({ key: 'MPPSC-ADV-' + crypto.createHash('md5').update(a || title).digest('hex').slice(0, 10), src: 'MPPSC', title: title.replace(/,? ?Dated .*/, ''), date: m ? `${m[3]}-${m[2]}-${m[1]}` : null, pdf: a || null, details: det || null });
  }
  return out.slice(0, 15);
}
async function iforms() {
  const html = await get('https://iforms.mponline.gov.in/Form/GetAllNotification'), out = [];
  let dept = '';
  for (const tr of html.split(/<tr[^>]*>/i).slice(1)) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map(m => m[1]);
    const t = text(cells.join(' '));
    const id = (t.match(/ExamID:\s*(\d+)/) || [])[1];
    if (!id) { if (t && t.length < 120 && !/login|Department and Examination/i.test(t)) dept = t; continue; }
    const docs = [...tr.matchAll(/href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => ({ url: new URL(m[1].replace(/&amp;/g, '&'), 'https://iforms.mponline.gov.in/').toString(), name: text(m[2]) })).filter(d => /\.pdf|Download|View/i.test(d.url + d.name));
    out.push({ key: 'IFORMS-' + id, src: 'iForms', title: t.replace(/\s*-\s*ExamID:\s*\d+.*/, '').slice(0, 160), dept, examId: id, pdf: (docs.find(d => /\.pdf/i.test(d.url)) || {}).url || null, details: 'https://iforms.mponline.gov.in/Form/GetAllNotification', apply: 'https://iforms.mponline.gov.in/Profile/Login', ...flags(t) });
  }
  return out.slice(0, 20);
}

/* ---------- what changed (prev → now) ---------- */
const LABEL = {
  new: ['आवेदन शुरू', 'Applications open'],
  extended: ['अंतिम तिथि बढ़ी', 'Last date extended'],
  changed: ['अंतिम तिथि बदली', 'Last date changed'],
  late: ['विलंब शुल्क के साथ आवेदन', 'Late-fee window'],
  edit: ['फॉर्म सुधार (Edit) खुला', 'Edit / correction open'],
  admit: ['प्रवेश पत्र जारी', 'Admit card out'],
  interview: ['साक्षात्कार पत्र जारी', 'Interview letter out'],
  corrigendum: ['शुद्धिपत्र जारी', 'Corrigendum issued'],
  reopen: ['आवेदन फिर खुले', 'Applications re-opened'],
  closed: ['आवेदन बंद', 'Applications closed'],
  removed: ['पोर्टल से हटाया गया', 'Removed from portal'],
  advert: ['नया विज्ञापन', 'New advertisement']
};
function diff(prev, now, at) {
  const ev = [], P = new Map(prev.map(x => [x.key, x])), N = new Map(now.map(x => [x.key, x]));
  const push = (x, type, extra = {}) => ev.push({ id: crypto.createHash('md5').update(x.key + '|' + type + '|' + (extra.detail || '') + '|' + (extra.url || '')).digest('hex').slice(0, 12),
    key: x.key, src: x.src, title: x.en || x.title, titleHi: x.title, type, hi: LABEL[type][0], en: LABEL[type][1], at, url: extra.url || x.apply || x.pdf || null, detail: extra.detail || null });
  const open = x => !!(x.last && parseD(x.last) >= today);
  for (const x of now) {
    const p = P.get(x.key);
    if (!p) { if (!x.stages) push(x, 'advert', { url: x.pdf }); else if (open(x)) push(x, 'new', { detail: x.last }); continue; }
    if (!x.stages) continue;
    if (x.last && p.last && x.last !== p.last) { const d1 = parseD(p.last), d2 = parseD(x.last); push(x, d2 > d1 ? 'extended' : 'changed', { detail: p.last + ' → ' + x.last }); }
    if (open(x) && p.last && !open(p) && !(x.last !== p.last)) push(x, 'reopen', { detail: x.last });
    if (!open(x) && open(p)) push(x, 'closed', { detail: x.last || p.last });
    const pk = new Set((p.stages || []).map(s => s.stage + '|' + s.url + '|' + s.kind));
    for (const s of x.stages || []) {
      if (pk.has(s.stage + '|' + s.url + '|' + s.kind)) continue;
      if (s.stage === 'apply' && s.lateFee && !(p.stages || []).some(q => q.stage === 'apply' && q.lateFee === s.lateFee)) push(x, 'late', { url: s.url, detail: '₹' + s.lateFee.toLocaleString('en-IN') + (s.end ? ' · ' + s.end : '') });
      else if (['edit', 'admit', 'interview', 'corrigendum'].includes(s.stage)) push(x, s.stage, { url: s.url, detail: [s.start, s.end].filter(Boolean).join(' – ') || null });
    }
  }
  for (const p of prev) if (!N.has(p.key) && p.stages && open(p)) push(p, 'removed');
  return ev;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // local runs start from what the 15-minute cloud job last published, so its events are never overwritten
  if (!CI) for (const f of ['feed.json', 'events.json']) { try { fs.writeFileSync(path.join(OUT, f), await get('https://raw.githubusercontent.com/tripathishubham1/mp-exam-hub-updates/main/' + f + '?t=' + Date.now())); } catch (e) { } }
  const parts = {}, errors = [];
  for (const [k, fn] of Object.entries({ esb, mppscHub, mppscAdverts, iforms })) {
    try { parts[k] = await fn(); } catch (e) { errors.push(k + ': ' + e.message); parts[k] = null; }
  }
  const prev = fs.existsSync(path.join(OUT, 'feed.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'feed.json'), 'utf8')) : { sources: {} };
  // a source that failed keeps its previous items (no false "removed"/"closed" events from an outage)
  const prevSrc = { esb: (prev.exams || []).filter(x => x.src === 'ESB'), mppscHub: (prev.exams || []).filter(x => x.src === 'MPPSC'), mppscAdverts: (prev.sources && prev.sources.mppscAdverts) || [], iforms: (prev.sources && prev.sources.iforms) || [] };
  const sources = {}; for (const k of Object.keys(parts)) sources[k] = parts[k] || prevSrc[k] || [];
  const exams = [].concat(sources.esb, sources.mppscHub);
  // what the app lists: open application windows + recent advertisements / iForms notices
  const items = [].concat(sources.esb, sources.mppscHub.filter(x => x.apply && parseD(x.last) >= today), sources.mppscAdverts, sources.iforms).map(x => Object.assign({}, x, { id: x.key }));
  const at = new Date().toISOString();
  // events: diff against the last run (first run only sets the baseline)
  let events = fs.existsSync(path.join(OUT, 'events.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'events.json'), 'utf8')).events || [] : [];
  const fresh = [];
  if (prev.exams) fresh.push(...diff(prev.exams, exams, at));
  if (prev.exams && prev.sources && prev.sources.mppscAdverts && parts.mppscAdverts) fresh.push(...diff(prev.sources.mppscAdverts, sources.mppscAdverts, at));
  const seen = new Set(events.map(e => e.id)); for (const e of fresh.reverse()) if (!seen.has(e.id)) events.unshift(e);
  events = events.filter(e => Date.now() - Date.parse(e.at) < 120 * 864e5).slice(0, 300);
  const feed = { at, items, exams, sources: { mppscAdverts: sources.mppscAdverts, iforms: sources.iforms }, errors };
  // nothing new since the last run: keep the published files untouched (no commit, no phone download)
  const same = JSON.stringify([prev.items, prev.exams, prev.sources]) === JSON.stringify([items, exams, feed.sources]);
  if (CI && same && !fresh.length) { console.log('no change in notices'); return; }
  if (same && prev.at) feed.at = prev.at;
  fs.writeFileSync(path.join(OUT, 'feed.json'), JSON.stringify(feed));
  fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify({ at, events }));
  if (!CI) {
    const rulesFile = path.join(ROOT, 'tools', 'rules', 'rules.json');
    fs.writeFileSync(path.join(OUT, 'rules.json'), fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile) : '{"exams":[]}');
    // FEED_ONLY=1 (nightly checks failed): ship fresh notices but keep last night's agent + model
    for (const f of ['agent.js', 'fieldmodel.js', 'fieldmodel-data.js']) if (!(process.env.FEED_ONLY && fs.existsSync(path.join(OUT, f)))) fs.copyFileSync(path.join(ROOT, 'www', f), path.join(OUT, f));
    // the builder travels with the bundle so GitHub Actions runs exactly this code
    fs.mkdirSync(path.join(OUT, '.builder'), { recursive: true }); fs.copyFileSync(__filename, path.join(OUT, '.builder', 'build-bundle.js'));
  }
  const files = {};
  for (const f of ['feed.json', 'events.json', 'rules.json', 'agent.js', 'fieldmodel.js', 'fieldmodel-data.js']) { if (!fs.existsSync(path.join(OUT, f))) continue; const b = fs.readFileSync(path.join(OUT, f)); files[f] = { sha256: crypto.createHash('sha256').update(b).digest('base64'), size: b.length }; }
  const manifest = JSON.stringify({ v: Date.now(), at, files });
  const key = process.env.SIGNING_KEY || fs.readFileSync(path.join(ROOT, 'keys', 'update-signing.pem'), 'utf8');
  const sig = crypto.sign('sha256', Buffer.from(manifest), { key, dsaEncoding: 'ieee-p1363' }).toString('base64');
  fs.writeFileSync(path.join(OUT, 'manifest.json'), manifest); fs.writeFileSync(path.join(OUT, 'manifest.sig'), sig);
  if (!fs.existsSync(path.join(OUT, 'index.html'))) fs.writeFileSync(path.join(OUT, 'index.html'), '<!doctype html><meta charset="utf-8"><title>MP Exam Hub updates</title><p>Signed update bundle for the MP Exam Hub app. Public notices and exam rules only; no personal data.</p>');
  console.log(`bundle → ${OUT}${CI ? ' (CI: notices + events only)' : ''}`);
  for (const k of Object.keys(sources)) console.log(`  ${k.padEnd(13)} ${String((sources[k] || []).length).padStart(3)} ${parts[k] ? '' : '(kept from last run)'}`);
  console.log(`  exams tracked ${exams.length} · listed items ${items.length} · new events ${fresh.length} · events kept ${events.length}`);
  if (errors.length) console.log('  errors:', errors.join(' | '));
  for (const e of fresh.slice(0, 12)) console.log(`  + ${e.type.padEnd(11)} ${String(e.title).slice(0, 60)} ${e.detail || ''}`);
}
module.exports = { diff, STAGE };
if (require.main === module) main();
