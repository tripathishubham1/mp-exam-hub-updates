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
const titleCase = s => s.replace(/w/g, c=>c.toUpperCase());
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
  setter.call(el, v);
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
function classify(el, values){
  const labs = labelsOf(el);
  const all = labs.primary.concat(labs.context).join(' | ');
  const short = (labs.primary[0] || labs.context[0] || compactId(el) || '').slice(0,90);
  if (el.type==='password' || BLOCK_ID.test(fullId(el)) || labs.primary.some(t=>BLOCK.test(t)) || labs.context.some(t=>/captcha|कैप्चा|enter answer|security code/i.test(t))) return {blocked:true, short};
  let key = el.getAttribute('data-mphub-key') || keyFromId(el), how = el.hasAttribute('data-mphub-key') ? 'ai' : 'id';
  if (!key) { const r = keyFromLabel(labs.primary.length?labs.primary:labs.context); if (r) { key=r.key; how='label'; } }
  let suggest = null;
  if (!key && el.type!=='file') { const m = askModel(labs.primary.join(' | '), labs.context.join(' | '), el, el.tagName==='SELECT'?'select':'text', el.tagName==='SELECT'?Array.from(el.options).map(o=>o.text):[]); if (m && m.sure) { key=m.key; how='model'; } else if (m) suggest=m.key; }
  return {key, how, short, labs:labs.primary.length?labs.primary:labs.context, all, suggest};
}

/* ---------- main ---------- */
/* exam lists / portal home pages: nothing to fill here, the app navigates to the exam's own form */
const HUB_PATH = /attestation\/home\/home\.aspx$|\/vyapam\/examslist\.aspx$|^\/?$|\/default\.aspx$|\/index\.aspx$/i;
function run(payload){
  if (HUB_PATH.test(location.pathname) && !/Message=/.test(location.search)) return {filled:[], already:[], conflict:[], manual:[], blocked:0, files:[], checkboxes:0, postback:false, unknown:[], page:document.title, version:VERSION, stage:'hub'};
  const iso = payload.iso||{}, files = payload.files||{};
  const values = derive(payload.values||{}, iso);
  const rep = {filled:[], already:[], conflict:[], manual:[], blocked:0, files:[], checkboxes:0, postback:false, page:document.title||location.hostname, version:VERSION, unknown:[]};
  let uSeq = 0; document.querySelectorAll('[data-mphub-u]').forEach(e=>{ uSeq=Math.max(uSeq, Number(e.getAttribute('data-mphub-u'))+1); });
  const askAI = (els, label, ctx, type, options) => { if (els[0].hasAttribute('data-mphub-u') || els[0].hasAttribute('data-mphub-key') || rep.unknown.length>=40) return; const i=uSeq++; els.forEach(e=>e.setAttribute('data-mphub-u', i)); rep.unknown.push({i, label:String(label||'').slice(0,300), context:String(ctx||'').slice(0,300), type, options:(options||[]).map(o=>String(o).slice(0,80)).slice(0,20)}); };
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
      if (!key || rv==null || rv==='') { if (!rs.some(r=>r.checked)) { rep.manual.push(lab); if (!key) askAI(rs, q || c.short, c.all, 'radio', rs.map(r=>norm((r.labels&&r.labels[0]?r.labels[0].textContent:'')||(r.nextSibling&&r.nextSibling.nodeType===3?r.nextSibling.textContent:'')||r.value))); } continue; }
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
  const isHub = HUB_PATH.test(path) && !msgClosed || (/^\/?$|\/index\.aspx$|\/portal\/?$/.test(path) && document.querySelectorAll('a[href*="notifications.aspx"],a[href*="Declaration.aspx"]').length>0 && textInputs<=3);
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
    }
  }
  if (Object.keys(capture).length) rep.capture = capture;
  rep.stage = msgClosed ? 'closed' : isError ? 'error' : rep.capture ? 'success' : isHub ? 'hub' : otpField ? 'otp' : (hasPassword && textInputs<=4) ? 'login' : decl ? 'notice' : (closedText||closedForm) ? 'closed' : (hasProfile && textInputs<=4) ? 'profile' : 'form';
  if (decl) { const cb=document.getElementById('CheckBox1')||document.getElementById('chkdec'); mark(cb.parentElement||cb,'#E0A100','manual'); cb.scrollIntoView({block:'center'});
    const adv=document.querySelector("a[onclick*='Advertisement']"); if (adv) { rep.needsAdvert=true; mark(adv,'#E0A100','manual'); } }
  return rep;
}

function applyMapping(map, payload){
  let tagged = 0;
  (map||[]).forEach(m=>{ if (!m || !m.key || typeof m.i!=='number') return; document.querySelectorAll('[data-mphub-u="'+m.i+'"]').forEach(e=>{ e.setAttribute('data-mphub-key', m.key); tagged++; }); });
  const r = run(payload); r.aiTagged = tagged; r.aiFilled = r.filled.filter(f=>f.how==='ai').length; return r;
}
/* fields that appear later without a page load (UpdatePanel, show/hide) get filled too, for 60 s */
let watcher = null, lastPayload = null;
function watchForNewFields(payload){
  lastPayload = payload;
  if (watcher) return;
  let timer = null; const started = Date.now();
  const count = () => Array.from(document.querySelectorAll('input,select,textarea')).filter(e=>e.type!=='hidden' && visible(e)).length;
  let seen = count();
  watcher = new MutationObserver(()=>{
    if (Date.now()-started > 60000) { watcher.disconnect(); watcher=null; return; }
    clearTimeout(timer);
    timer = setTimeout(()=>{ const n=count(); if (n>seen) { seen=n; try { const r=run(lastPayload); r.auto=true; window.__mphubLast = r; } catch(e){} } }, 700);
  });
  watcher.observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['style','class','disabled']});
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
window.MPHubAgent = {run, inventory, applyMapping, version:VERSION};
})();
