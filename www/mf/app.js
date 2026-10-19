'use strict';
const API='https://api.mfapi.in/mf';
// The six checks from the video. op = pass condition
const CRITS=[
 {id:'dd',  name:'Maximum Drawdown',  unit:'%', tag:'Brake',   desc:'Worst fall in the last 5 years stays below the limit',  op:'<',def:30},
 {id:'c1',  name:'Absolute Return – 1Y', unit:'%', tag:'Mood',  desc:'Not a red year — last 1Y return above the limit',      op:'>',def:0},
 {id:'ath', name:'% Away from ATH',   unit:'%', tag:'Damage',  desc:'NAV within the limit of its all-time high',             op:'<',def:10},
 {id:'arr', name:'3Y ARR',            unit:'%', tag:'Quality', desc:'Average 3-year rolling annual return above the limit',  op:'>',def:20},
 {id:'top3',name:'Top 3 Holdings',    unit:'%', tag:'Safety',  desc:'Top 3 stocks below the limit — not a one-bet fund',     op:'<',def:40},
 {id:'cash',name:'Cash Holdings',     unit:'%', tag:'Cash',    desc:'Cash below the limit — your money should be working',   op:'<',def:5}
];
const LS='mfscreener.v4';
const $=id=>document.getElementById(id);
let DB=load();
let sortK='passed',showMode='all',catF='',limit=100;

// Everything read back from localStorage is treated as untrusted: anything malformed falls back to defaults.
function load(){
  const blank={funds:{},resolved:{},manual:{},cfg:{},skip:{}};
  try{
    const d=JSON.parse(localStorage.getItem(LS));
    if(!d||typeof d!=='object'||Array.isArray(d))return blank;
    for(const k of Object.keys(blank))if(!d[k]||typeof d[k]!=='object'||Array.isArray(d[k]))d[k]=blank[k];
    return d;
  }catch(e){return blank}
}
function save(){try{localStorage.setItem(LS,JSON.stringify(DB))}catch(e){}}
function setStatus(t){$('status').textContent=t}
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('on');setTimeout(()=>e.classList.remove('on'),2200)}
async function jget(u){const r=await fetch(u);if(!r.ok)throw new Error(r.status);return r.json()}

function pd(s){const[d,m,y]=s.split('-');return Date.UTC(+y,+m-1,+d)}
const DAY=864e5,YR=365.25*DAY;
function navAt(a,t){
  let lo=0,hi=a.length-1,r=-1;
  while(lo<=hi){const m=(lo+hi)>>1;if(a[m].t<=t){r=m;lo=m+1}else hi=m-1}
  return r<0?null:a[r].v;
}
const back=(t,y)=>{const d=new Date(t);d.setUTCFullYear(d.getUTCFullYear()-y);return d.getTime()}; // same calendar date y years earlier
function metrics(js){
  const a=js.data.map(d=>({t:pd(d.date),v:+d.nav})).filter(d=>d.v>0).reverse();
  if(a.length<60)return null;
  const last=a[a.length-1],first=a[0];
  const ageY=(last.t-first.t)/YR;
  const m={code:js.meta.scheme_code,isin:js.meta.isin_growth,
    name:js.meta.scheme_name.replace(/ ?-? ?(Direct Plan|Growth Option|Growth Plan|Growth|Option|Plan)\b/gi,'').replace(/[ -]+$/,''),
    house:js.meta.fund_house,cat:(js.meta.scheme_category||'').replace(/^.*? - /,''),
    age:+ageY.toFixed(1),nav:last.v,date:last.t};
  const s1=navAt(a,back(last.t,1));
  m.c1=(ageY>=1&&s1)?(last.v/s1-1)*100:null;                 // 1Y absolute return
  const ath=a.reduce((x,y)=>Math.max(x,y.v),0);
  m.ath=(1-last.v/ath)*100;                                   // % away from all-time high
  const w5=a.filter(x=>x.t>=back(last.t,5));                  // max drawdown, last 5y
  let peak=0,dd=0;for(const x of w5){peak=Math.max(peak,x.v);dd=Math.min(dd,x.v/peak-1)}
  m.dd=-dd*100;
  const rolls=[];                                             // 3Y annualised rolling returns (weekly, up to 10y)
  for(let t=Math.max(first.t+3*YR,last.t-10*YR);t<=last.t;t+=7*DAY){
    const e=navAt(a,t),s=navAt(a,back(t,3));if(e&&s)rolls.push((Math.pow(e/s,1/3)-1)*100)}
  if(rolls.length>20){
    m.arr=rolls.reduce((x,y)=>x+y,0)/rolls.length;
    m.arrMin=Math.min(...rolls);m.arrMax=Math.max(...rolls);
  }
  m.c3=(ageY>=3&&navAt(a,back(last.t,3)))?(Math.pow(last.v/navAt(a,back(last.t,3)),1/3)-1)*100:null;
  m.c5=(ageY>=5&&navAt(a,back(last.t,5)))?(Math.pow(last.v/navAt(a,back(last.t,5)),1/5)-1)*100:null;
  m.spark=[];for(let t=last.t-5*YR;t<=last.t;t+=30*DAY){const v=navAt(a,t);if(v&&t>=first.t)m.spark.push(+v.toFixed(3))}
  return m;
}

const EQ=/equity|hybrid|index|elss|solution|fund of funds|other scheme/i;
const SAFE_CODE=/^\d{1,9}$/;   // scheme codes are plain integers; never interpolate anything else into a URL
async function fetchFund(code){
  if(!SAFE_CODE.test(String(code)))return null;
  const js=await jget(`${API}/${code}`);
  if(!EQ.test(js.meta.scheme_category||''))return DB.skip[code]=1,null;
  const m=metrics(js);if(!m)return null;
  if(Date.now()-m.date>45*DAY)return DB.skip[code]=1,null; // discontinued
  m.fetched=Date.now();
  DB.funds[code]=m;return m;
}
let universe=null;
async function getUniverse(){
  if(universe)return universe;
  const ex=/idcw|dividend(?! yield)|payout|bonus|reinvest|regular|liquid|overnight|debt|gilt|bond|money market|duration|credit|fmp|fixed|series|etf|exchange traded|interval|floater|treasury|(?<!equity )savings|income|ultra|target maturity|segregated|arbitrage|capital protection|year plus|plan [ivx]+|gold|silver/i;
  const all=await jget(API);const seen=new Set();
  universe=all.filter(x=>/direct/i.test(x.schemeName)&&/growth/i.test(x.schemeName)&&!ex.test(x.schemeName)).filter(x=>{
    const k=x.isinGrowth||x.schemeCode;if(seen.has(k))return false;seen.add(k);return true}).map(x=>x.schemeCode).filter(c=>SAFE_CODE.test(String(c)));
  return universe;
}

let lastRender=0,renderT=null;
function softRender(){const n=Date.now();if(n-lastRender>700){lastRender=n;render()}else if(!renderT)renderT=setTimeout(()=>{renderT=null;lastRender=Date.now();render()},700)}

async function loadAll(force){
  setStatus('Fetching fund list…');
  let codes;
  try{codes=await getUniverse()}catch(e){setStatus('Could not load fund list: '+e.message);return}
  const queue=codes.filter(c=>{
    if(DB.skip[c]&&!force)return false;
    const f=DB.funds[c];return force||!f||Date.now()-(f.fetched||0)>12*3600e3});
  const total=queue.length;let done=0;
  if(!total){finish();return}
  async function worker(){
    while(queue.length){
      const c=queue.shift();
      try{await fetchFund(c)}catch(e){console.warn(c,e)}
      done++;
      if(done%25===0)save();
      $('prog').style.width=(done/total*100)+'%';
      setStatus(`Loading funds ${done}/${total} · ${Object.keys(DB.funds).length} ready`);
      softRender();
    }
  }
  await Promise.all(Array.from({length:8},worker));
  finish();
}
function finish(){
  DB.t=Date.now();save();$('prog').style.width='0';
  if(/^#\/?fund\//.test(location.hash))route();   // a direct link may have arrived before the funds were loaded
  setStatus(`${Object.keys(DB.funds).length} funds · NAV as of ${new Date(Math.max(0,...Object.values(DB.funds).map(f=>f.date))).toLocaleDateString()}`);
  render();
}

// ---------- classification ----------
const GROUPS=[['Large & Mid Cap',/large\s*&\s*mid/i],['Large Cap',/large cap/i],['Mid Cap',/mid cap/i],['Small Cap',/small cap/i],['Multi Cap',/multi cap/i],['Flexi Cap',/flexi/i],['Focused',/focused/i],['Value / Contra',/value|contra|dividend yield/i],['ELSS (Tax Saver)',/elss/i],['Sectoral / Thematic',/sector|thematic/i],['Index Funds',/index/i],['Hybrid / Asset Allocation',/hybrid|balanced|asset allocation|arbitrage/i],['Fund of Funds',/fof|fund of funds/i],['Retirement / Children',/retirement|children/i]];
function grp(cat,name=''){for(const[n,r]of GROUPS)if(r.test(cat))return n;if(/index|nifty|sensex|etf/i.test(name))return'Index Funds';return'Other / Unclassified'}
const isDebt=f=>/^debt/i.test(f.cat)||/ibx|sdl|g-?sec|gilt|bond|liquid/i.test(f.name);

// ---------- holdings ----------
let HOLD={};
function loadHoldings(){
  const j=window.HOLDINGS;
  if(j&&typeof j==='object'&&j.funds&&typeof j.funds==='object'){HOLD=j.funds;HOLD._updated=j.updated;render()}
  else setStatus('Holdings data (data/holdings.js) not found — checks 5 & 6 need it');
}
function val(f,id){
  if(id==='top3'||id==='cash'){
    const m=DB.manual[f.code];if(m&&m[id]!=null)return m[id];
    const h=HOLD[f.code];return h?(id==='top3'?h.t3:h.cash):null;
  }
  return f[id];
}

// ---------- checklist ----------
function cfg(id){const c=DB.cfg[id]||{};const d=CRITS.find(x=>x.id===id);return{on:c.on!==false,v:Number.isFinite(c.v)?c.v:d.def}}
function buildCrits(){
  $('crits').innerHTML=CRITS.map((c,i)=>{const s=cfg(c.id);return `<div class="crit ${s.on?'':'off'}" data-id="${c.id}">
    <div class="lbl">${i+1} · ${c.tag}</div>
    <b>${c.name}</b>
    <div class="note">${c.desc}</div>
    <div class="row">
      <label class="chk"><input type="checkbox" data-on="${c.id}" ${s.on?'checked':''}> On</label>
      <span style="flex:1"></span>
      <span class="op">${c.op}</span><input class="in" type="number" data-v="${c.id}" value="${s.v}" step="1"><span class="mu">${c.unit}</span>
    </div></div>`}).join('');
}
$('crits').oninput=e=>{
  const t=e.target,id=t.dataset.on||t.dataset.v;if(!id)return;
  const c=DB.cfg[id]=DB.cfg[id]||{};
  if(t.dataset.on){c.on=t.checked;t.closest('.crit').classList.toggle('off',!t.checked)}else c.v=+t.value;
  save();render();
};
// collapse / expand (remembered)
function setCollapsed(c){
  $('checklist').classList.toggle('collapsed',c);
  $('clToggle').setAttribute('aria-expanded',String(!c));
  try{localStorage.setItem('mfscreener.clcollapsed',c?'1':'0')}catch(e){}
}
function clSummary(){
  $('clSum').innerHTML=CRITS.map(c=>{const s=cfg(c.id);return s.on?`<span class="chip ac">${c.tag} ${c.op} ${s.v}${c.unit}</span>`:`<span class="chip" style="opacity:.5">${c.tag} off</span>`}).join('');
}
$('clToggle').onclick=()=>setCollapsed(!$('checklist').classList.contains('collapsed'));
let _c='1';try{_c=localStorage.getItem('mfscreener.clcollapsed')??'1'}catch(e){}
setCollapsed(_c!=='0'); // collapsed by default
// returns 'ok' | 'no' | 'unk' | 'off'
function check(f,c){
  const s=cfg(c.id);if(!s.on)return'off';
  const v=val(f,c.id);
  if(v==null||isNaN(v))return(c.id==='top3'||c.id==='cash')?'unk':'no';
  return(c.op==='<'?v<s.v:v>s.v)?'ok':'no';
}

// ---------- render ----------
const f1=(v,d=1)=>v==null||isNaN(v)?'–':v.toFixed(d);
const sgn=v=>v==null?'':v>=0?'up':'dn';
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let ALL=[];
function compute(){
  const unkPass=$('unkPass').checked;
  ALL=Object.values(DB.funds).filter(f=>!isDebt(f));
  const onCount=CRITS.filter(c=>cfg(c.id).on).length;
  for(const f of ALL){
    f.grp=grp(f.cat,f.name);
    f.top3=val(f,'top3');f.cash=val(f,'cash');
    f.res=CRITS.map(c=>check(f,c));
    f.passed=f.res.filter(r=>r==='ok'||(r==='unk'&&unkPass)).length;
    f.conf=f.res.filter(r=>r==='ok').length;
    f.unkN=f.res.filter(r=>r==='unk').length;
  }
  return onCount;
}
const ASC=new Set(['dd','top3','age_'])
function render(){
  const onCount=compute();clSummary();
  const cnt={};ALL.forEach(x=>cnt[x.grp]=(cnt[x.grp]||0)+1);
  const names=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a]);
  // category chips
  $('cats').innerHTML=`<button class="cp-opt ${catF?'':'on'}" data-g="">All categories<small>${ALL.length}</small></button>`+
    names.map(n=>`<button class="cp-opt ${catF===n?'on':''}" data-g="${esc(n)}">${esc(n)}<small>${cnt[n]}</small></button>`).join('');
  $('cpVal').innerHTML=catF?esc(catF):`All<small>${names.length} categories</small>`;
  // universe bars
  const mx=Math.max(1,...Object.values(cnt));
  $('breakdown').innerHTML=names.map(n=>`<div class="bar" data-g="${esc(n)}"><div class="nm">${esc(n)}</div><div class="tr"><i style="width:${cnt[n]/mx*100}%"></i></div><div class="vl">${cnt[n]}</div></div>`).join('')+
    `<div class="bar" style="cursor:default"><div class="nm"><b>Total</b></div><div></div><div class="vl"><b>${ALL.length}</b></div></div>`;

  const minAge=+$('f_age').value||0,q=$('q').value.toLowerCase();
  const rows=ALL.filter(f=>{
    if(catF&&f.grp!==catF)return false;
    if(f.age<minAge)return false;
    if(q&&!(f.name+f.house).toLowerCase().includes(q))return false;
    if(showMode==='all')return f.passed>=onCount;
    if(showMode==='1')return f.passed>=onCount-1;
    return true;
  });
  const dir=(sortK==='dd'||sortK==='top3'||sortK==='cash'||sortK==='ath')?1:-1;
  const key=sortK==='passed'?'conf':sortK;
  if(sortK==='name')rows.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
  else if(sortK==='grp')rows.sort((a,b)=>a.grp.localeCompare(b.grp)||b.conf-a.conf||((b.arr??-1e9)-(a.arr??-1e9))||a.name.localeCompare(b.name));
  else rows.sort((a,b)=>{
    const va=a[key],vb=b[key];
    const d=(va==null?-dir*1e9:va)-(vb==null?-dir*1e9:vb);
    return dir*d||((b.arr??-1e9)-(a.arr??-1e9));
  });

  // KPIs
  const qualifying=ALL.filter(f=>f.passed>=onCount).length;
  const asof=Object.values(HOLD).find(h=>h&&h.d)?.d||'–';
  $('kpis').innerHTML=[
    ['Funds screened',ALL.length,'Direct-Growth schemes'],
    ['Qualifying',qualifying,onCount?`pass all ${onCount} active checks`:'no checks active'],
    ['Showing',rows.length,catF||'all categories'],
    ['Holdings as of',asof,'AMC monthly disclosure','Month-end date of the portfolio snapshot used for checks 5 and 6 (Top 3 % and Cash %). Fund houses publish holdings once a month, a few days after month-end, so these two numbers reflect the portfolio on that date, not today. The NAV-based checks (1Y return, drawdown, ATH distance, 3Y ARR) are live up to the latest NAV date.']
  ].map(([k,v,s,tip])=>`<div class="kpi"><small>${k}${tip?` <button class="info" type="button" aria-label="About ${k}" data-tip="${esc(tip)}">i</button>`:''}</small><b class="${k==='Qualifying'?'up':''}" style="${k==='Holdings as of'?'font-size:18px;line-height:30px':''}">${v}</b><i>${esc(s)}</i></div>`).join('');
  $('count').textContent=`${rows.length} fund${rows.length===1?'':'s'}`;

  // list
  if(!rows.length){
    $('list').innerHTML=`<div class="card empty"><b>No funds match</b>Loosen a check, switch to “Near misses”, or pick another category.</div>`;
    $('more').hidden=true;return;
  }
  $('list').innerHTML=rows.slice(0,limit).map(f=>{
    const full=onCount&&f.conf===onCount;
    const chips=CRITS.map((c,i)=>{const r=f.res[i];if(r==='off')return'';
      const cls=r==='ok'?'up':r==='no'?'dn':'';
      return `<span class="chip ${cls}">${c.tag} ${r==='ok'?'✓':r==='no'?'✗':'?'}</span>`}).join('');
    return `<div class="trow" data-c="${f.code}">
      <div class="av ${full?'full':''}">${f.conf}/${onCount}</div>
      <div>
        <div class="m1"><b>${esc(f.name)}</b><span class="chip ac">${esc(f.grp)}</span>${f.unkN?`<span class="chip am">${f.unkN} no data</span>`:''}</div>
        <div class="m2">${esc(f.house||'')} · ${f1(f.age)}y</div>
        <div class="m4"><span>DD ${f1(f.dd)}%</span><span>1Y ${f1(f.c1)}%</span><span>ATH −${f1(f.ath)}%</span><span>Top3 ${f1(f.top3,2)}%</span><span>Cash ${f1(f.cash,2)}%</span></div>
        <div class="m3">${chips}</div>
      </div>
      <div class="rt"><b class="${sgn(f.arr)}">${f1(f.arr)}%</b><small>3Y ARR</small></div>
    </div>`}).join('');
  $('more').hidden=rows.length<=limit;
  $('more').textContent=`Show more (${rows.length-limit} left)`;
}

// ---------- detail sheet ----------
function sip(target,years,rate){const r=rate/1200,n=years*12;return target*r/((Math.pow(1+r,n)-1)*(1+r))}
const inr=v=>v==null?'–':'₹'+Number(v).toLocaleString('en-IN',{maximumFractionDigits:2});
function renderFund(code){
  const x=DB.funds[code];if(!x)return;
  const onCount=CRITS.filter(c=>cfg(c.id).on).length;
  const sp=x.spark||[],mn=Math.min(...sp),mxv=Math.max(...sp);
  const P=sp.map((v,i)=>[i/(sp.length-1||1)*600,200-(v-mn)/(mxv-mn||1)*180]);
  const line=P.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const h=HOLD[x.code];
  const kv=(k,v,t)=>`<div><small>${k}</small><b class="${t?'t':''}">${v}</b></div>`;
  const checks=CRITS.map((c,i)=>{
    const r=x.res[i],v=val(x,c.id),s=cfg(c.id);
    const chip=r==='ok'?'<span class="chip up">Pass</span>':r==='no'?'<span class="chip dn">Fail</span>':r==='unk'?'<span class="chip am">No data</span>':'<span class="chip">Off</span>';
    return `<div class="q ${r==='off'?'dis':''}"><div class="qt">${i+1}. ${c.name} <small>${c.tag} · need ${c.op} ${s.v}${c.unit} · actual <span class="mono" style="color:var(--tx)">${f1(v,2)}${v==null?'':c.unit}</span></small></div>${chip}</div>`}).join('');
  $('sheet').innerHTML=`
  <div class="sh-head"><button class="btn ghost sm" id="shClose" type="button" aria-label="Back">← Back</button><h2>${esc(x.name)}</h2><span class="chip ${x.conf===onCount&&onCount?'up':''}">${x.conf}/${onCount} checks</span></div>
  <div class="sh-body">
    <div class="col">
      <div class="card"><h3>${esc(x.house)} <small>${esc(x.cat)} · scheme ${x.code}</small></h3>
        <div class="sumgrid">
          ${kv('NAV','₹'+x.nav.toFixed(2))}${kv('1Y return',f1(x.c1)+'%')}${kv('3Y CAGR',f1(x.c3)+'%')}${kv('5Y CAGR',f1(x.c5)+'%')}
          ${kv('3Y ARR (avg)',f1(x.arr)+'%')}${kv('3Y roll. worst',f1(x.arrMin)+'%')}${kv('3Y roll. best',f1(x.arrMax)+'%')}${kv('Age',x.age+' yrs')}
          ${kv('Max drawdown','−'+f1(x.dd)+'%')}${kv('From ATH','−'+f1(x.ath)+'%')}${kv('Top 3',f1(x.top3,2)+'%')}${kv('Cash',f1(x.cash,2)+'%')}
        </div></div>
      <div class="card"><h3>Checklist <small>against your current limits</small></h3>${checks}</div>
      <div class="card"><h3>Scheme details <small>${h?'via Groww':''}</small></h3>${h?`
        <div class="sumgrid">
          ${kv('Min. investment',inr(h.min))}${kv('Min. SIP',inr(h.sip))}${kv('AUM',h.aum!=null?inr(h.aum)+' Cr':'–')}
          ${kv('Expense ratio',(h.base??h.er)!=null?(h.base??h.er)+'%':'–')}${kv('TER (total)',h.er!=null?h.er+'%':'–')}
          ${kv('Benchmark',esc(h.bench||'–'),1)}${kv('Fund manager(s)',esc(h.mgr||'–'),1)}
        </div>
        <div class="q" style="margin-top:10px;display:block"><div class="qt"><small>Exit load</small>${esc(h.exit||'–')}</div></div>
        ${h.obj?`<div class="note" style="margin-top:8px">${esc(h.obj)}</div>`:''}`:'<div class="note">No scheme details available for this fund.</div>'}
      </div>
    </div>
    <div class="col">
      <div class="card"><h3>NAV <small>last 5 years</small></h3>
        <div class="chart-host"><svg viewBox="0 0 600 220" preserveAspectRatio="none">
          <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6482ff" stop-opacity=".35"/><stop offset="1" stop-color="#6482ff" stop-opacity="0"/></linearGradient></defs>
          <polygon fill="url(#ag)" points="0,220 ${line} 600,220"/>
          <polyline fill="none" stroke="#6482ff" stroke-width="2" vector-effect="non-scaling-stroke" points="${line}"/></svg></div></div>
      <div class="card"><h3>Top holdings <small>${h?'as of '+esc(h.d||'–'):''}</small></h3>${h&&h.top?.length?
        h.top.slice(0,5).map(t=>`<div class="q"><div class="qt">${esc(t[0])}</div><b class="mono">${t[1]}%</b></div>`).join('')+
        `<div class="q"><div class="qt"><b>Top 3 total</b><small>futures &amp; cash excluded</small></div><b class="mono">${h.t3}%</b></div>
         <button class="btn ghost" id="shAll" type="button" style="width:100%;margin-top:10px">Show all${h.n?` ${h.n}`:''} holdings →</button>`:'<div class="note">No holdings data.</div>'}</div>
      <div class="card"><h3>SIP planner <small>how much per month to hit a target</small></h3>
        <div class="grid g3">
          <div class="fld"><label class="lbl">Target (₹ lakh)</label><input class="in" type="number" id="p_t" value="100"></div>
          <div class="fld"><label class="lbl">Years</label><input class="in" type="number" id="p_y" value="15"></div>
          <div class="fld"><label class="lbl">Return % p.a.</label><input class="in" type="number" id="p_r" value="12"></div>
        </div>
        <p id="p_out" style="font-size:15px;margin:12px 0 0"></p></div>
    </div>
  </div>`;
  const calc=()=>{const s=sip(+$('p_t').value*1e5,+$('p_y').value,+$('p_r').value);
    $('p_out').innerHTML=isFinite(s)?`Monthly SIP needed: <b class="mono">₹${Math.ceil(s).toLocaleString('en-IN')}</b> <span class="note">(total invested ≈ ₹${Math.round(s*$('p_y').value*12/1e5)} L)</span>`:''};
  ['p_t','p_y','p_r'].forEach(i=>$(i).oninput=calc);calc();
  $('shClose').onclick=goBack;
  const all=$('shAll');if(all)all.onclick=()=>go('#fund/'+code+'/holdings');
  $('sheet').scrollTop=0;
}

// ---------- full holdings page ----------
let _portP=null;
function loadPortfolio(){   // data/portfolio.js is large, so it is only fetched the first time someone opens a holdings page
  if(window.PORTFOLIO)return Promise.resolve(window.PORTFOLIO);
  if(_portP)return _portP;
  _portP=new Promise((res,rej)=>{
    const sc=document.createElement('script');sc.src='data/portfolio.js';
    sc.onload=()=>res(window.PORTFOLIO||{});sc.onerror=()=>{_portP=null;rej(new Error('load'))};
    document.head.appendChild(sc);
  });
  return _portP;
}
let holdCode=null;
function renderHoldings(code){
  const x=DB.funds[code],h=HOLD[code];if(!x)return;
  holdCode=code;
  $('sheet2').innerHTML=`
  <div class="sh-head"><button class="btn ghost sm" id="hdBack" type="button" aria-label="Back">← Back</button><h2>${esc(x.name)}</h2></div>
  <div class="sh-body" style="grid-template-columns:minmax(0,1fr);max-width:760px;margin:0 auto">
    <div class="card"><h3>All holdings <small id="hdMeta">${h?'as of '+esc(h.d||'–'):''}</small></h3>
      <div class="hd-head"><span>Company</span><span>Allocation</span></div>
      <div id="hdList"><div class="note" style="padding:14px 0">Loading…</div></div>
    </div>
  </div>`;
  $('hdBack').onclick=goBack;
  const fill=rows=>{
    if(holdCode!==code)return;
    $('hdMeta').textContent=(h&&h.d?'as of '+h.d+' · ':'')+rows.length+' positions';
    $('hdList').innerHTML=rows.map(r=>`<div class="hd-row"><div class="hd-n">${esc(r[0])}${r[2]&&r[2]!=='Equity'?`<small>${esc(r[2])}</small>`:''}</div><b class="mono ${r[1]<0?'dn':''}">${r[1].toFixed(2)}%</b></div>`).join('')||'<div class="note" style="padding:14px 0">No holdings data.</div>';
  };
  loadPortfolio().then(P=>fill(Array.isArray(P[code])&&P[code].length?P[code]:(h&&h.top||[]).map(t=>[t[0],t[1],''])))
    .catch(()=>{if(holdCode===code){$('hdList').innerHTML='<div class="note" style="padding:14px 0">Could not load the full list. Showing the top holdings only.</div>'+((h&&h.top)||[]).map(t=>`<div class="hd-row"><div class="hd-n">${esc(t[0])}</div><b class="mono">${t[1]}%</b></div>`).join('')}});
  $('sheet2').scrollTop=0;
}

// ---------- navigation (history-aware, so the phone's Back button steps back instead of closing the app) ----------
// Pages are hash routes: "" = screener, #universe, #fund/<code>, #fund/<code>/holdings.
// Opening a page pushes a history entry; Back pops it. goBack() is what every on-screen back button calls.
let curSheet=null,_holdShown=null;
function route(){
  const h=location.hash.replace(/^#\/?/,'');
  const m=h.match(/^fund\/(\d{1,9})(\/holdings)?$/);
  if(m&&DB.funds[m[1]]){
    const code=m[1];
    tab('screen');
    if(curSheet!==code){renderFund(code);curSheet=code;_holdShown=null}
    $('ov').classList.add('open');
    if(m[2]){if(_holdShown!==code){renderHoldings(code);_holdShown=code}$('ov2').classList.add('open')}
    else $('ov2').classList.remove('open');
  }else{
    $('ov2').classList.remove('open');$('ov').classList.remove('open');holdCode=null;curSheet=null;_holdShown=null;
    tab(h==='universe'?'universe':'screen');
  }
  document.body.style.overflow=$('ov').classList.contains('open')?'hidden':'';
}
function go(hash){history.pushState({app:1},'',hash);route()}
function goBack(){
  if(history.state&&history.state.app)history.back();
  else{   // opened via a direct link: nothing to step back to, so go one level up instead
    const m=location.hash.match(/^#fund\/(\d+)\/holdings$/);
    history.replaceState(null,'',m?'#fund/'+m[1]:location.pathname+location.search);route();
  }
}
window.addEventListener('popstate',route);
function openFund(code){go('#fund/'+code)}
$('ov').onclick=e=>{if(e.target===$('ov'))goBack()};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('ov').classList.contains('open'))goBack()});

// ---------- events ----------
function closeTips(){document.querySelectorAll('.tip').forEach(t=>t.remove());document.querySelectorAll('.info.on').forEach(i=>i.classList.remove('on'))}
document.addEventListener('click',e=>{
  const b=e.target.closest('.info');
  const wasOn=b&&b.classList.contains('on');
  closeTips();
  if(!b||wasOn)return;
  b.classList.add('on');
  const t=document.createElement('div');t.className='tip';t.textContent=b.dataset.tip;
  b.closest('.kpi').appendChild(t);
});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeTips()});
function tab(t){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===t));
  ['screen','universe'].forEach(n=>$('v_'+n).hidden=n!==t);
}
$('tabs').onclick=e=>{const b=e.target.closest('button');if(!b)return;
  if(b.dataset.tab==='universe'){if(location.hash!=='#universe')go('#universe')}
  else if(location.hash==='#universe')goBack();else tab('screen')};
function cpOpen(o){$('catpick').classList.toggle('open',o);$('cpToggle').setAttribute('aria-expanded',String(o))}
$('cpToggle').onclick=()=>cpOpen(!$('catpick').classList.contains('open'));
$('cats').onclick=e=>{const b=e.target.closest('.cp-opt');if(!b)return;catF=b.dataset.g;limit=100;cpOpen(false);render()};
$('breakdown').onclick=e=>{const b=e.target.closest('.bar[data-g]');if(!b)return;catF=b.dataset.g;limit=100;cpOpen(false);if(location.hash==='#universe')goBack();else tab('screen');render()};
$('showSeg').onclick=e=>{const b=e.target.closest('button');if(!b)return;showMode=b.dataset.v;limit=100;
  document.querySelectorAll('#showSeg button').forEach(x=>x.classList.toggle('on',x===b));render()};
$('sortSeg').onclick=e=>{const b=e.target.closest('button');if(!b)return;sortK=b.dataset.k;
  document.querySelectorAll('#sortSeg button').forEach(x=>x.classList.toggle('on',x===b));render()};
$('q').oninput=()=>{limit=100;render()};
$('f_age').oninput=()=>{limit=100;render()};
$('unkPass').onchange=render;
$('allOn').onclick=()=>{DB.cfg={};save();buildCrits();render()};
$('more').onclick=()=>{limit+=100;render()};
$('list').onclick=e=>{const r=e.target.closest('.trow');if(r)openFund(r.dataset.c)};
$('refresh').onclick=()=>loadAll(true);
buildCrits();render();loadHoldings();loadAll(false);route();

// ---------- install as an app (PWA) ----------
if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}))}
let _dp=null;const _ib=$('inst');
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();_dp=e;_ib.hidden=false});
_ib.addEventListener('click',async()=>{if(!_dp)return;_dp.prompt();await _dp.userChoice;_dp=null;_ib.hidden=true});
window.addEventListener('appinstalled',()=>{_ib.hidden=true;toast('Installed')});
