/* MP Exam Hub fill agent v2.
   Injected into an official portal page. Reads every visible field, works out which profile value it wants
   (field ID conventions first, then the field's own label), checks the value fits the field, and fills it.
   Guardrails: never touches password / OTP / CAPTCHA / Aadhaar / bank / payment fields, never ticks
   declarations, never clicks submit, never overwrites a value already on the page. */
(function(){
if (window.MPHubAgent && window.MPHubAgent.version >= '2') return;
const VERSION = '2.1';

/* ---------- never touch ---------- */
const BLOCK = /password|पासवर्ड|\botp\b|ओटीपी|one.?time|captcha|कैप्चा|enter answer|imgcode|security (code|answer|question)|aadha+r|आधार|\buid\b|\bvid\b|virtual id|\bmpin\b|\bcvv\b|debit|credit|\batm\b|\bupi\b|ifsc|micr|account|खाता|bank|बैंक|branch|शाखा|passbook|पासबुक/i;
const BLOCK_ID = /captcha|imgcode|stopspam|antispam|botcheck|securitycode|verificationcode|password|pwd$|aadha|uid$|ifsc|account|bank|branch|passbook|micr|(^|[_$])(txt)?otp(code|no|value|number|txt)?($|[_$])|enterotp|verifyotp|mobileotp$|emailotp$/i;

/* ---------- text helpers ---------- */
const norm = s => String(s||'').toLowerCase().replace(/[_*:：|]+/g,' ').replace(/\s+/g,' ').trim();
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const word = (hay, s) => new RegExp('(^|[^\\p{L}\\p{M}\\p{N}])'+reEsc(s)+'($|[^\\p{L}\\p{M}\\p{N}])','u').test(hay);
const anyIn = (hay, list) => list.reduce((best,s)=>word(hay,norm(s))&&s.length>best?s.length:best, 0);
const textOf = el => el ? norm(el.innerText||el.textContent||'') : '';
const visible = el => { const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return r.width>0 && r.height>0 && cs.visibility!=='hidden' && cs.display!=='none'; };
const hasDeva = s => /[ऀ-ॿ]/.test(s);

/* compact field id: ctl00_ContentPlaceHolder1_txtFatherName → "fathername"; rdocat_0 → "cat" */
function compactId(el){
  let raw = (el.type==='radio' ? (el.name||el.id) : (el.id||el.name)) || '';
  raw = raw.split(/[$]/).pop();
  const segs = raw.split('_').filter(s=>s && !/^\d+$/.test(s));
  let c = segs.length ? segs[segs.length-1] : raw;
  c = c.replace(/^(txt|txy|ddl|drp|rdo|rbl|rb|chk|fu|lbl|cmb|tb|hf|cbo|sel|dd|FU|TXT|DDL|RDO|RBL|DRP)(?=[A-Z0-9])/,'').replace(/^(txt|ddl|drp|rdo|rbl)/i,'');
  return c.toLowerCase().replace(/[^a-z0-9]/g,'');
}
const fullId = el => ((el.id||'')+' '+(el.name||'')).toLowerCase();

/* the field's OWN label (closest source first); context is kept separately */
function labelsOf(el){
  const primary = [], context = [];
  // 1) explicit labels
  if (el.labels && el.type!=='radio') for (const l of el.labels) { const t=textOf(l); if (t) primary.push(t); }
  const al = el.getAttribute('aria-label'); if (al) primary.push(norm(al));
  const lb = el.getAttribute('aria-labelledby'); if (lb) lb.split(/\s+/).forEach(id=>{ const t=textOf(document.getElementById(id)); if (t) primary.push(t); });
  // 2) text just before the field inside the same container (div / td / span layouts)
  if (!primary.length) {
    let node = el, hops = 0;
    while (node && hops<3 && !primary.length) {
      let p = node.previousElementSibling;
      for (let n=0; p && n<4; n++, p=p.previousElementSibling) {
        if (p.matches('br,hr,script,style')) continue;
        if (p.matches('input,select,textarea,button')) break;
        if (p.querySelector && p.querySelector('input:not([type=hidden]),select,textarea')) break;
        const t=textOf(p); if (t && !/^\d+\.?$/.test(t)) { primary.push(t); break; }
      }
      if (primary.length) break;
      const prevText = node.previousSibling && node.previousSibling.nodeType===3 ? norm(node.previousSibling.textContent) : '';
      if (prevText.length>2) { primary.push(prevText); break; }
      node = node.parentElement; hops++;
      if (!node || node.matches('td,th,tr,table,form,fieldset,body')) break;
    }
  }
  const td = el.closest('td,th');
  if (td) {
    const tr = td.parentElement, cells = Array.from(tr.children), idx = cells.indexOf(td);
    // 3) cell to the left
    if (!primary.length) for (let i=idx-1;i>=0;i--){ const c=cells[i]; if (c.querySelector('input:not([type=hidden]),select,textarea')) break; const t=textOf(c); if (t && !/^\d+\.?$/.test(t)) { primary.push(t); break; } }
    // 4) same column in the row above (label row / input row layouts)
    if (!primary.length) { const prev = tr.previousElementSibling; if (prev && prev.children[idx] && !prev.children[idx].querySelector('input:not([type=hidden]),select,textarea')) { const t=textOf(prev.children[idx]); if (t) primary.push(t); } }
    // 5) real grids only: header row without inputs + several input rows (education tables)
    const table = td.closest('table'), head = table && (table.querySelector('thead tr') || table.rows[0]);
    const isGrid = head && head!==tr && head.children.length>=3 && !head.querySelector('input:not([type=hidden]),select,textarea') && Array.from(table.rows).filter(r=>r.querySelector('input:not([type=hidden]),select')).length>=2;
    if (isGrid) { const ch=head.children[idx]?textOf(head.children[idx]):''; const rh=!cells[0].contains(el)?textOf(cells[0]):''; if (rh&&ch) primary.unshift(rh+' · '+ch); else { if(ch) context.push(ch); if(rh) context.push(rh); } }
  }
  if (el.placeholder) context.push(norm(el.placeholder));
  if (el.title) context.push(norm(el.title));
  const fs = el.closest('fieldset'); if (fs && fs.querySelector('legend')) context.push(textOf(fs.querySelector('legend')));
  return {primary: primary.filter(Boolean).map(s=>s.slice(0,160)), context: context.filter(Boolean)};
}
/* a field that only accepts English letters (onkeypress / pattern) */
const englishField = el => /a-zA-Z|A-Za-z|alphaonly|onlyalpha|isalpha|allowalphabet|onlyenglish|englishonly/i.test((el.getAttribute('onkeypress')||'')+(el.getAttribute('onkeyup')||'')+(el.getAttribute('pattern')||'')+(el.getAttribute('oninput')||''));

/* ---------- 1) ID conventions (MPOnline / ASP.NET) — high precision ---------- */
const LEVEL = {hs:'q10', tenth:'q10', '10th':'q10', ssc:'q10', matric:'q10', highschool:'q10', hss:'q12', hsc:'q12', twelfth:'q12', '12th':'q12', inter:'q12', higher:'q12', g:'g', grad:'g', ug:'g', graduation:'g', pg:'pg', postgrad:'pg'};
const PART = {degree:'Degree', exam:'Degree', sub:'Sub', subject:'Sub', subjects:'Sub', tmark:'Total', totalmarks:'Total', maxmarks:'Total', omark:'Obt', obtmarks:'Obt', obtainedmarks:'Obt', percent:'pct', per:'pct', percentage:'pct', grade:'Div', div:'Div', division:'Div', corb:'board', coru:'board', board:'board', univ:'board', university:'board', college:'board', passyr:'year', passyear:'year', year:'year', yop:'year', rollno:'roll', roll:'roll', system:'System'};
function eduKey(level, part){
  const L=LEVEL[level], P=PART[part]; if(!L||!P) return null;
  if (L==='g') return {Degree:'gDegree', Sub:'gSub', Total:'gTotal', Obt:'gObt', pct:'gPct', Div:'gDiv', board:'gUni', year:'gYear', roll:'gRoll', System:'gSystem'}[P];
  if (L==='pg') return {Degree:'pgDegree', Sub:'pgSub', Total:'pgTotal', Obt:'pgObt', pct:'pgPct', Div:'pgDiv', board:'pgUni', year:'pgYear', roll:'pgRoll', System:'pgSystem'}[P];
  return L + ({Degree:'Degree', Sub:'Sub', Total:'Total', Obt:'Obt', pct:'pct', Div:'Div', board:'board', year:'year', roll:'roll', System:'System'}[P]);
}
function keyFromId(el){
  const c = compactId(el), f = fullId(el);
  if (!c) return null;
  if (/profileconfirmation|candidateprofil/.test(f) && /^(applicationno|registrationno|profileno|profileid|regno)$/.test(c)) return 'esbProfile';
  if (/^(registrationno|profileno|profileid|generalregno|regnno)$/.test(c)) return 'esbProfile';
  const edu = c.match(/^(hss|hsc|hs|pg|g|grad|ug|tenth|twelfth|10th|12th|ssc|matric)(degree|exam|subjects?|sub|tmark|totalmarks|maxmarks|omark|obtmarks|obtainedmarks|percentage|percent|per|grade|division|div|corb|coru|board|univ|university|college|passyr|passyear|year|yop|rollno|roll|system)$/);
  if (edu) return eduKey(edu[1], edu[2]);
  if (/^ppercent$/.test(c)) return 'pgPct'; // MPPSC typo: txtPPercent
  const T = [
    [/^(applicant|candidate)?f(irst)?name$/, 'firstName', c!=='fname' || /applicant|candidate/.test(f)],
    [/^(applicant|candidate)m(iddle)?name$|^middlename$/, 'middleName'],
    [/^(applicant|candidate)?(l(ast)?name|surname)$/, 'lastName', c!=='lname' || /applicant|candidate/.test(f)],
    [/^(applicant|candidate)?(full)?name(eng|english|inenglish|en)$/, 'nameEn'],
    [/^(applicant|candidate)?(full)?name(hindi|hin|inhindi)$/, 'name'],
    [/^(applicant|candidate|cand)(full)?name$|^fullname$/, 'nameAny'],
    [/^father(s)?(husband)?(name)?(eng|english|en|hindi|hin)?$|^fathersname$/, 'father'],
    [/^mother(s)?(name)?(eng|english|en|hindi|hin)?$/, 'mother'],
    [/^(husband|spouse|wife|husbandwife)(s)?(name)?$/, 'spouse'],
    [/^(dob|dateofbirth|birthdate|dtofbirth|dobedt|dtdob|birthdt)$/, 'dob'],
    [/^(sex|gender)$/, 'gender'],
    [/^(married|ismarried|marital|maritalstatus)$/, 'isMarried'],
    [/^(noofchild|noofchildren|children|childcount)$/, 'children'],
    [/^(domicile|ismp|mpdomicile|ismpdomicile|mpnative|isdomicile)$/, 'mp'],
    [/^(cat|category|castecategory|socialcategory|catg)$/, 'cat'],
    [/^(iscreamylayer|creamylayer|creamy)$/, 'creamy'],
    [/^(cast|caste|castename|subcaste)$/, 'casteName'],
    [/^(handi|ishandi|pwd|ispwd|ishandicapped|handicapped|divyang|isdivyang|isph|ph|isdivyangjan)$/, 'pwd'],
    [/^(religion|dharm|dharma)$/, 'religion'], [/twochild|morethantwochild|thirdchild|morethan2child/, 'twoChildRule'], [/minage(for)?marriage|underagemarriage|childmarriage|marriedbeforeminage|eligibleminagemaxage/, 'underageMarriage'], [/^(ctzind|citizen|indiancitizen|isindian|iscitizen|citizenship|nationality)$/, 'citizen'], [/^(samagra|samagraid|samagramemberid|memberid|smid)$/, 'samagra'],
    [/^(handipercent|pwdpercent|disabilitypercent)$/, 'pwdPct'],
    [/^(exsol|exsoldier|exserviceman|exsm|isexsm|isexserviceman)$/, 'exsm'],
    [/^(emp|govtemp|isgovtemp|isemployee|govemp|isgovemp|govtservant)$/, 'govtEmp'],
    [/^(punish|punished|ispunished)$/, 'punished'],
    [/^(twin|twins|istwin)$/, 'twin'], [/^(divorcee|isdivorcee|divorced|parityakta)$/, 'divorcee'], [/^(intercast|intercaste|isintercaste)$/, 'interCaste'], [/^(vikram|vikramaward|isvikram)$/, 'vikram'],
    [/^(handicertificate|haspwdcert|pwdcertificate)$/, 'pwdHasCert'], [/^(handicappedclass|pwdtype|disabilitytype|handitype)$/, 'pwdType'], [/^(phcertificateissuedate|pwdcertdate|handicertdate)$/, 'pwdCertDate'], [/^(iscowriter|cowriter|scribe|isscribe)$/, 'scribe'], [/^(isgroundlevelsitting|groundlevel|groundfloor)$/, 'groundSeat'],
    [/^(court|courtcase|iscourtcase|criminalcase)$/, 'courtCase'],
    [/^(disqual|disqualified|debarred|isdebarred)$/, 'disqualified'],
    [/^(newprofile|isnewprofile|hasprofile|oldprofile|isregistered|existingprofile)$/, 'hasProfile'],
    [/^(otp)?(mobile|mobileno|mobilenumber|phoneno|phone|contactno|mob)$/, 'mobile'],
    [/^(otp)?(email|emailadd|emailid|emailaddress|mail)$/, 'email'],
    [/^(cur|current|corr|curent|present)?(entadd|add|address|addr)$|^curentadd$/, 'address', !/^(per|par|perm)/.test(c)],
    [/^(per|par|perm|permanent)(add|address|addr)$/, 'permAddress'],
    [/^(cur|par|per|current|permanent|perm)?city$/, 'city'],
    [/^(cur|par|per|current|permanent|perm)?(pin|pincode|pinno)$/, 'pincode'],
    [/^(cur|par|per|current|permanent|perm)?landmark$/, 'landmark'],
    [/^(cur|par|per|current|permanent|perm)?state$/, 'state'],
    [/^(cur|par|per|current|permanent|perm|corr)?(district|dist)$/, 'district'],
    [/^(ewscertificateno|ewscertno|ewsno)$/, 'ewsNo'], [/^(ewsissueddate|ewscertdate|ewsdate)$/, 'ewsDate'],
    [/^(castecertno|castecertificateno|catcertno)$/, 'casteNo'], [/^(castecertdate|castecertificatedate|catcertdate)$/, 'casteDate'],
    [/^(domicileno|domicilecertno|domicilecertificateno)$/, 'domNo'], [/^(domiciledate|domicilecertdate)$/, 'domDate'],
    [/^(phcertificateno|pwdcertno|udid|udidno)$/, 'udid'],
    [/^(identificationmark|idmark|bodymark)$/, 'mark'],
    [/^(idproof|idprooftype|photoidtype)$/, 'idType'], [/^(idproofno|photoidno)$/, 'idNo'],
    [/^(candidatephoto|photo|uploadphoto|photograph)$/, '@photo'], [/^(candidatesign|sign|signature|uploadsign)$/, '@sign'],
    [/^(highestqual|highestqualification|qualification)$/, 'qual']
  ];
  for (const [re, key, ok] of T) if (re.test(c) && ok!==false) return key;
  return null;
}

/* ---------- 2) label rules (fallback, only on the field's own label) ---------- */
const ED10 = ['10th','10 th','10वीं','10 वीं','दसवीं','high school','हाई स्कूल','हाईस्कूल','matric','class x','class 10'];
const ED12 = ['12th','12 th','12वीं','12 वीं','बारहवीं','higher secondary','हायर सेकेंडरी','हायर सेकण्डरी','हायर सेकेण्डरी','intermediate','इंटरमीडिएट','class xii','class 12'];
const EDG  = ['graduation','graduate','स्नातक','bachelor'];
const BOARD = ['board','बोर्ड','university','विश्वविद्यालय','college','महाविद्यालय'];
const YEAR  = ['year','वर्ष','passing year','उत्तीर्ण वर्ष'];
const ROLL  = ['roll','रोल','अनुक्रमांक'];
const PCT   = ['percent','प्रतिशत','%','percentage'];
const NUM   = ['number','no','no.','क्रमांक','नंबर','संख्या'];
const DATE  = ['date','दिनांक','तिथि'];
const RULES = {
  esbProfile:{any:['सामान्य पंजीकरण क्रमांक','सामान्य पंजीकरण','पंजीकरण क्रमांक','पंजीयन क्रमांक','profile registration','registration no','registration number','profile id','profile no'], not:['आवेदन पत्र क्रमांक','application form','mobile','मोबाइल','udid','caste','जाति','cpct']},
  nameEn:  {all:[['name','नाम'],['english','अंग्रेजी','अंग्रेज़ी','capital']], not:['father','mother','husband','पिता','माता','पति','user']},
  firstName:{any:['first name','प्रथम नाम','पहला नाम']}, middleName:{any:['middle name','मध्य नाम']}, lastName:{any:['last name','surname','अंतिम नाम','उपनाम','सरनेम']},
  nameAny: {any:['candidate name','name of candidate','name of the candidate','applicant name','full name','अभ्यर्थी का नाम','आवेदक का नाम','उम्मीदवार का नाम','पूरा नाम','अभ्यर्थी का पूरा नाम'], not:['father','mother','husband','spouse','guardian','पिता','माता','पति','पत्नी','अभिभावक','प्रथम','मध्य','अंतिम','first','middle','last','bank','शाखा','branch']},
  father:  {any:['father','पिता का नाम','पिता/पति','father/husband','पिता'], not:['mother','माता','occupation','income','व्यवसाय','आय','पति/पत्नी']},
  mother:  {any:['mother','माता का नाम','माता'], not:['occupation','व्यवसाय','tongue','भाषा']},
  spouse:  {any:['husband','spouse','पति/पत्नी','पति का नाम','पत्नी का नाम','जीवनसाथी']},
  dob:     {any:['date of birth','birth date','dob','जन्म तिथि','जन्मतिथि','जन्म दिनांक','जन्म की तारीख']},
  gender:  {any:['gender','sex','लिंग']},
  isMarried:{any:['marital','वैवाहिक','विवाहित है','married'], not:['before','minimum age','न्यूनतम आयु','पूर्व','child','बाल']},
  religion:{any:['religion','धर्म']}, twoChildRule:{any:['more than two children','दो से अधिक संतान','दो से अधिक जीवित संतान','26 january 2001','26 जनवरी 2001','26.01.2001']}, underageMarriage:{any:['married before the minimum age','minimum age fixed for marriage','विवाह की न्यूनतम आयु','विवाह हेतु निर्धारित न्यूनतम आयु']}, citizen:{any:['citizen of india','indian citizen','भारत के नागरिक','भारतीय नागरिक','nationality','राष्ट्रीयता']}, samagra:{any:['samagra id','समग्र आईडी','समग्र id','samagra member','समग्र सदस्य']},
  children:{any:['number of children','जीवित बच्चों','बच्चों की संख्या']},
  cat:     {any:['category','श्रेणी','वर्ग','social category'], not:['certificate','प्रमाण','number','क्रमांक','date','दिनांक','sub','उप','exam','post','पद','disab','divyang','दिव्यांग','sport','खेल']},
  casteName:{any:['जाति का नाम','caste name','name of caste','उपजाति']},
  mp:      {any:['domicile','मूल निवासी','मूलनिवासी','resident of madhya pradesh'], not:['certificate','प्रमाण','number','क्रमांक','date','दिनांक','district','जिला']},
  pwd:     {any:['disab','divyang','दिव्यांग','pwd','pwbd','physically handicapped','निःशक्त','विकलांग'], not:['udid','certificate','प्रमाण','percent','प्रतिशत','type','प्रकार','class','scribe','writer','लेखक']},
  exsm:    {any:['ex-serviceman','ex serviceman','भूतपूर्व सैनिक']},
  mark:    {any:['identification mark','identity mark','पहचान चिह्न','पहचान चिन्ह','पहचान का निशान','visible mark']},
  mobile:  {any:['mobile','मोबाइल','mobile no','phone','फोन'], not:['alternate','वैकल्पिक','otp']},
  email:   {any:['email','e-mail','ईमेल','ई-मेल','mail id']},
  address: {any:['address','पता','correspondence','पत्राचार'], not:['email','ई-मेल','ईमेल','mail','pin','पिन','district','जिला','state','राज्य','city','शहर','permanent','स्थायी','bank','बैंक']},
  permAddress:{any:['permanent address','स्थायी पता']},
  district:{any:['district','जिला','जिले'], not:['exam','परीक्षा','center','centre','केंद्र','preference','प्राथमिकता','issued','जारी','रोजगार']},
  city:    {any:['city','शहर','नगर/ग्राम','town']},
  pincode: {any:['pin code','pincode','पिन कोड','पिनकोड','postal code']},
  state:   {any:['state','राज्य'], not:['service','सेवा','government','शासन']},
  q10board:{all:[ED10,BOARD]}, q10year:{all:[ED10,YEAR]}, q10roll:{all:[ED10,ROLL]}, q10pct:{all:[ED10,PCT]},
  q12board:{all:[ED12,BOARD]}, q12year:{all:[ED12,YEAR]}, q12roll:{all:[ED12,ROLL]}, q12pct:{all:[ED12,PCT]},
  gUni:{all:[EDG,BOARD]}, gYear:{all:[EDG,YEAR]}, gPct:{all:[EDG,PCT]}, gRoll:{all:[EDG,ROLL]},
  casteNo:{all:[['caste','जाति'],NUM], not:['ews','domicile','मूल','name','नाम']}, casteDate:{all:[['caste','जाति'],DATE], not:['ews','domicile','मूल','birth','जन्म']},
  ewsNo:{all:[['ews','आर्थिक'],NUM]}, ewsDate:{all:[['ews','आर्थिक'],DATE]},
  domNo:{all:[['domicile','मूल निवास'],NUM]}, domDate:{all:[['domicile','मूल निवास'],DATE]},
  udid:{any:['udid']},
  cpctNo:{all:[['cpct'],['roll','score','scorecard','स्कोर','number','no','क्रमांक']]},
  idType:{any:['id proof type','type of id','photo id type','पहचान पत्र का प्रकार','id type','identity proof'], not:['number','no','क्रमांक','नंबर']},
  idNo:{all:[['id proof','photo id','पहचान पत्र','identity card','id card'],NUM]},
  qual:{any:['highest qualification','educational qualification','शैक्षणिक योग्यता','उच्चतम योग्यता','अधिकतम योग्यता'], not:['10th','12th','10वीं','12वीं','board','बोर्ड','year','वर्ष','percent','प्रतिशत','roll','university','विश्वविद्यालय','additional','अतिरिक्त']}
};
function scoreLabel(label, rule){
  if (rule.not && anyIn(label, rule.not)) return 0;
  if (rule.any) return anyIn(label, rule.any);
  if (rule.all) { let s=0; for (const g of rule.all){ const m=anyIn(label,g); if(!m) return 0; s+=m; } return s+5; }
  return 0;
}
function keyFromLabel(primary){
  let best=null, bs=0;
  for (const lab of primary) for (const k in RULES) { const s=scoreLabel(lab,RULES[k]); if (s>bs) { bs=s; best=k; } }
  return best ? {key:best, score:bs} : null;
}

/* ---------- derived values from the profile ---------- */
function derive(values, iso){
  const v = Object.assign({}, values), d = {};
  const en = (v.nameEn||'').trim().split(/\s+/).filter(Boolean);
  if (en.length) { d.firstName=en[0]; if (en.length>1) d.lastName=en[en.length-1]; if (en.length>2) d.middleName=en.slice(1,-1).join(' '); }
  if (v.marital) d.isMarried = v.marital==='विवाहित' ? 'हाँ' : 'नहीं';
  if (v.cat==='OBC' && v.mp==='हाँ' && (iso.nclDate || v.nclDate)) d.creamy='नहीं';
  if (!v.state && v.mp==='हाँ') d.state='मध्य प्रदेश';
  if (v.address && !v.permAddress) d.permAddress=v.address;
  if (!v.city && v.district) d.city=v.district;
  if (v.pwd==='नहीं') { d.scribe='नहीं'; d.groundSeat='नहीं'; }
  if (v.pwd==='हाँ' && v.udid) d.pwdHasCert='हाँ';
  if (v.marital && v.marital!=='विवाहित') { d.twin='नहीं'; d.divorcee='नहीं'; d.underageMarriage='नहीं'; d.twoChildRule='नहीं'; }
  if (v.marital==='विवाहित' && v.children!=null && v.children!=='' && Number(v.children)<=2) d.twoChildRule='नहीं';
  for (const L of ['q10','q12','g','pg']) {
    const pctK = L==='g'?'gPct':L==='pg'?'pgPct':L+'pct', totK=L==='g'?'gTotal':L==='pg'?'pgTotal':L+'Total', obtK=L==='g'?'gObt':L==='pg'?'pgObt':L+'Obt', divK=L==='g'?'gDiv':L==='pg'?'pgDiv':L+'Div', sysK=L==='g'?'gSystem':L==='pg'?'pgSystem':L+'System';
    if (!v[pctK] && v[totK] && v[obtK]) d[pctK] = (Number(v[obtK])/Number(v[totK])*100).toFixed(2);
    const pct = Number(v[pctK]||d[pctK]);
    if (pct) { d[divK] = pct>=60?'First':pct>=45?'Second':'Third'; d[sysK]='Marks'; }
  }
  d.hasProfile = v.esbProfile ? 'हाँ' : 'नहीं';
  if (v.q10board) d.q10Degree='High School'; if (v.q12board) d.q12Degree='Higher Secondary';
  return Object.assign(d, v);
}
const NAME_FAMILY = new Set(['nameAny','name','nameEn','father','mother','spouse']);
let ENGLISH_ONLY = false;
const titleCase = s => s.toLowerCase().replace(/\b\w/g, c=>c.toUpperCase());
function resolveValue(key, values, labs, el){
  if (key==='hasProfile') { const t=labs.join(' '); const askNew=/नया|new/i.test(t) && !/पूर्व|पहले|already|existing|registered|पंजीकृत/i.test(t); return askNew ? (values.esbProfile?'नहीं':'हाँ') : values.hasProfile; }
  if (key==='district' && el.tagName!=='SELECT' && DISTRICTS[values.district] && (ENGLISH_ONLY || englishField(el) || !hasDeva(labs.join(' ')))) return titleCase(DISTRICTS[values.district]);
  if (key==='city' && el.tagName!=='SELECT' && DISTRICTS[values.city] && ENGLISH_ONLY) return titleCase(DISTRICTS[values.city]);
  if (key==='nameAny') { const t=labs.join(' '); if (/हिंदी|hindi/.test(t) && values.name) return values.name; return values.nameEn || values.name; }
  if (key==='father' || key==='mother' || key==='spouse') { const t=labs.join(' '); const en=values[key+'En']; if (en && !/हिंदी|hindi/.test(t)) return en; return values[key]; }
  return values[key];
}

/* ---------- option matching ---------- */
const OPT = {
  'सामान्य':['general','ur','unreserved','gen','अनारक्षित','सामान्य','open'],
  'OBC':['obc','other backward class','other backward classes','अन्य पिछड़ा वर्ग','पिछड़ा वर्ग','ओबीसी'],
  'SC':['sc','scheduled caste','अनुसूचित जाति'], 'ST':['st','scheduled tribe','अनुसूचित जनजाति'],
  'EWS':['ews','economically weaker section','आर्थिक रूप से कमजोर वर्ग','ईडब्ल्यूएस'],
  'पुरुष':['male','पुरुष','m','man'], 'महिला':['female','महिला','स्त्री','f','woman'], 'अन्य':['other','third gender','transgender','अन्य','तृतीय लिंग'],
  'हाँ':['yes','हाँ','हां','y','true'], 'नहीं':['no','नहीं','n','false'],
  'अविवाहित':['unmarried','single','अविवाहित','never married'], 'विवाहित':['married','विवाहित'],
  '10वीं':['10th','high school','हाईस्कूल','10वीं','matric'], '12वीं':['12th','higher secondary','12वीं','intermediate'], 'स्नातक':['graduate','graduation','स्नातक','bachelor'], 'स्नातकोत्तर':['post graduate','postgraduate','स्नातकोत्तर','master'],
  'वोटर आईडी':['voter','voter id','voter id card','मतदाता','epic'], 'PAN':['pan','pan card','पैन'], 'ड्राइविंग लाइसेंस':['driving','driving licence','driving license','ड्राइविंग'], 'पासपोर्ट':['passport','पासपोर्ट'],
  'हिन्दू':['hindu','हिन्दू','हिंदू'], 'मुस्लिम':['muslim','islam','मुस्लिम','मुसलमान'], 'सिख':['sikh','सिख'], 'ईसाई':['christian','ईसाई'], 'बौद्ध':['buddhist','बौद्ध'], 'जैन':['jain','जैन'], 'पारसी':['parsi','पारसी'],
  'मध्य प्रदेश':['madhya pradesh','mp','m.p.','मध्य प्रदेश','मध्यप्रदेश'],
  'Marks':['marks','अंक','percentage','प्रतिशत','marks system','अंक प्रणाली'],
  'First':['first','प्रथम','i','1st'], 'Second':['second','द्वितीय','ii','2nd'], 'Third':['third','तृतीय','iii','3rd'],
  'अस्थिबाधित':['अस्थिबाधित','oh','orthopedic','locomotor','चलन'], 'दृष्टिबाधित':['दृष्टिबाधित','vh','visual','blind','दृष्टि'], 'श्रवणबाधित':['श्रवणबाधित','hh','hearing','deaf','श्रवण'], 'बहु विकलांग':['बहु विकलांग','md','multiple'],
  '0':['zero','0','शून्य','none'], '1':['one','1','एक'], '2':['two','2','दो'], '3':['three','3','तीन'], '4':['four','4','चार']
};
const DISTRICTS = {'आगर मालवा':'agar malwa','अलीराजपुर':'alirajpur','अनूपपुर':'anuppur','अशोकनगर':'ashoknagar','बालाघाट':'balaghat','बड़वानी':'barwani','बैतूल':'betul','भिंड':'bhind','भोपाल':'bhopal','बुरहानपुर':'burhanpur','छतरपुर':'chhatarpur','छिंदवाड़ा':'chhindwara','दमोह':'damoh','दतिया':'datia','देवास':'dewas','धार':'dhar','डिंडोरी':'dindori','गुना':'guna','ग्वालियर':'gwalior','हरदा':'harda','नर्मदापुरम':'narmadapuram','होशंगाबाद':'hoshangabad','इंदौर':'indore','जबलपुर':'jabalpur','झाबुआ':'jhabua','कटनी':'katni','खंडवा':'khandwa','खरगोन':'khargone','मंडला':'mandla','मंदसौर':'mandsaur','मुरैना':'morena','नरसिंहपुर':'narsinghpur','नीमच':'neemuch','निवाड़ी':'niwari','पन्ना':'panna','रायसेन':'raisen','राजगढ़':'rajgarh','रतलाम':'ratlam','रीवा':'rewa','सागर':'sagar','सतना':'satna','सीहोर':'sehore','सिवनी':'seoni','शहडोल':'shahdol','शाजापुर':'shajapur','श्योपुर':'sheopur','शिवपुरी':'shivpuri','सीधी':'sidhi','सिंगरौली':'singrauli','टीकमगढ़':'tikamgarh','उज्जैन':'ujjain','उमरिया':'umaria','विदिशा':'vidisha','मैहर':'maihar','मऊगंज':'mauganj','पांढुर्णा':'pandhurna'};
function synonyms(v){ const s=[norm(v)]; if (OPT[v]) OPT[v].forEach(x=>s.push(norm(x))); if (DISTRICTS[v]) s.push(DISTRICTS[v]); return s; }
function matchOption(text, v){ const t=norm(text); if(!t) return 0; for (const s of synonyms(v)) { if (t===s) return 100; if (word(t,s)) return 50+s.length; } return 0; }

/* ---------- value must fit the field ---------- */
const DATE_KEYS = /^(dob|casteDate|ewsDate|domDate|nclDate|cpctDate|photoDate|pwdCertDate)$/;
function fits(el, key, v, labs){
  const hint = (compactId(el)+' '+labs.join(' ')+' '+(el.placeholder||'')).toLowerCase();
  const wantsDate = el.type==='date' || /(^|[^a-z])(dob|date|dt)([^a-z]|$)|dt\d*$|date$|दिनांक|तिथि|dd\/mm/.test(hint);
  if (wantsDate !== DATE_KEYS.test(key)) return false;
  // number-only fields: marks (tmark/omark), percentages, PIN, phone, years — NOT landmark / identification mark
  if (/(tmark|omark|marks|percent|pincode|pin|mobile|mobileno|phone|phoneno|passyr|year)$/.test(compactId(el)) && !/(land|identification|id|body)mark$/.test(compactId(el)) || el.type==='number' || el.type==='tel') { if (!/^[\d.]+$/.test(String(v).replace(/\s/g,''))) return false; }
  if (key==='email' && !/@/.test(v)) return false;
  return true;
}

/* ---------- writing ---------- */
function setValue(el, v){
  const proto = el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto,'value').set;
  try { el.focus({preventScroll:true}); } catch(e){}
  setter.call(el, v); el.setAttribute('data-mphub-set','1');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  try { el.blur(); } catch(e){}
}
function formatDate(iso, el){
  if (!iso) return '';
  const [y,m,d] = iso.split('-');
  if (el.type==='date') return iso;
  const hint = norm((el.placeholder||'')+' '+labelsOf(el).primary.join(' '));
  if (/mm\/dd/.test(hint)) return m+'/'+d+'/'+y;
  if (/dd-mm/.test(hint)) return d+'-'+m+'-'+y;
  if (/yyyy-mm-dd/.test(hint)) return iso;
  return d+'/'+m+'/'+y;
}
const isEmptySelect = s => s.selectedIndex<0 || (s.selectedIndex===0 && /select|चुनें|चयन|^-+|^\s*$/i.test(s.options[0].text)) || /^(|0|-1)$/.test(String(s.value).trim()) && /select|चुनें|चयन|^-+/i.test(s.options[s.selectedIndex]?.text||'');
const isPostback = el => /__doPostBack|submit\(\)/.test((el.getAttribute('onchange')||'')+(el.getAttribute('onclick')||''));
function mark(el, color, why){ el.style.outline='3px solid '+color; el.style.outlineOffset='1px'; if(why) el.setAttribute('data-mphub', why); }
function b64ToFile(dataUrl, name){
  const [meta, b64] = dataUrl.split(','); const mime=(meta.match(/data:([^;]+)/)||[])[1]||'image/jpeg';
  const bin=atob(b64), u8=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
  return new File([u8], name, {type:mime});
}

/* ---------- decide what each control wants ---------- */
function questionOf(rs){
  // the line right above the first option ("<p>Have you changed your name?</p> <label>◯ Yes</label> <label>◯ No</label>")
  const own = rs[0].closest('label') || rs[0];
  for (let p = own.previousElementSibling, k = 0; p && k < 3; k++, p = p.previousElementSibling) {
    if (p.querySelector && p.querySelector('input:not([type=hidden]),select')) { if (Array.from(p.querySelectorAll('input')).some(i => rs.includes(i))) continue; break; }
    const t = textOf(p); if (t && t.length > 3) return t.slice(0, 160);
  }
  let node = rs[0].closest('table,div,fieldset,span') || rs[0].parentElement;
  for (let n=0; node && n<6; n++, node=node.parentElement) {
    if (!rs.every(r=>node.contains(r))) continue;
    let p = node.previousElementSibling;
    for (let k=0; p && k<3; k++, p=p.previousElementSibling) { if (p.querySelector && p.querySelector('input:not([type=hidden]),select')) break; const t=textOf(p); if (t && t.length>3) return t.slice(0,160); }
    if (node.matches && node.matches('td')) { const tr=node.parentElement; const prev=tr && tr.previousElementSibling; if (prev && !prev.querySelector('input:not([type=hidden]),select')) { const t=textOf(prev); if (t) return t.slice(0,160); } }
  }
  return '';
}
function askModel(label, context, el, type, options){
  const M = window.MPHubModel; if (!M || !M.data || !label) return null;
  const ex = {label, context, cid: compactId(el), type, options};
  const sure = M.decide(ex); if (sure) return {key: sure.key, sure: true, p: sure.p};
  const guess = M.predict(ex); return guess && guess.key!=='none' && guess.p>=0.6 ? {key: guess.key, sure: false, p: guess.p} : null;
}
/* a "@ domain" drop-down right next to an email box (options like gmail.com / yahoo.co.in) */
const MODEL_NEEDS = { mobile:/mobile|phone|मोबाइल|फ़?फोन|contact|संपर्क|whatsapp|व्हाट्सएप/i, email:/e-?mail|ईमेल|ई-मेल/i, pincode:/\bpin\b|pin\s*code|pincode|पिन/i };
const ALT_NO = /alternat|\balt(?:ernate)?\b|altphone|altmob|other\s*(?:mobile|number|phone)|second(?:ary)?\s*(?:mobile|number)|landline|वैकल्पिक|अन्य\s*मोबाइल/i;
function emailDomainSelect(el){
  for (const box of [el.parentElement, el.parentElement&&el.parentElement.parentElement, el.closest('td,tr,.form-group,.row')].filter(Boolean)) {
    const s = Array.from(box.querySelectorAll('select')).find(x=>{ const o=Array.from(x.options).map(o=>o.text.trim().toLowerCase()); return o.filter(t=>/^@?[a-z0-9-]+(\.[a-z]{2,})+$/.test(t)).length>=3; });
    if (s) return s;
  }
  return null;
}
function classify(el, values){
  const labs = labelsOf(el);
  const all = labs.primary.concat(labs.context).join(' | ');
  const short = (labs.primary[0] || labs.context[0] || compactId(el) || '').slice(0,90);
  if (el.type==='password' || BLOCK_ID.test(fullId(el)) || labs.primary.some(t=>BLOCK.test(t)) || labs.context.some(t=>/captcha|कैप्चा|enter answer|security code/i.test(t))) return {blocked:true, short};
  let key = el.getAttribute('data-mphub-key') || keyFromId(el), how = el.hasAttribute('data-mphub-key') ? 'ai' : 'id';
  if (!key) { const r = keyFromLabel(labs.primary.length?labs.primary:labs.context); if (r) { key=r.key; how='label'; } }
  // the visible label beats a misleading id (IBPS: id "fullname" is labelled "First Name")
  else if (how==='id' && ['nameAny','name','nameEn'].includes(key) && labs.primary.length) { const r = keyFromLabel(labs.primary); if (r && ['firstName','middleName','lastName'].includes(r.key)) { key=r.key; how='label'; } }
  // a second / alternative / landline number must differ from the student's mobile: never copy the mobile there
  if ((key==='mobile' || key==='phone') && ALT_NO.test(all+' '+fullId(el))) key = null;
  let suggest = null;
  if (!key && el.type!=='file') { const m = askModel(labs.primary.join(' | '), labs.context.join(' | '), el, el.tagName==='SELECT'?'select':'text', el.tagName==='SELECT'?Array.from(el.options).map(o=>o.text):[]); if (m && m.sure) { key=m.key; how='model'; } else if (m) suggest=m.key; }
  if (key==='mobile' && ALT_NO.test(all+' '+fullId(el))) { key=null; suggest=null; }   // also after the model
  if (how==='model' && MODEL_NEEDS[key] && !MODEL_NEEDS[key].test(all+' '+(el.placeholder||''))) { key=null; suggest=null; }
  return {key, how, short, labs:labs.primary.length?labs.primary:labs.context, all, suggest};
}

/* ---------- find the way to this job's application form ----------
   On a page with no form (a home page, a Careers list, the job's own details page) every link is scored for being THIS
   job's CURRENT application: its post name / advertisement number, this year, "apply online / registration" words, a
   Careers / Recruitment section. Old years, results, admit cards, answer keys, interview lists and archives count
   against it (stale or the wrong stage). The app follows only a sure link, a few hops at most; otherwise it highlights
   the best ones for the student. Only links are followed, never buttons that send anything. */
// words that appear on every recruiter's site (menus, other posts) say nothing about THIS job
const WAY_GENERIC = new Set('recruitment various posts post officer officers the and for with notification online apply jobs vacancy vacancies advt advertisement contract basis regular deputation cum bank india indian limited ltd manager managers senior junior assistant assistants deputy general head chief executive executives staff more other others specialist specialists associate associates trainee trainees grade group level department national state central'.split(' '));
const WAY_STALE = /\b(results?|answer\s*keys?|admit\s*cards?|call\s*letters?|hall\s*tickets?|interview\s*(schedule|list)|selected|selection\s*list|merit\s*list|marks|cut[\s-]*off|archives?|old\s*(notifications?|recruitments?)|expired|closed|corrigendum|score\s*card|document\s*verification|tender)\b|परिणाम|प्रवेश\s*पत्र|उत्तर\s*कुंजी/i;
const WAY_APPLY = /apply\s*online|online\s*application|new\s*registration|\bregister\b|registration|application\s*form|apply\s*now|click\s*here\s*to\s*apply|online\s*form|create\s*(?:an?\s*|new\s*|your\s*)?(?:account|profile)|sign\s*-?\s*up|new\s*(?:user|candidate|applicant)|one\s*time\s*registration|\botr\b|ऑनलाइन\s*आवेदन|आवेदन\s*करें|पंजीयन|पंजीकरण|नया\s*खाता/i;
const WAY_LOGIN = /\blog\s*-?in\b|sign\s*in|already\s*(?:registered|have\s*an?\s*account)|registered\s*(?:candidate|user)|existing\s*(?:user|candidate|account)|लॉग\s*इन/i;
const WAY_HUB = /career|recruit|vacanc|current\s*opening|opportunit|employment|\bjobs?\b|भर्ती|रिक्ति/i;
// a bank / university site's other services: loans, deposits, admissions … are never a job application
const WAY_NOISE = /\bloans?\b|deposit|(?:savings|current|bank|demat|trading|salary|nre|nro|open\s*an?)\s*accounts?|credit\s*card|debit|insurance|locker|pension|tender|\brti\b|grievance|admission|study\s*in|scholarship|student\s*portal|e-?auction|complaint|feedback|scribe/i;
const WAY_PLATFORM = /ibpsreg\.ibps\.in|ibpsonline\.ibps\.in|digialm\.com|rrbapply\.gov\.in|upsconline\.(nic|gov)\.in|ssc\.gov\.in|recruitment\.nta|onlineapplicationform/i;
/* ---------- the navigator: understand the page, decide, act, check ----------
   Runs on every page of a job opened from the jobs list until the application form (or its login / registration) is reached.
   1. understand: what is this page? (this job's page, a careers list, a home page, another job, a result / admit card
      page, closed, an error page …) with the evidence for it
   2. decide, in this order: leave a wrong page (go back and try the next-best link) → follow a sure link to this job →
      the address the notification PDF gives → the Careers section → open hidden menus / "Current openings" tabs →
      the site's own search box → ask the student (best links in purple)
   3. the app acts (click / open / back) and calls the agent again on the new page: that is the check.
   It never presses buttons that send anything except a site's search box, and it explains each step ("think"). */
const dec = u => { try { return decodeURIComponent(u); } catch(e) { return String(u||''); } };
function jobSense(job){
  const words = [...new Set(String(job.post||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').split(' ').filter(w=>w.length>=4 && !WAY_GENERIC.has(w) && !/^\d+$/.test(w)))];
  const advt = job.advt && String(job.advt).replace(/[^0-9a-z]/gi,'').length>=3 ? new RegExp(String(job.advt).replace(/[^0-9a-z]+/gi,'.{0,3}').replace(/^\.\{0,3\}|\.\{0,3\}$/g,''),'i') : null;
  return {words, need:Math.min(2, words.length), advt, hints:(job.hints||[]).map(u=>String(u).split('#')[0].replace(/\/$/,'').toLowerCase())};
}
function understand(job){
  const J = jobSense(job);
  const title = norm(document.title||''), h1 = norm(Array.from(document.querySelectorAll('h1,h2')).slice(0,3).map(h=>h.innerText).join(' '));
  const body = norm((document.body.innerText||'').slice(0,8000)), head = title+' '+h1;
  const postIn = t => J.need > 0 && J.words.filter(w=>t.includes(w)).length >= J.need;
  const advtIn = t => !!(J.advt && J.advt.test(t));
  const ev = [];
  if (/\b(404|not\s*found|page\s*(?:not|cannot)\s*be\s*found|error\s*occurred|service\s*unavailable|access\s*denied|forbidden)\b/i.test(head) || (body.length < 400 && /not\s*found|error/i.test(body))) return {kind:'error', ev:['error text']};
  { const sentences = body.slice(0,4000).split(/[.।\n]/).filter(x=>/(registration|application|link|आवेदन)[^.]{0,40}(closed|expired|disabled|not\s*active|over|बंद|समाप्त)|last\s*date[^.]{0,30}(over|expired)/i.test(x));
    if (sentences.length && !formLike() && (sentences.some(x=>postIn(x)||advtIn(x)) || (postIn(head) && sentences.length >= 1 && !/recruit.*recruit/i.test(body.slice(0,2000))))) return {kind:'closed', ev:['closed: '+sentences[0].slice(0,60)]}; }
  const thisJob = WAY_PLATFORM.test(location.hostname) || advtIn(body) || (postIn(body) && /recruit|advertisement|advt|vacanc|apply|भर्ती|विज्ञापन/i.test(body) && /career|recruit|job|vacanc|opening|advt|notification/i.test(location.href+' '+title));
  if (WAY_STALE.test(head) && !WAY_APPLY.test(head) && !thisJob) return {kind:'stale', ev:['heading: '+head.slice(0,40)]};
  if (thisJob) { ev.push(advtIn(body)?'advt no':WAY_PLATFORM.test(location.hostname)?'application platform':'post named'); return {kind:'job', ev}; }
  // a single recruitment's page that is NOT this job (another post / another advertisement)
  if (/recruit|advertisement|advt|vacancy|notification|भर्ती/i.test(head) && /\b(20\d\d)\b|advt|no\.?\s*\d/i.test(head) && J.need && !postIn(head+' '+body.slice(0,3000)) && !advtIn(body) && document.querySelectorAll('a[href]').length < 120) {
    const rows = Array.from(document.querySelectorAll('li,tr,.card,article')).filter(r=>/recruit|advt|vacanc|post/i.test(r.innerText||'') && (r.innerText||'').length < 600).length;
    if (rows < 3) return {kind:'other-job', ev:['heading: '+head.slice(0,50)]};
  }
  const rows = Array.from(document.querySelectorAll('li,tr,.card,article')).filter(r=>(r.innerText||'').length < 600 && /recruit|advt|advertisement|vacanc|engagement|post of|posts|भर्ती/i.test(r.innerText||'')).length;
  if (rows >= 3 || /career|recruit|vacanc|opening|jobs?\b/i.test(location.pathname+' '+title)) return {kind:'list', ev:[rows+' recruitment rows']};
  if (/^\/?(?:index\.\w+|home|default\.\w+|en|hi|en\/|hi\/)?$/i.test(location.pathname)) return {kind:'home', ev:[]};
  return {kind:'other', ev:[]};
}
function scoreLinks(job, ids, kind){
  const J = jobSense(job), words = J.words, need = J.need, advt = J.advt;
  const year = new Date().getFullYear(), seen = new Set(window.__mphubSeen||[]);
  const hasId = !!(ids||{})[location.hostname.replace(/^www\./,'')] || !!window.__mphubHasLogin;
  const pageIsJob = kind === 'job';
  const out = []; let stale = 0;
  document.querySelectorAll('[data-mphub-way]').forEach(e=>{ e.removeAttribute('data-mphub-way'); e.style.outline=''; });
  for (const a of Array.from(document.querySelectorAll('a[href], a[routerlink], a.dropdown-item, .dropdown-menu a, [role=link], [role=menuitem], button[onclick*="location"], li[onclick] > *'))) {
    if (!a.href && !visible(a)) continue;   // a script item is only useful when it can be tapped
    const vis = visible(a);
    const href = a.href || '', t = norm(a.innerText||a.textContent||a.getAttribute('title')||a.getAttribute('aria-label')||'');
    if (!vis && !/^https?:/.test(href)) continue;           // hidden menu items count only when they have an address to open
    if (!t && !href) continue;
    if (/\.(jpe?g|png|zip|docx?|xlsx?)(\?|$)/i.test(href) || /^mailto:|^tel:|logout|signout|whatsapp|facebook|twitter|youtube|instagram|linkedin|t\.me/i.test(href)) continue;
    if (/\.pdf(\?|#|$)/i.test(href)) continue;
    if (href && /^https?:/.test(href) && (seen.has(href.split('#')[0]) || href.split('#')[0] === location.href.split('#')[0])) continue;
    if (/drive\.google\.com\/file|docs\.google\.com\/(document|spreadsheets|presentation)/i.test(href)) continue;
    let row = a.parentElement; while (row && row !== document.body && (row.innerText||'').trim().length < 80 && row.parentElement && (row.parentElement.innerText||'').length <= 700) row = row.parentElement;
    if (row && (row === document.body || (row.innerText||'').length > 700)) row = null;
    const ctx = norm(row ? row.innerText.slice(0,400) : '');
    const own = t+' '+dec(href).toLowerCase(), all = own+' '+ctx;
    let s = 0; const why = [];
    const hit = words.filter(w=>all.includes(w)), postOk = need > 0 && hit.length >= need, advtOk = !!(advt && advt.test(all));
    if (postOk) { s += 3*Math.min(hit.length,3); why.push('post'); }
    if (advtOk) { s += 8; why.push('advt'); }
    const hintOk = J.hints.some(h=>href.toLowerCase().replace(/\/$/,'').startsWith(h)); if (hintOk) { s += 10; why.push('pdf-address'); }
    const ys = (all.match(/\b20\d\d\b/g)||[]).map(Number);
    if (ys.some(y=>y>=year)) { s += 2; why.push('year'); } else if (ys.length && Math.max(...ys) < year-1) { s -= 8; why.push('old'); }
    const my = own.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s_-]*(20\d\d)/i); if (my && +my[1] < year) { s -= 8; why.push('old-link'); }
    const ap = WAY_APPLY.test(t) || (WAY_APPLY.test(ctx) && t.length < 30 && (postOk || advtOk));
    if (ap) { s += (postOk||advtOk||pageIsJob) ? 4 : 1; why.push('apply'); if (pageIsJob && WAY_APPLY.test(t)) { s += 6; why.push('this-page'); } }
    if (pageIsJob && WAY_LOGIN.test(t)) { s += hasId ? 12 : 2; why.push('login'); }
    if (hasId && /new\s*registration|create\s*(?:an?\s*)?account|sign\s*-?\s*up|new\s*user/i.test(t)) { s -= 4; why.push('has-id'); }
    if (/^https?:/.test(href)) { try { if (WAY_PLATFORM.test(new URL(href).hostname) && !WAY_PLATFORM.test(location.hostname)) { s += (postOk||advtOk) ? 6 : pageIsJob ? 4 : 1; why.push('platform'); } } catch(e){} }
    if (WAY_NOISE.test(own)) { s -= 8; why.push('other-service'); }
    const staleUrl = /\/(?:oecl[ab]|intcl[ab]|pecl[ab]|pocl[ab]|scda|cla|result|admit|callletter|scorecard|answerkey|marks)[_\-\/]|[?&](?:result|admit)/i.test(href);
    const st = WAY_STALE.test(t) || (WAY_STALE.test(ctx) && !ap) || staleUrl; if (st) { s -= 10; why.push('stale'); if (postOk || advtOk) stale++; }
    const hub = !st && WAY_HUB.test(t) && t.length < 40 && !WAY_NOISE.test(own); if (hub) { s += 3; why.push('hub'); }
    const isJob = postOk || advtOk || hintOk || (ap && pageIsJob && WAY_APPLY.test(t));
    if (a.closest('nav,header,footer,[role=navigation],.menu,.navbar,#menu') && !hub && !isJob) continue;   // site menus: only Careers or this job
    if (!vis) { s -= 1; why.push('in-menu'); }
    if (s <= 0) continue;
    out.push({el:a, t:t.slice(0,60), href, s, why, job:isJob, hub, vis});
  }
  const applyTo = new Set(out.filter(c=>c.why.includes('this-page')).map(c=>c.href.split('#')[0]));
  if (applyTo.size > 1) for (const c of out) if (c.why.includes('this-page') && !c.why.includes('post') && !c.why.includes('advt')) { c.s -= 6; c.why = c.why.filter(w=>w!=='this-page'); c.job = false; }
  out.sort((x,y)=>y.s-x.s);
  return {out, stale};
}
const T2 = (hi, en) => L10N(hi, en);
function navigate(job, ids){
  const U = understand(job), kind = U.kind, J = jobSense(job), hops = window.__mphubHops||0;
  const tried = window.__mphubTried = window.__mphubTried || {};
  const res = {kind, ev:U.ev, act:'ask', think:'', top:[], alts:[], stale:0};
  const label = {job:T2('इस भर्ती का पेज','this job\'s page'), list:T2('भर्तियों की सूची','a list of recruitments'), home:T2('वेबसाइट का होम पेज','the website\'s home page'), other:T2('वेबसाइट का एक पेज','a page of the website')}[kind] || kind;
  // 1. a wrong page: leave it and try the next-best link from before
  if (kind === 'error') return Object.assign(res, {act:'back', think:T2('यह पेज खुला नहीं (त्रुटि). पिछला अगला-सबसे-अच्छा लिंक आज़मा रहे हैं…','This page didn\'t open (error). Trying the next-best link from before…')});
  if (kind === 'stale') return Object.assign(res, {act:'back', think:T2('यह पुराना / परिणाम / एडमिट कार्ड वाला पेज है, आवेदन नहीं. वापस जाकर दूसरा लिंक देख रहे हैं…','This is an old / result / admit card page, not an application. Going back to try another link…')});
  if (kind === 'other-job') return Object.assign(res, {act:'back', think:T2('यह किसी दूसरी भर्ती का पेज है. वापस जाकर सही भर्ती ढूँढ रहे हैं…','This page is for a different recruitment. Going back to find the right one…')});
  if (kind === 'closed') return Object.assign(res, {act:'stop', think:T2('इस पेज के अनुसार आवेदन बंद है. अधिसूचना में अंतिम तिथि जाँचें.','This page says applications are closed. Check the last date in the notification.')});
  const {out, stale} = scoreLinks(job, ids, kind); res.stale = stale;
  let k = 0; const top = out.slice(0,3).map(c=>{ const i=k++; c.el.setAttribute('data-mphub-way', i); if (c.vis) mark(c.el, '#6C4CEF', 'way'); return {i, t:c.t, href:c.href, s:c.s, why:c.why.join(' '), job:c.job, hub:c.hub, vis:c.vis}; });
  res.top = top; const best = top[0], second = top[1];
  // other good options, kept by the app for going back
  res.alts = out.slice(1,6).filter(c=>c.s >= 5 && /^https?:/.test(c.href) && (c.job || c.hub)).map(c=>c.href);
  const sureJob = best && best.job && best.s >= 9 && (!second || !second.job || best.s - second.s >= 3 || best.href.split('#')[0] === second.href.split('#')[0]);
  if (sureJob) return Object.assign(res, {act:'follow', pick:best, think:T2(label+' मिला. इसमें आपकी भर्ती का लिंक है: "'+best.t+'". उसे खोल रहे हैं…', 'Found '+label+'. It has your job\'s link: "'+best.t+'". Opening it…')});
  // 2. the notification PDF printed the application address: go there
  const hint = (job.hints||[]).find(h=>!(window.__mphubSeen||[]).includes(String(h).split('#')[0]) && !tried['hint:'+h]);
  if (hint && hops < 6) { tried['hint:'+hint] = 1; return Object.assign(res, {act:'goto', href:hint, think:T2('अधिसूचना (PDF) में आवेदन का पता लिखा है. सीधे वहीं जा रहे हैं…','The notification (PDF) gives the application address. Going straight there…')}); }
  // 3. a Careers / Recruitment section when nothing here is about this job
  const hubLink = out.find(c=>c.hub && !c.job);
  if (hubLink && !out.some(c=>c.job && c.s >= 6) && hops < 4 && kind !== 'job') {
    const h = top.find(t=>t.href === hubLink.href) || (hubLink.el.setAttribute('data-mphub-way', 9), {i:9, t:hubLink.t, href:hubLink.href, vis:hubLink.vis});
    return Object.assign(res, {act:'follow', pick:h, think:T2(label+' पर इस भर्ती का लिंक नहीं है. "'+hubLink.t+'" सेक्शन खोल रहे हैं, भर्तियाँ वहीं होती हैं…', 'No link to this job on '+label+'. Opening the "'+hubLink.t+'" section, where recruitments are listed…')});
  }
  // 4. hidden parts of the page: menus that are folded, "Current openings / Notifications" tabs and accordions
  const toggles = Array.from(document.querySelectorAll('button,[role=tab],[aria-expanded="false"],[data-toggle],[data-bs-toggle],.accordion-button,.menu-toggle,.navbar-toggler,summary,li.dropdown > a[href="#"],a[href="#"],a[href^="javascript"]'))
    .filter(e=>visible(e) && !tried['t:'+norm(e.innerText||e.getAttribute('aria-label')||e.className).slice(0,40)])
    .map(e=>{ const t = norm(e.innerText||e.getAttribute('aria-label')||''); let s = 0;
      if (/current|open(ing)?s?|recruit|career|vacanc|notification|advertisement|job|भर्ती|रिक्ति/i.test(t)) s += 5;
      if (WAY_APPLY.test(t) || WAY_LOGIN.test(t) || /^apply$/i.test(t.trim())) s += 7;
      if (/download|format|forms?\s*download|gallery|media|tender/i.test(t)) s -= 4;
      if (J.need && J.words.some(w=>t.includes(w))) s += 4;
      if (/menu|navigation|toggle|hamburger/i.test(t+' '+e.className+' '+(e.getAttribute('aria-label')||'')) && !out.some(c=>c.hub||c.job)) s += 3;
      if (WAY_STALE.test(t) || WAY_NOISE.test(t)) s -= 6; return {e, t, s}; })
    .filter(x=>x.s >= 3).sort((a,b)=>b.s-a.s);
  if (toggles.length && hops < 8) { const x = toggles[0]; tried['t:'+norm(x.e.innerText||x.e.getAttribute('aria-label')||x.e.className).slice(0,40)] = 1; x.e.setAttribute('data-mphub-way', 8);
    return Object.assign(res, {act:'open', pick:{i:8, t:x.t||'menu'}, think:T2('पेज का छिपा हिस्सा खोल रहे हैं ("'+(x.t||'मेन्यू')+'"), भर्ती का लिंक वहाँ हो सकता है…','Opening a hidden part of the page ("'+(x.t||'menu')+'"); the job link may be there…')}); }
  // 5. the site's own search box
  const sb = !tried.search && Array.from(document.querySelectorAll('input[type=search],input[name*=search i],input[id*=search i],input[placeholder*=search i],input[name=q],input[name=s]')).find(e=>!e.disabled && (visible(e) || e.closest('form')));
  if (sb && hops < 8) { tried.search = 1; const q = (J.words.slice(0,3).join(' ') || 'recruitment');
    return Object.assign(res, {act:'search', q, think:T2('इस पेज पर लिंक नहीं मिला. वेबसाइट के सर्च में "'+q+'" खोज रहे हैं…','No link on this page. Searching the website for "'+q+'"…')}); }
  // 6. nothing sure here: the app goes back to another good link if it has one, else the student chooses
  if (stale && !(best && best.job)) return Object.assign(res, {act:'back', staleOnly:true, think:T2('इस वेबसाइट पर इस पद के सिर्फ़ पुराने लिंक हैं (परिणाम / एडमिट कार्ड / पुरानी भर्ती). इस भर्ती का आवेदन लिंक शायद अभी शुरू नहीं हुआ.','This website only has old links for this post (results / admit cards / earlier recruitment). This job\'s apply link may not be live yet.')});
  const btns = Array.from(document.querySelectorAll('button,input[type=submit],input[type=button],a.btn,[role=button]')).filter(b=>visible(b) && /regist|sign\s*up|log\s*-?in|sign\s*in|apply|पंजीयन|पंजीकरण|लॉग/i.test(b.value||b.innerText||'') && !b.closest('header,footer,nav'));
  if (btns.length && (WAY_PLATFORM.test(location.hostname) || kind === 'job' || /recruit|career|rect/i.test(location.hostname+location.pathname))) { btns.slice(0,3).forEach(b=>mark(b, '#6C4CEF', 'way'));
    return Object.assign(res, {act:'ask', portal:true, think:T2('यह आवेदन पोर्टल है. पहली बार हैं तो "Register" दबाएँ, एजेंट रजिस्ट्रेशन भरेगा. पहले से रजिस्टर हैं तो "Login". बटन बैंगनी रंग में हैं.','This is the application portal. First time? Tap "Register" and the agent fills the registration. Already registered? Tap "Login". The buttons are in purple.')}); }
  if (best) return Object.assign(res, {act:'back-or-ask', think:T2(label+' पर पक्का लिंक नहीं मिला. बैंगनी लिंक सबसे करीब लगते हैं: सही लगे तो दबाएँ.','No sure link on '+label+'. The purple links look closest: tap the right one.')});
  return Object.assign(res, {act:'back-or-ask', think:T2('इस पेज पर इस भर्ती का आवेदन लिंक नहीं मिला. मेन्यू में "Careers / Recruitment" देखें; फॉर्म खुलते ही एजेंट भरेगा.','Couldn\'t find this job\'s apply link on this page. Look for "Careers / Recruitment" in the menu; the agent fills as soon as the form opens.')});
}
/* the app asks the agent to search the site: type into the search box and send the search (never anything else) */
function siteSearch(q){
  const sb = Array.from(document.querySelectorAll('input[type=search],input[name*=search i],input[id*=search i],input[placeholder*=search i],input[name=q],input[name=s]')).find(e=>!e.disabled);
  if (!sb) return false;
  const tog = document.querySelector('[class*=search] button,[aria-label*=search i]'); if (!visible(sb) && tog) tog.click();
  setValue(sb, q); sb.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:13,bubbles:true})); sb.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',keyCode:13,bubbles:true}));
  const f = sb.closest('form'); if (f) { const btn = f.querySelector('button[type=submit],input[type=submit],button:not([type])'); if (btn) btn.click(); else if (f.requestSubmit) f.requestSubmit(); else f.submit(); }
  return true;
}
// kept for older callers / tests
function findWay(job, ids){ const n = navigate(job, ids); return Object.assign(n, {sure: n.act==='follow', portal: !!n.portal, pageIsJob: n.kind==='job'}); }

/* an application form, not a site's search / feedback / newsletter / chat boxes or a login-only page */
function formLike(){
  const f = Array.from(document.querySelectorAll('input,select,textarea')).filter(e=>!e.disabled && e.type!=='hidden' && !['submit','button','image','reset','checkbox','radio','file','range'].includes(e.type) && visible(e)
    && !e.closest('header,footer,nav,[role=search],[role=navigation],form[role=search],.search,#search')
    && !/search|query|keyword|\bq\b|feedback|suggest|newsletter|subscribe|chat|branch|ifsc|locator|language|lang|captcha|otp|password|pwd|calculator|emi|amount|tenure|loan|rate|months?|value|slider/i.test((e.id||'')+' '+(e.name||'')+' '+(e.placeholder||'')+' '+(e.getAttribute('aria-label')||'')+' '+e.type));
  if (/docs\.google\.com\/forms|forms\.gle|forms\.office/i.test(location.href)) return true;
  if (document.querySelector('input[type=password]')) return true;   // login / registration pages are handled as such
  if (f.length < 3) return false;
  // in job mode the form must be an application (an enquiry / loan / contact form on a home page is not)
  const box = f[0].closest('form') || f[0].closest('main,section,article') || document.body;
  const ctx = location.href+' '+document.title+' '+(box === document.body ? '' : String(box.innerText||'').slice(0,3000));
  return WAY_PLATFORM.test(location.hostname) || /recruit|application|applicant|candidate|registration|regist|apply|vacanc|post\s*applied|भर्ती|आवेदन|पंजीयन|पंजीकरण|अभ्यर्थी/i.test(ctx);
}
/* ---------- portal logins: strong password on registration, saved login on the login page, OTP from SMS ----------
   The student asked for this: the app keeps each portal's user ID + password (encrypted on the phone) and fills them.
   Registration page (password + confirm password): a strong password that meets the portal's own rules is made here,
   typed into both boxes and handed to the app's vault. Login page: the saved user ID + password of THIS portal only.
   Captcha, the final Submit and payment stay with the student. */
function pwRules(el){
  const near = norm(((el.closest('tr,div,li,fieldset,form')||document.body).innerText||'').slice(0,1500)) + ' ' + norm(el.title||'') + ' ' + norm(el.placeholder||'');
  let min = Number(el.getAttribute('minlength'))||0, max = Number(el.getAttribute('maxlength'))||0;
  const r = near.match(/(\d{1,2})\s*(?:to|-|–|and)\s*(\d{1,2})\s*(?:characters|chars|अक्षर)/i); if (r) { min = Math.max(min, +r[1]); max = max ? Math.min(max, +r[2]) : +r[2]; }
  const mn = near.match(/(?:minimum|at\s*least|min\.?)\s*(?:of\s*)?(\d{1,2})\s*(?:characters|chars)/i); if (mn) min = Math.max(min, +mn[1]);
  const mx = near.match(/(?:maximum|not\s*more\s*than|max\.?)\s*(?:of\s*)?(\d{1,2})\s*(?:characters|chars)/i); if (mx) max = max ? Math.min(max, +mx[1]) : +mx[1];
  // the symbols the portal lists ("special character (@ # $ % & *)"), else a safe common set
  const sm = near.match(/special\s*char[a-z]*[^@#$%&*!^_.\-]{0,40}([@#$%&*!^_.\-](?:[\s,]*[@#$%&*!^_.\-]){1,12})/i);
  const sym = sm ? sm[1].replace(/[\s,]/g,'') : '@#$%&*!';
  return {min: min||10, max: max||14, sym};
}
function makePassword(rule){
  const R = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const len = Math.max(Math.max(rule.min, 10), Math.min(rule.max, 14));
  const up='ABCDEFGHJKLMNPQRSTUVWXYZ', lo='abcdefghijkmnpqrstuvwxyz', dg='23456789', sy=rule.sym||'@#$%&*!';
  const ch = [up[R(up.length)], lo[R(lo.length)], dg[R(dg.length)], sy[R(sy.length)]];
  const all = up+lo+dg; while (ch.length < len) ch.push(all[R(all.length)]);
  for (let i=ch.length-1;i>0;i--){ const j=R(i+1); [ch[i],ch[j]]=[ch[j],ch[i]]; }
  if (sy.includes(ch[0])) { const k = ch.findIndex(c=>!sy.includes(c)); [ch[0],ch[k]]=[ch[k],ch[0]]; }
  return ch.join('');
}
/* calendar boxes (read-only inputs with a date picker: jQuery UI, flatpickr, bootstrap-datepicker …): set the date the way
   the picker itself would, so the portal's own checks see it. Only dates the profile has (date of birth, certificate dates). */
function fillPickerDates(values, iso, rep){
  const boxes = Array.from(document.querySelectorAll('input')).filter(e=>e.readOnly && !e.disabled && visible(e) && !e.value && /^(text|date|)$/.test(e.type));
  for (const el of boxes) {
    const labs = labelsOf(el), hint = norm(labs.primary.concat(labs.context).join(' ')+' '+(el.placeholder||'')+' '+fullId(el));
    if (!/date|dob|birth|तिथि|दिनांक|dd\/mm|mm\/dd/.test(hint)) continue;
    let key = keyFromId(el) || (keyFromLabel(labs.primary)||{}).key || (/birth|dob|जन्म/.test(hint) ? 'dob' : null);
    if (!key || !DATE_KEYS.test(key) || !iso[key]) continue;
    const [y,m,d] = iso[key].split('-'), when = new Date(+y, +m-1, +d), text = formatDate(iso[key], el);
    const jq = window.jQuery;
    try {
      if (jq && jq.fn && jq.fn.datepicker && jq.data(el,'datepicker')) {          // jQuery UI
        jq(el).datepicker('setDate', when); const inst = jq.data(el,'datepicker'), os = inst && inst.settings && inst.settings.onSelect;
        if (os) os.call(el, el.value, inst); jq(el).trigger('change');
      } else if (el._flatpickr) el._flatpickr.setDate(when, true);                  // flatpickr
      else if (jq && jq(el).data && jq(el).data('datepicker') && jq(el).datepicker) jq(el).datepicker('update', when).trigger('changeDate');   // bootstrap-datepicker
      else { el.readOnly = false; setValue(el, text); el.readOnly = true; }
    } catch(e) { el.readOnly = false; setValue(el, text); el.readOnly = true; }
    if (!el.value) { el.readOnly = false; setValue(el, text); el.readOnly = true; }
    ['input','change','blur'].forEach(t=>el.dispatchEvent(new Event(t,{bubbles:true})));
    if (el.value) { mark(el,'#1E7A4C'); el.removeAttribute('data-mphub'); rep.filled.push({k:key, l:String(labs.primary[0]||key).slice(0,90), v:el.value, how:'picker'}); }
  }
}
function credentials(payload, rep){
  const pw = Array.from(document.querySelectorAll('input[type=password]')).filter(e=>!e.disabled && !e.readOnly && visible(e));
  if (!pw.length) return;
  const textBoxes = Array.from(document.querySelectorAll('input')).filter(e=>/^(text|email|tel|number|)$/.test(e.type) && !e.disabled && visible(e));
  const isUserBox = e => /user|login|regist|reg\.?\s*no|enrol|candidate\s*id|application\s*(no|id)|email|mobile|यूज़र|पंजीयन/i.test(fullId(e)+' '+labelsOf(e).primary.join(' ')+' '+(e.placeholder||'')) && !/captcha|otp|code/i.test(fullId(e)+' '+labelsOf(e).primary.join(' '));
  const isOldPw = e => /old|current|existing|पुराना/i.test(fullId(e)+' '+labelsOf(e).primary.join(' '));
  const fresh = pw.filter(e=>!isOldPw(e));
  if (fresh.length >= 2 && fresh.every(e=>!e.value)) {
    // registration / create password: one strong password in both boxes
    const p = makePassword(pwRules(fresh[0]));
    fresh.forEach(e=>{ setValue(e, p); mark(e,'#1E7A4C'); });
    const v = payload.values||{}, userBox = textBoxes.find(isUserBox);
    const user = (userBox && userBox.value) || v.email || v.mobile || '';
    rep.newCred = {pass:p, user}; rep.filled.push({k:'password', l:L10N('पासवर्ड (मज़बूत, ऐप में सेव)','Password (strong, saved in the app)'), v:'••••••••', how:'vault'});
    return;
  }
  const login = payload.login;
  if (fresh.length === 1 && login && login.pass && !fresh[0].value) {
    setValue(fresh[0], login.pass); mark(fresh[0],'#1E7A4C');
    const ub = textBoxes.find(e=>!e.value && isUserBox(e)) || textBoxes.find(e=>!e.value && !/captcha|otp|code/i.test(fullId(e)+' '+labelsOf(e).primary.join(' ')));
    if (ub && login.user) { setValue(ub, login.user); mark(ub,'#1E7A4C'); }
    rep.loginFilled = true; rep.filled.push({k:'password', l:L10N('लॉगिन (ऐप में सेव)','Login (saved in the app)'), v:(login.user||'')+' / ••••••••', how:'vault'});
  }
}
/* the OTP the app read from the SMS (with the student's one-tap consent) */
function fillOtp(code){
  const boxes = Array.from(document.querySelectorAll('input')).filter(e=>!e.disabled && visible(e) && !e.value && /(^|[_$\s-])(txt)?otp|one.?time|verification\s*code|enterotp|verifyotp|ओटीपी/i.test(fullId(e)+' '+labelsOf(e).primary.join(' ')+' '+(e.placeholder||'')));
  if (!boxes.length) return false;
  // split OTP boxes (one digit each)
  if (boxes.length >= code.length && boxes.every(b=>Number(b.getAttribute('maxlength'))===1)) { code.split('').forEach((c,i)=>setValue(boxes[i], c)); }
  else setValue(boxes[0], code);
  boxes.forEach(b=>mark(b,'#1E7A4C'));
  return true;
}
/* ---------- main ---------- */
/* exam lists / portal home pages: nothing to fill here, the app navigates to the exam's own form */
const HUB_PATH = /attestation\/home\/home\.aspx$|\/vyapam\/examslist\.aspx$|^\/?$|\/default\.aspx$|\/index\.aspx$/i;
/* a sign-up meant only for the organisation's own staff (official e-mail domain, employee number): never fill it */
const STAFF_ONLY = /(registration|sign\s*-?\s*up|login|account)[^.।\n]{0,60}\bonly\b[^.।\n]{0,40}(employees?|staff|officials?|officers?|@[a-z0-9-]+(\.[a-z0-9-]+)+)|only\s+for\s+(serving|existing|departmental|company|our)\s+(employees?|staff)|(official|company)\s+@[a-z0-9-]+(\.[a-z0-9-]+)+\s*e-?mail|केवल\s+(विभागीय\s+)?(कर्मचारि|अधिकारि)/i;
function staffOnly(){ return STAFF_ONLY.test((document.body && document.body.innerText) || ''); }
function staffBanner(){
  if (document.getElementById('mphub-staff')) return;
  const d = document.createElement('div'); d.id = 'mphub-staff';
  d.style.cssText = 'position:fixed;left:12px;right:12px;top:12px;z-index:2147483647;background:#7A1E1E;color:#fff;padding:14px 16px;border-radius:12px;font:600 15px/1.4 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)';
  d.textContent = 'यह पेज सिर्फ़ इस विभाग के अपने कर्मचारियों के लिए है, भर्ती के उम्मीदवारों के लिए नहीं. यहाँ कुछ न भरें. This page is only for the organisation\'s own employees, not for job applicants. Do not fill it.';
  d.onclick = () => d.remove(); document.body.appendChild(d);
}
function run(payload){
  if (payload && payload.job) lastPayload = payload;
  window.__mphubHasLogin = !!(payload && payload.login && payload.login.pass);
  // (single-page portals like rrbapply.gov.in keep their forms at "/" behind a #/route: a page with a real form is never a hub)
  const formy = Array.from(document.querySelectorAll('input[type=text],input:not([type]),input[type=email],input[type=tel],select,textarea')).filter(e=>!e.disabled && visible(e)).length >= 3;
  if (HUB_PATH.test(location.pathname) && !/Message=/.test(location.search) && !formy) {
    const r = {filled:[], already:[], conflict:[], manual:[], blocked:0, files:[], checkboxes:0, postback:false, unknown:[], page:document.title, version:VERSION, stage:'hub', host:location.hostname};
    // a job opened from the jobs list: find the way from this home page to its application form
    if (payload.job) { r.way = findWay(payload.job, payload.portalIds); r.stage = 'find'; }
    return r;
  }
  if (payload.job && !formLike()) { const r = {filled:[], already:[], conflict:[], manual:[], blocked:0, files:[], checkboxes:0, postback:false, unknown:[], page:document.title, version:VERSION, stage:'find', host:location.hostname};
    r.way = findWay(payload.job, payload.portalIds); return r; }
  if (staffOnly()) { const r = {filled:[], already:[], conflict:[], manual:[], blocked:0, files:[], checkboxes:0, postback:false, unknown:[], page:document.title, version:VERSION, stage:'staff', host:location.hostname, url:location.href};
    staffBanner(); return r; }
  const iso = payload.iso||{}, files = payload.files||{};
  const values = derive(payload.values||{}, iso);
  const rep = {filled:[], already:[], conflict:[], manual:[], blocked:0, files:[], checkboxes:0, postback:false, page:document.title||location.hostname, version:VERSION, unknown:[]};
  let uSeq = 0; document.querySelectorAll('[data-mphub-u]').forEach(e=>{ uSeq=Math.max(uSeq, Number(e.getAttribute('data-mphub-u'))+1); });
  const askAI = (els, label, ctx, type, options) => { if (els[0].hasAttribute('data-mphub-u') || els[0].hasAttribute('data-mphub-key') || rep.unknown.length>=40) return; const i=uSeq++; els.forEach(e=>e.setAttribute('data-mphub-u', i)); rep.unknown.push({i, label:String(label||'').slice(0,300), context:String(ctx||'').slice(0,300), type, options:(options||[]).map(o=>String(o).slice(0,80)).slice(0,20)}); };
  fillPickerDates(values, iso, rep);
  const done = new Set(), postbacks = [];
  ENGLISH_ONLY = /(अंग्रेज़ी|अंग्रेजी)s*(मे|में)s*(ही )?(भरे|भरें)|in english only|only in english|english capital letters only/i.test(document.body.innerText||'');
  rep.englishOnly = ENGLISH_ONLY;
  const short = s => String(s||'').slice(0,90);

  for (let pass=0; pass<3; pass++) {
    let changed = 0;
    const els = Array.from(document.querySelectorAll('input,select,textarea')).filter(el=>!el.disabled && !el.readOnly && el.type!=='hidden' && visible(el) && !done.has(el));

    // radio groups
    const groups = {};
    els.filter(e=>e.type==='radio').forEach(r=>{ const g=r.name||r.id; (groups[g]=groups[g]||[]).push(r); });
    for (const g in groups) {
      const rs = groups[g]; rs.forEach(r=>done.add(r));
      const cell = rs[0].closest('td') || rs[0].parentElement;
      const c = classify(cell.matches('td')?cell.querySelector('input'):rs[0], values);
      const rowLab = (()=>{ const td=rs[0].closest('td'); if(!td) return ''; const cells=Array.from(td.parentElement.children); const i=cells.indexOf(td); for(let j=i-1;j>=0;j--){ const t=textOf(cells[j]); if(t && !/^\d+\.?$/.test(t)) return t; } return ''; })();
      let key = rs[0].getAttribute('data-mphub-key') || keyFromId(rs[0]) || (rowLab && keyFromLabel([rowLab])||{}).key || c.key;
      const q = rowLab || questionOf(rs);
      if (!key && q) key = (keyFromLabel([q])||{}).key;
      let viaModel = false, rSuggest = null;
      if (!key) { const m = askModel(q || c.short, c.all, rs[0], 'radio', rs.map(r=>norm((r.labels&&r.labels[0]?r.labels[0].textContent:'')||(r.nextSibling&&r.nextSibling.nodeType===3?r.nextSibling.textContent:'')||r.value))); if (m && m.sure) { key=m.key; viaModel=true; } else if (m) rSuggest=m.key; }
      const lab = short(q || c.short);
      if (c.blocked || BLOCK.test(q)) { rep.blocked++; continue; }
      const rv = key ? resolveValue(key, values, [q], rs[0]) : null;
      if (!key || rv==null || rv==='') { if (!rs.some(r=>r.checked)) { rep.manual.push(lab); mark(rs[0].closest('td,div,fieldset,li')||rs[0].parentElement||rs[0],'#E0A100','manual'); if (!key) askAI(rs, q || c.short, c.all, 'radio', rs.map(r=>norm((r.labels&&r.labels[0]?r.labels[0].textContent:'')||(r.nextSibling&&r.nextSibling.nodeType===3?r.nextSibling.textContent:'')||r.value))); } continue; }
      if (rs.some(r=>r.checked)) { rep.already.push({k:key, l:lab}); continue; }
      const optLabel = r => norm((r.labels&&r.labels[0]?r.labels[0].textContent:'') || (r.nextSibling&&r.nextSibling.nodeType===3?r.nextSibling.textContent:'') || (r.nextElementSibling?r.nextElementSibling.textContent:'') || r.value);
      let best=null, bs=0; rs.forEach(r=>{ const s=Math.max(matchOption(optLabel(r), rv), matchOption(r.value, rv)); if(s>bs){bs=s;best=r;} });
      if (!best) { rep.manual.push(lab); continue; }
      if (isPostback(best)) { postbacks.push({el:best, radio:true, key, short:lab, text:rv}); continue; }
      best.click(); if(!best.checked){ best.checked=true; best.dispatchEvent(new Event('change',{bubbles:true})); }
      mark(best.parentElement||best,'#1E7A4C'); rep.filled.push({k:key, l:lab, v:rv, how:rs[0].hasAttribute('data-mphub-key')?'ai':viaModel?'model':keyFromId(rs[0])?'id':'label'}); changed++;
    }

    // text / select / textarea / file
    const cands = [];
    for (const el of els) {
      if (el.type==='radio' || ['submit','button','image','reset'].includes(el.type)) continue;
      done.add(el);
      if (el.type==='checkbox') { rep.checkboxes++; continue; }
      const c = classify(el, values);
      if (c.blocked) { rep.blocked++; mark(el,'#9AA0AE','blocked'); continue; }
      if (el.type==='file') { cands.push({el, c, file:true}); continue; }
      const pv = c.key ? resolveValue(c.key, values, c.labs, el) : null;
      if (pv!=null && pv!=='') cands.push({el, c});
      else if (!el.value && (c.key || el.required || /\*/.test(c.all))) { rep.manual.push(c.short); mark(el,'#E0A100','manual'); }
      if (c.suggest && !el.value) { rep.suggest = rep.suggest || []; rep.suggest.push({l:c.short, k:c.suggest}); }
      if (!c.key && el.type!=='file' && (!el.value || (el.tagName==='SELECT' && isEmptySelect(el)))) askAI([el], c.short, c.all, el.tagName==='SELECT'?'select':el.type||'text', el.tagName==='SELECT'?Array.from(el.options).map(o=>o.text.trim()):[]);
    }
    const used = new Set(rep.filled.map(f=>f.k+'@'+f.l));
    for (const {el, c, file} of cands) {
      if (file) {
        if (el.files && el.files.length) continue;
        let kind = c.key && c.key[0]==='@' ? c.key.slice(1) : null;
        const l = c.all;
        if (!kind) { const P=/photo|फोटो|फ़ोटो|छायाचित्र/i.test(l), S=/sign|हस्ताक्षर/i.test(l), H=/hand ?writ|हस्तलिपि|हस्तलिखित|composite|combined|संयुक्त/i.test(l); kind = (P&&S)||H ? 'composite' : S ? 'sign' : P ? 'photo' : null; }
        if (kind==='photo' && /हस्ताक्षर|sign/i.test(l) && !/फोटो|photo/i.test(c.labs.join(' '))) kind='sign';
        // a document upload ("10th marksheet", "caste certificate" …): attach the saved scan in the format and size the box asks for
        if (!kind && window.MPHubDocFmt) { const dk = window.MPHubDocFmt.kindFor(l); if (dk && files['doc_'+dk]) kind = 'doc_'+dk; }
        if (kind && kind.startsWith('doc_')) {
          const near = l + ' ' + (el.getAttribute('accept')||'') + ' ' + ((el.closest('tr,div,td,fieldset')||{}).innerText||'').slice(0,300);
          const h = window.MPHubDocFmt.hint(near), acc = (el.getAttribute('accept')||'').toLowerCase();
          const wantPdf = acc ? (/pdf/.test(acc) && !/image|jpe?g|png/.test(acc)) : (h.pdf && !h.jpg);
          const maxKB = h.maxKB || 500, src = files[kind], label = c.short, input = el;
          mark(el,'#1E7A4C'); rep.files.push({kind, l:label, fmt: wantPdf?'PDF':'JPG', maxKB}); changed++;
          (async () => { try {
              const blob = wantPdf ? await window.MPHubDocFmt.pdf(src, {maxKB}) : await window.MPHubDocFmt.fit(src, {maxKB});
              const dt = new DataTransfer(); dt.items.add(new File([blob], kind.slice(4)+(wantPdf?'.pdf':'.jpg'), {type: blob.type}));
              input.files = dt.files; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true}));
            } catch(e) { mark(input,'#E0A100','manual'); } })();
          continue;
        }
        if (!kind || !files[kind]) { rep.manual.push(c.short+' (फ़ाइल)'); mark(el,'#E0A100','manual'); continue; }
        try { const dt=new DataTransfer(); dt.items.add(b64ToFile(files[kind], kind+'.jpg')); el.files=dt.files; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); mark(el,'#1E7A4C'); rep.files.push({kind, l:c.short}); changed++; }
        catch(e){ rep.manual.push(c.short+' (फ़ाइल)'); }
        continue;
      }
      const key = c.key; let v = resolveValue(key, values, c.labs, el);
      if (v==null || v==='') continue;
      if (DATE_KEYS.test(key)) v = formatDate(iso[key], el);
      if (el.tagName!=='SELECT' && (ENGLISH_ONLY || englishField(el)) && hasDeva(String(v))) { if (!el.value) { rep.manual.push(c.short+' (अंग्रेज़ी में)'); mark(el,'#E0A100','manual'); } continue; }
      if (!fits(el, key, v, c.labs)) { if (!el.value) { rep.manual.push(c.short); mark(el,'#E0A100','manual'); } continue; }
      if (el.tagName==='SELECT') {
        if (!isEmptySelect(el)) { rep.already.push({k:key,l:c.short}); continue; }
        let bi=-1, bs=0; Array.from(el.options).forEach((o,i)=>{ const s=Math.max(matchOption(o.text,v), matchOption(o.value,v)); if(s>bs){bs=s;bi=i;} });
        if (bi<0) { rep.manual.push(c.short); mark(el,'#E0A100','manual'); continue; }
        if (isPostback(el)) { postbacks.push({el, value:el.options[bi].value, key, short:c.short, text:el.options[bi].text}); continue; }
        setValue(el, el.options[bi].value); mark(el,'#1E7A4C'); rep.filled.push({k:key,l:c.short,v:el.options[bi].text,how:c.how}); changed++;
        continue;
      }
      // email split into "name" box + "@ domain" list (IBPS, many central portals): name part here, domain from the list
      if (key==='email' && /@/.test(v)) { const dsel = emailDomainSelect(el); if (dsel) {
          const [local, dom] = String(v).split('@'); const oi = Array.from(dsel.options).findIndex(o=>o.text.trim().toLowerCase().replace(/^@/,'')===dom.toLowerCase() || o.value.toLowerCase().replace(/^@/,'')===dom.toLowerCase());
          if (oi<0) { if (!el.value) { rep.manual.push(c.short+' (ईमेल डोमेन सूची में नहीं)'); mark(el,'#E0A100','manual'); } continue; }
          if (!el.value) { setValue(el, local); mark(el,'#1E7A4C'); rep.filled.push({k:key,l:c.short,v:local,how:c.how}); changed++; }
          if (isEmptySelect(dsel) || !/\./.test(dsel.options[dsel.selectedIndex].text)) { setValue(dsel, dsel.options[oi].value); mark(dsel,'#1E7A4C'); done.add(dsel); }
          continue; } }
      if (el.value && el.value.trim()) { if (norm(el.value)!==norm(v)) { rep.conflict.push({k:key,l:c.short,have:el.value,want:v}); mark(el,'#E2551F','conflict'); } else rep.already.push({k:key,l:c.short}); continue; }
      if (el.maxLength>0 && String(v).length>el.maxLength) { rep.manual.push(c.short+' (लंबाई सीमा)'); mark(el,'#E0A100','manual'); continue; }
      setValue(el, String(v)); mark(el,'#1E7A4C'); rep.filled.push({k:key,l:c.short,v,how:c.how}); changed++;
    }
    if (!changed) break;       // nothing new appeared → stop
  }

  // at most one control that reloads the page (ASP.NET AutoPostBack), only after everything else
  if (postbacks.length) {
    const p = postbacks[0]; rep.postback = true; rep.pending = postbacks.length-1;
    rep.filled.push({k:p.key, l:p.short, v:p.text, how:'postback'});
    setTimeout(()=>{ if (p.radio) p.el.click(); else setValue(p.el, p.value); }, 300);
  }
  // fields our own answers switched off (e.g. spouse name after "married: no", disability % after "PwD: no")
  // or that don't apply (no middle name) are not the student's job: clear their yellow mark
  const stillNeeded = new Set(), cleared = new Set();
  document.querySelectorAll('[data-mphub="manual"]').forEach(e=>{
    const off = e.disabled || e.readOnly || !visible(e);
    const noMiddle = compactId(e).match(/m(iddle)?name$/) && /m(iddle)?name/.test(compactId(e)) && !(values.middleName);
    if (off || noMiddle) { e.style.outline=''; e.removeAttribute('data-mphub'); const l=labelsOf(e); cleared.add(String((l.primary[0]||l.context[0]||compactId(e)||'')).slice(0,90)); }
    else stillNeeded.add(e);
  });
  rep.manual = Array.from(new Set(rep.manual.filter(m=>m && !cleared.has(m)))).slice(0,40);
  rep.manualCount = stillNeeded.size;
  // leave every filled box once more, now that all are filled: portals build combined fields on blur
  // (IBPS: Full Name = first + middle + last). In the app the boxes never really get focus, so el.blur() alone does nothing.
  document.querySelectorAll('input[data-mphub-set]:not([type=radio]):not([type=checkbox]),textarea[data-mphub-set]').forEach(el=>{ try { el.dispatchEvent(new Event('blur')); el.dispatchEvent(new FocusEvent('focusout',{bubbles:true})); } catch(e){} });
  credentials(payload, rep);
  watchForNewFields(payload);

  // which step of the portal is this?
  const inputs = Array.from(document.querySelectorAll('input,select,textarea')).filter(e=>e.type!=='hidden' && visible(e));
  const textInputs = inputs.filter(e=>/^(text|tel|email|number|date|)$/.test(e.type) && e.tagName!=='SELECT').length;
  const bodyText = (document.title||'')+' '+(document.body.innerText||'');
  const decl = (document.getElementById('CheckBox1')&&document.getElementById('Button1')) || (document.getElementById('chkdec')&&document.getElementById('btnRedirect'));
  const hasProfile = rep.filled.concat(rep.already).some(x=>x.k==='esbProfile');
  const isError = /\/Errors\.(aspx|htm)/i.test(location.pathname);
  const closedText = /submission date is over|date is over|अंतिम तिथि (समाप्त|निकल)|आवेदन (की तिथि )?समाप्त/i.test(bodyText) && textInputs<2;
  const closedForm = /\/Forms?\//i.test(location.pathname) && textInputs===0 && !inputs.some(e=>e.tagName==='SELECT');
  const msgClosed = (/Message=/.test(location.search) && /Home.aspx/i.test(location.pathname)) || /reg_close|date.?expired|last_date.*over|applicationclosed/i.test(location.href) || (/date expired|registration (is )?closed|last date .*(is )?over/i.test(bodyText) && textInputs<2);
  // journey stages: where in the portal's flow is the student?
  const path = location.pathname.toLowerCase();
  const isHub = HUB_PATH.test(path) && !msgClosed && !formy || (/^\/?$|\/index\.aspx$|\/portal\/?$/.test(path) && document.querySelectorAll('a[href*="notifications.aspx"],a[href*="Declaration.aspx"]').length>0 && textInputs<=3);
  const hasPassword = inputs.some(e=>e.type==='password');
  const otpField = inputs.find(e=>/(^|[_$])(txt)?otp(code|no|value|number|txt)?($|[_$])|enterotp|verifyotp/i.test((e.id||'')+' '+(e.name||'')) && !e.value);
  // success / receipt pages: read off the new profile number or application number (only on pages without a form)
  const capture = {};
  const openRadios = inputs.filter(e=>e.type==='radio').length > 0;
  if (textInputs<=3 && !openRadios) {
    const t = bodyText.replace(/\s+/g,' ');
    const near = (labels) => { const re = new RegExp('(?:' + labels + ')[^0-9A-Z]{0,40}?([A-Z]{0,4}\\d{6,16})', 'i'); const m = t.match(re); return m ? m[m.length-1] : null; };
    // strict: an explicit "successfully registered / submitted / paid" sentence (a question like "पूर्व में पंजीकृत?" is not enough)
    const ok = /(सफलतापूर्वक|successfully)[^.।]{0,80}(पंजीकृत|पंजीयन|registered|submitted|generated|जनरेट|जमा|सबमिट|received|प्राप्त|completed|पूर्ण)|(registration|application|payment)[^.।]{0,30}(successful|completed)|आवेदन[^.।]{0,40}(सफलतापूर्वक|सफल)/i.test(t);
    if (ok) {
      const prof = near('सामान्य पंजीकरण क्रमांक|प्रोफाइल (आईडी|क्रमांक|संख्या)|profile (id|no|number)|registration (no|number)|पंजीकरण (क्रमांक|संख्या)|पंजीयन क्रमांक');
      const app = near('application (no|number)|आवेदन (पत्र )?(क्रमांक|संख्या|नंबर)|form (no|number)|फॉर्म (क्रमांक|नंबर)|ऑनलाइन आवेदन पत्र क्रमांक');
      if (prof && /candidateprofil|profil|registration/i.test(path+t.slice(0,400))) capture.esbProfile = prof;
      if (app) capture.appNo = app;
      const txn = near('transaction (id|no)|ट्रांजेक्शन (आईडी|क्रमांक)'); if (txn) capture.txn = txn;
      // the ID this portal will ask for at login next time (registration no / user ID), remembered per portal
      const pid = near('registration (no|number|id)|user ?(id|name)|login ?id|candidate ?id|enrol+ment (no|number|id)|पंजीयन क्रमांक|पंजीकरण (क्रमांक|संख्या)') || prof;
      if (pid) capture.portalId = pid;
    }
  }
  if (Object.keys(capture).length) rep.capture = capture;
  rep.stage = msgClosed ? 'closed' : isError ? 'error' : rep.capture ? 'success' : isHub ? 'hub' : (otpField && textInputs <= 4) ? 'otp' : (hasPassword && textInputs<=4) ? 'login' : decl ? 'notice' : (closedText||closedForm) ? 'closed' : (hasProfile && textInputs<=4) ? 'profile' : 'form';
  rep.host = location.hostname; rep.url = location.href; rep.otpField = !!otpField;
  // login page: the portal's user ID / registration number saved from this portal's earlier success page (never a password)
  if (rep.stage === 'login') { const id = (payload.portalIds||{})[location.hostname.replace(/^www\./,'')];
    const box = id && inputs.find(e=>/^(text|email|tel|number|)$/.test(e.type) && e.tagName==='INPUT' && !e.value && !e.disabled && !e.readOnly && !BLOCK_ID.test(fullId(e)) && !/captcha|otp|code/i.test(fullId(e)+' '+labelsOf(e).primary.join(' ')));
    if (box) { setValue(box, id); mark(box,'#1E7A4C'); rep.filled.push({k:'portalId', l:String(labelsOf(box).primary[0]||'User ID').slice(0,60), v:id, how:'saved'}); rep.loginId = true; } }
  // nothing to fill and no form here (home page, Careers list, the job's details page): find the way to the form
  if (payload.job && rep.stage === 'form' && textInputs < 3 && !rep.filled.length && !rep.manual.length && !formy) { rep.way = findWay(payload.job, payload.portalIds); rep.stage = 'find'; }
  if (decl) { const cb=document.getElementById('CheckBox1')||document.getElementById('chkdec'); mark(cb.parentElement||cb,'#E0A100','manual'); cb.scrollIntoView({block:'center'});
    const adv=document.querySelector("a[onclick*='Advertisement']"); if (adv) { rep.needsAdvert=true; mark(adv,'#E0A100','manual'); } }
  return rep;
}

function applyMapping(map, payload){
  let tagged = 0;
  (map||[]).forEach(m=>{ if (!m || !m.key || typeof m.i!=='number') return; document.querySelectorAll('[data-mphub-u="'+m.i+'"]').forEach(e=>{ e.setAttribute('data-mphub-key', m.key); tagged++; }); });
  const r = run(payload); r.aiTagged = tagged; r.aiFilled = r.filled.filter(f=>f.how==='ai').length; return r;
}
/* ---------- wait for the student, then carry on ----------
   Things only the student may do (OTP, captcha, password, Aadhaar, questions the profile can't answer, calendar pickers)
   are listed in a small "waiting for you" bar at the bottom of the portal page; tapping an item scrolls to it.
   The agent keeps watching the page: when the student completes something, a new part of the form appears (after OTP
   verification, a "Yes/No" that reveals more fields, a single-page portal moving to its next step) or a field becomes
   enabled, it fills again. It only ever fills empty fields, so nothing the student typed is overwritten. */
let watcher = null, lastPayload = null;
const L10N = (hi, en) => (lastPayload && lastPayload.lang === 'en') ? en : hi;
function needsStudent(){
  const out = [], seen = new Set();
  for (const el of Array.from(document.querySelectorAll('input,select,textarea'))) {
    if (el.type==='hidden' || el.disabled || !visible(el) || ['submit','button','image','reset'].includes(el.type)) continue;
    if (el.type==='radio') { const g=Array.from(document.getElementsByName(el.name||'')).filter(x=>x.type==='radio'); if (g.some(x=>x.checked) || !g.some(x=>x.closest('[data-mphub="manual"]'))) continue; }
    else if (el.type==='checkbox') { if (el.checked || !(el.getAttribute('data-mphub')==='manual' || (el.parentElement&&el.parentElement.getAttribute('data-mphub')==='manual'))) continue; }
    else if (el.tagName==='SELECT' ? !isEmptySelect(el) : String(el.value||'').trim()) continue;
    const id = (el.id||'')+' '+(el.name||''), labs = labelsOf(el), all = labs.primary.concat(labs.context).join(' ');
    const lab = ((el.type==='radio' ? questionOf(Array.from(document.getElementsByName(el.name)).filter(x=>x.type==='radio')) : '') || labs.primary[0] || labs.context[0] || compactId(el) || '').slice(0,60);
    let kind = null;
    if (/otp|one.?time/i.test(id+' '+all)) kind = 'OTP';
    else if (/captcha|security\s*code|कैप्चा|imgcode|txtcode|verification code/i.test(id+' '+all)) kind = L10N('कैप्चा','Captcha');
    else if (el.type==='password') kind = L10N('पासवर्ड','Password');
    else if (/aadha+r|आधार|\buid\b/i.test(id+' '+all)) kind = L10N('आधार','Aadhaar');
    else if (el.type==='radio' || el.getAttribute('data-mphub')==='manual' || (el.parentElement&&el.parentElement.getAttribute('data-mphub')==='manual') || (el.readOnly && /date|dob|birth|तिथि/i.test(id+' '+all))) kind = '';
    else continue;
    if (!kind && !el.required && !/\*/.test(all) && el.getAttribute('data-mphub')!=='manual' && !(el.readOnly && /date|dob|birth|तिथि/i.test(id+' '+all)) && el.type!=='radio') continue;
    const key = (kind||'')+'|'+(el.type==='radio'?el.name:lab); if (seen.has(key)) continue; seen.add(key);
    if (el.readOnly && !el.getAttribute('data-mphub')) mark(el,'#E0A100','manual');
    out.push({el: el.type==='radio' ? (el.closest('td,div,fieldset')||el) : el, label: kind ? kind + (lab && !new RegExp(kind,'i').test(lab) ? ' · '+lab : '') : lab});
    if (out.length>=8) break;
  }
  return out;
}
function waitBar(){
  let bar = document.getElementById('mphub-wait');
  const items = needsStudent();
  if (!items.length) { if (bar) { bar.remove(); document.body.style.paddingBottom = ''; } return items; }
  if (!bar) { bar = document.createElement('div'); bar.id='mphub-wait';
    bar.setAttribute('style','position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483646;background:#1B1530;color:#fff;border-radius:14px;padding:10px 12px;font:14px/1.35 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);max-height:40vh;overflow:auto');
    document.body.appendChild(bar); }
  bar.innerHTML = '';
  const h = document.createElement('div'); h.style.cssText='font-weight:700;margin-bottom:6px;cursor:pointer'; h.onclick = () => { bar.dataset.min = bar.dataset.min ? '' : '1'; waitBar(); }; h.textContent = L10N('आपका इंतज़ार है ('+items.length+'): ये खुद भरें, फिर भरना अपने-आप आगे बढ़ेगा', 'Waiting for you ('+items.length+'): fill these yourself, then filling continues on its own'); bar.appendChild(h);
  if (bar.dataset.min) h.textContent += ' ▴'; else for (const it of items) { const b = document.createElement('button'); b.type='button'; b.textContent = '› ' + it.label;
    b.setAttribute('style','display:block;width:100%;text-align:left;background:rgba(255,255,255,.1);color:#fff;border:0;border-radius:10px;padding:10px 12px;margin-top:6px;font:inherit;min-height:44px');
    b.onclick = () => { it.el.scrollIntoView({block:'center', behavior:'smooth'}); try { (it.el.focus? it.el : it.el.querySelector('input,select'))?.focus({preventScroll:true}); } catch(e){} };
    bar.appendChild(b); }
  document.body.style.paddingBottom = (bar.offsetHeight + 16) + 'px';   // the portal's own buttons stay reachable above the bar
  return items;
}
function watchForNewFields(payload){
  lastPayload = payload;
  setTimeout(waitBar, 50);
  if (watcher) return;
  let timer = null;
  const fp = () => Array.from(document.querySelectorAll('input,select,textarea')).filter(e=>e.type!=='hidden' && !e.disabled && visible(e)).map(e=>e.id||e.name||e.type).join(',');
  let seen = fp();
  const again = (why) => { try { const r=run(lastPayload); r.auto=true; r.why=why; window.__mphubLast = r; } catch(e){} };
  const check = () => { const now = fp(); if (now !== seen) { const grew = now.split(',').some(x=>!seen.split(',').includes(x)); seen = now; if (grew) { again('new-fields'); return; } } waitBar(); };
  // the page changes (new section, step 2 of a single-page portal, a field switched on)
  watcher = new MutationObserver(m=>{ if (m.every(x=>x.target && x.target.closest && x.target.closest('#mphub-wait'))) return; clearTimeout(timer); timer = setTimeout(check, 700); });
  watcher.observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['style','class','disabled','hidden']});
  // the student did something (typed the OTP, answered a question): refresh the list, and fill whatever that unlocked
  const onUser = ev => { if (!ev.isTrusted || (ev.target && ev.target.closest && ev.target.closest('#mphub-wait'))) return; clearTimeout(timer); timer = setTimeout(()=>{ const before = needsStudent().length; check(); if (before === 0 || ev.type==='change') again('student'); }, 1200); };
  document.addEventListener('change', onUser, true); document.addEventListener('input', onUser, true);
  window.addEventListener('hashchange', ()=>setTimeout(()=>{ seen=''; check(); }, 900));   // single-page portals (#/route)
}
/* diagnostics for the test rig */
function inventory(valuesIn, isoIn){
  const values = derive(valuesIn||{}, isoIn||{});
  return Array.from(document.querySelectorAll('input,select,textarea')).filter(el=>el.type!=='hidden' && visible(el)).map(el=>{
    const c = classify(el, values);
    const labs=labelsOf(el); const radioQ = el.type==='radio' ? questionOf(Array.from(document.getElementsByName(el.name||'')).filter(x=>x.type==='radio').length?Array.from(document.getElementsByName(el.name)):[el]) : '';
    return {id:el.id||el.name, name:el.name||'', cid:compactId(el), tag:el.tagName.toLowerCase(), type:el.type, label:(c.short||''), primary:labs.primary.join(' | ').slice(0,200), context:labs.context.join(' | ').slice(0,200), question:radioQ, optText: el.type==='radio'?norm((el.labels&&el.labels[0]?el.labels[0].textContent:'')||(el.nextSibling&&el.nextSibling.nodeType===3?el.nextSibling.textContent:'')||el.value):'', key:c.key, how:c.how, blocked:!!c.blocked,
      options: el.tagName==='SELECT'?Array.from(el.options).slice(0,20).map(o=>o.text.trim()):undefined,
      value: el.type==='radio'||el.type==='checkbox' ? (el.checked?'✓':'') : (el.tagName==='SELECT'?(el.options[el.selectedIndex]||{}).text:el.value)};
  });
}
window.MPHubAgent = {run, inventory, applyMapping, siteSearch, fillOtp, version:VERSION};
})();
