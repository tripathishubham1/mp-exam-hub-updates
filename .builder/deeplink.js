/* Find the real application page for a job when we only know the organisation's home page.
   Crawls the official site a little (home → Careers / Recruitment pages → this job's "Apply Online" link) and scores every
   link for being THIS job's CURRENT application:
     + post-name words and the advertisement number of this job, the current year, "apply online / registration" words
     − older years, results / admit cards / answer keys / interview lists / archives (stale or wrong stage), other jobs' posts
   The winner is opened and must look like a live form or registration (fields, "new registration", login) and must not say
   the registration is closed. Nothing is accepted on a guess: if no link clears the bar the job keeps its home page.
   Only official hosts of the same organisation are followed (never listing sites). Budget: ~8 page loads per job. */
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0 Mobile Safari/537.36';
const get = async (u) => { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
  try { const r = await fetch(u, { signal: ctl.signal, redirect: 'follow', headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(r.status + ' ' + u);
    const ct = r.headers.get('content-type') || ''; if (!/html|text/i.test(ct)) throw new Error('not html'); return { html: (await r.text()).slice(0, 800000), url: r.url }; } finally { clearTimeout(t); } };
const text = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '-').replace(/\s+/g, ' ').trim();

const GENERIC = new Set('recruitment various posts post officer officers the and for with notification online apply jobs vacancy vacancies 2024 2025 2026 2027 advt advertisement contract basis regular deputation cum bank india indian limited ltd manager managers senior junior assistant assistants deputy general head chief executive executives staff more other others specialist specialists associate associates trainee trainees grade group level department national state central professor faculty'.split(' '));
const words = s => [...new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter(w => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w)))];
const STALE = /\b(result|answer\s*key|admit\s*card|call\s*letter|hall\s*ticket|interview\s*(schedule|list)|selected|selection\s*list|merit\s*list|marks|cut[\s-]*off|archive|old\s*(notification|recruitment)|expired|closed|corrigendum|score\s*card|document\s*verification)\b/i;
const APPLY = /apply\s*online|online\s*application|new\s*registration|register|registration|application\s*form|apply\s*now|click\s*here\s*to\s*apply|online\s*form/i;
const LISTING = /career|recruit|vacanc|job|opportunit|employment|notice|advertisement|rozgar|भर्ती|रिक्ति/i;
const CLOSED = /(registration|application|link)[^.]{0,40}(closed|expired|disabled|not\s*active|over)|last\s*date[^.]{0,30}(over|expired)|no\s*(current\s*)?(openings|vacanc)/i;

const sameOrg = (a, b) => { const k = h => h.replace(/^www\./, '').split('.').filter(p => !/^(gov|nic|org|co|ac|edu|res|in|com|bank|net)$/.test(p)).pop() || h; try { return k(new URL(a).hostname) === k(new URL(b).hostname); } catch (e) { return false; } };
// known application platforms used by many recruiters (link to them from an official page is fine)
const PLATFORM = /ibpsreg\.ibps\.in|ibpsonline\.ibps\.in|digialm\.com|rrbapply\.gov\.in|upsconline\.(nic|gov)\.in|ssc\.gov\.in|ncs\.gov\.in|mponline\.gov\.in|onlineapplicationform\.org|recruitment\.nta\.(ac|nic)\.in|cbtexam\.in|ntaonline|iitb\.ac\.in\/|gov\.in|nic\.in/i;

function links(html, base) {
  // every link with its own text and the text of its row / list item (labels like "Apply Online: Click Here")
  const out = [];
  for (const chunk of html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').split(/<\/(?:li|tr|p|div|h\d)>|<br\s*\/?>/i)) {
    const ctx = text(chunk).slice(0, 300);
    for (const m of chunk.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      let u; try { u = new URL(m[1].replace(/&amp;/g, '&'), base).href; } catch (e) { continue; }
      if (!/^https:?\/\//i.test(u) && !/^http:/.test(u)) continue;
      if (/\.(pdf|jpe?g|png|zip|docx?|xlsx?)(\?|$)/i.test(u) || /mailto:|javascript:|whatsapp|facebook|twitter|youtube|instagram|linkedin|t\.me/i.test(u)) continue;
      out.push({ u, t: text(m[2]) || (m[0].match(/title=["']([^"']+)/i) || [])[1] || '', ctx });
    }
  }
  return out;
}

function score(l, job, now) {
  const all = (l.t + ' ' + l.ctx + ' ' + decodeURIComponent(l.u)).toLowerCase();
  let s = 0; const why = [];
  const need = Math.min(2, job.words.length), hit = job.words.filter(w => all.includes(w)); if (need && hit.length >= need) { s += 3 * Math.min(hit.length, 3); why.push('post:' + hit.join(',')); } else hit.length = 0;
  if (job.advt && job.advtRe.test(all)) { s += 8; why.push('advt'); }
  const years = [...all.matchAll(/\b(20\d\d)\b/g)].map(m => +m[1]);
  if (years.some(y => y >= now.year)) { s += 2; why.push('year'); }
  else if (years.length && Math.max(...years) < now.year - (now.month <= 2 ? 1 : 0)) { s -= 8; why.push('old-year'); }
  if (APPLY.test(l.t) || APPLY.test(l.ctx)) { s += 4; why.push('apply'); }
  if (STALE.test(l.t) || (STALE.test(l.ctx) && !APPLY.test(l.t)) || /\/(?:oecl[ab]|intcl[ab]|pecl[ab]|pocl[ab]|scda|cla|result|admit|callletter|scorecard|answerkey|marks)[_\-\/]/i.test(l.u)) { s -= 10; why.push('stale'); }
  // the link names an older month-year ("Dec2025") than this year: an earlier recruitment
  const my = decodeURIComponent(l.u + ' ' + l.t).match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_-]*(20\d\d)/i); if (my && +my[1] < now.year) { s -= 8; why.push('old-link'); }
  if (PLATFORM.test(l.u) && !sameOrg(l.u, job.site)) { s += 2; why.push('platform'); }
  return { s, why, hits: hit.length };
}

function pageKind(html) {
  const inputs = (html.match(/<input(?![^>]*type=["']?(?:hidden|submit|button|search|checkbox|radio)\b)[^>]*>/gi) || []).length, sel = (html.match(/<select\b/gi) || []).length;
  const pw = /type=["']?password/i.test(html);
  const spa = /<app-root|ng-version|id=["']root["']|__next|data-reactroot/i.test(html) && html.length < 60000;
  const reg = /new\s*registration|register\s*now|click here (?:for|to) (?:new )?regist|online application|create (?:an )?account|sign\s*up|candidate login|login for (?:already )?registered|apply\s*online/i.test(html);
  if (CLOSED.test(text(html).slice(0, 20000))) return 'closed';
  if (inputs + sel >= 3 && !pw) return 'form';
  if (pw || reg || spa) return 'portal';
  return null;
}

async function findApplyPage(job, opt = {}) {
  const start = job.apply && job.applyKind === 'home' ? job.apply : job.site; if (!start || /\.pdf(\?|$)/i.test(start)) return null;
  const d = new Date(); const now = { year: d.getFullYear(), month: d.getMonth() + 1 };
  const post = String(job.title || '').split('·').pop();
  const J = { site: start, words: words(post), advt: job.advt && job.advt.replace(/[^0-9a-z]/gi, '').length >= 3 ? job.advt : null };
  if (J.advt) J.advtRe = new RegExp(J.advt.replace(/[^0-9a-z]+/gi, '.{0,3}').replace(/^\.\{0,3\}|\.\{0,3\}$/g, ''), 'i');
  let budget = opt.budget || 8; const seen = new Set(), cands = [], log = [];
  const visit = async (u, depth) => {
    if (budget <= 0 || seen.has(u)) return; seen.add(u); budget--;
    let pg; try { pg = await get(u); } catch (e) { log.push('x ' + u); return; }
    const ls = links(pg.html, pg.url).filter(l => sameOrg(l.u, start) || PLATFORM.test(l.u));
    for (const l of ls) { const sc = score(l, J, now); cands.push({ ...l, ...sc, depth }); }
    if (depth >= 1) return;
    // hop into the site's careers / recruitment pages (fresh ones first)
    const hubs = ls.filter(l => LISTING.test(l.t + ' ' + l.u) && !STALE.test(l.t)).map(l => ({ l, s: score(l, J, now).s + (/career|recruit/i.test(l.t + l.u) ? 3 : 0) }))
      .sort((a, b) => b.s - a.s).slice(0, 3);
    for (const h of hubs) await visit(h.l.u, depth + 1);
  };
  await visit(start, 0);
  // this job's own apply link: must name the post or the advertisement, and lean "apply"
  const best = [...new Map(cands.map(c => [c.u, c])).values()].filter(c => (c.hits > 0 || c.why.includes('advt')) && c.s >= 9 && c.u !== start)
    .sort((a, b) => b.s - a.s).slice(0, 3);
  for (const c of best) {
    if (budget-- <= -3) break;
    let pg; try { pg = await get(c.u); } catch (e) { if (/40[13]/.test(e.message) && c.why.includes('apply')) return { apply: c.u, applyKind: 'portal', found: 'crawl', why: c.why.join(' ') }; continue; }
    const k = pageKind(pg.html);
    if (k === 'closed') { log.push('closed ' + c.u); continue; }
    if (k) return { apply: pg.url, applyKind: k, found: 'crawl', why: c.why.join(' ') };
    // the job's own page (details + its apply button): look one step further for the apply link on it
    const inner = links(pg.html, pg.url).map(l => ({ ...l, ...score(l, J, now) })).filter(l => APPLY.test(l.t + ' ' + l.ctx) && l.s >= 4 && !l.why.includes('stale')).sort((a, b) => b.s - a.s)[0];
    if (inner) { try { const p2 = await get(inner.u); const k2 = pageKind(p2.html); if (k2 && k2 !== 'closed') return { apply: p2.url, applyKind: k2, found: 'crawl', why: c.why.concat(inner.why).join(' ') }; } catch (e) { if (/40[13]/.test(e.message)) return { apply: inner.u, applyKind: 'portal', found: 'crawl', why: 'login-guarded' }; } }
  }
  if (opt.debug) return { none: true, log, top: best.map(c => [c.s, c.u, c.why.join(' ')]) };
  return null;
}
module.exports = { findApplyPage, links, score, pageKind };
