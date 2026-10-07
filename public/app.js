const APP_BUILD='0.30';const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function storedUser(){try{return JSON.parse(localStorage.getItem('rrr_prod_user')||'null')}catch{return null}}
(function syncBuildCache(){const old=sessionStorage.getItem('rrr_prod_build');if(old!==APP_BUILD){Object.keys(sessionStorage).filter(k=>k.startsWith('rrr_prod_cache_')).forEach(k=>sessionStorage.removeItem(k));sessionStorage.setItem('rrr_prod_build',APP_BUILD)}})();
const state={token:localStorage.getItem('rrr_prod_token')||'',user:storedUser(),current:sessionStorage.getItem('rrr_prod_page')||'dashboard',refreshing:false,netCount:0,lastButton:null,lastButtonAt:0,grids:{},activeGridKey:''};
function setStatus(text,kind='ok'){const el=$('#syncStatus');if(!el)return;el.textContent=text;el.className='status '+kind}
function newRequestId(){return (crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2))}
function cacheKey(m){return 'rrr_prod_cache_'+m}
function readCache(m){try{const x=JSON.parse(sessionStorage.getItem(cacheKey(m))||'null');return x&&x.data?x:null}catch{return null}}
function writeCache(m,data){try{sessionStorage.setItem(cacheKey(m),JSON.stringify({ts:Date.now(),data}))}catch{}return data}
function dropCaches(){Object.keys(sessionStorage).filter(k=>k.startsWith('rrr_prod_cache_')).forEach(k=>sessionStorage.removeItem(k));lookupCache=null;mastersCache=null}
function toast(message,kind='ok',ms=2200){const host=$('#toastHost');if(!host)return;const el=document.createElement('div');el.className='app-toast '+kind;el.innerHTML='<b>'+esc(message)+'</b>';host.appendChild(el);requestAnimationFrame(()=>el.classList.add('show'));setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),220)},ms)}
function inferActivity(path,opt={}){if(opt.activity)return opt.activity;const method=String(opt.method||'GET').toUpperCase();if(path.includes('/login'))return'Logging in…';if(path.includes('/users')&&method==='POST')return'Saving user…';if(path.includes('/users'))return'Loading users…';if(method==='POST')return'Saving changes…';if(path.includes('module=masters'))return'Loading masters…';if(path.includes('module=lookups'))return'Loading options…';if(path.includes('module=dashboard'))return'Loading dashboard…';return'Loading data…'}
function setButtonBusy(btn,on,label='Working…'){if(!btn)return;if(on){if(btn.dataset.busy==='1')return;btn.dataset.busy='1';btn.dataset.originalHtml=btn.innerHTML;btn.disabled=true;btn.classList.add('is-busy');btn.innerHTML='<span class="btn-spinner"></span><span>'+esc(label)+'</span>'}else if(btn.dataset.busy==='1'){btn.disabled=false;btn.classList.remove('is-busy');btn.innerHTML=btn.dataset.originalHtml||'Done';delete btn.dataset.busy;delete btn.dataset.originalHtml}}
function activityStart(label,button){state.netCount++;const hud=$('#operationHud');if(hud){$('#operationTitle').textContent=label;$('#operationSub').textContent='Please wait…';hud.classList.remove('hidden')}setStatus('↻ '+label,'busy');setButtonBusy(button,true,label.replace('…',''));const slow=setTimeout(()=>{if(state.netCount>0){if($('#operationSub'))$('#operationSub').textContent='Still working… do not click again';setStatus('↻ Still working…','busy')}},3500);return slow}
function activityEnd(slow,button,ok=true,message=''){clearTimeout(slow);state.netCount=Math.max(0,state.netCount-1);setButtonBusy(button,false);if(state.netCount===0){$('#operationHud')?.classList.add('hidden');setStatus(ok?'● Ready':'● Action failed',ok?'ok':'bad')}if(message)toast(message,ok?'ok':'bad')}
async function api(path,opt={}){const h={'content-type':'application/json',...(opt.headers||{})};if(state.token)h.authorization='Bearer '+state.token;const label=inferActivity(path,opt);const recentBtn=(Date.now()-state.lastButtonAt<1200)?state.lastButton:null;const btn=opt.button||recentBtn||null;const slow=activityStart(label,btn);try{const r=await fetch(path,{...opt,headers:h});const d=await r.json().catch(()=>({}));if(!r.ok){const e=new Error(d.error||'Request failed');e.status=r.status;throw e}activityEnd(slow,btn,true,opt.success||'');return d}catch(e){activityEnd(slow,btn,false,e.message||'Failed');throw e}}
fetch('/api/health',{cache:'no-store'}).catch(()=>{});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;state.lastButton=b;state.lastButtonAt=Date.now();b.classList.remove('tap');void b.offsetWidth;b.classList.add('tap');setTimeout(()=>b.classList.remove('tap'),260)},true);
async function getCachedModule(module,force=false){const c=readCache(module);if(!force&&c){if(Date.now()-c.ts>20000){api('/api/data?module='+module).then(d=>writeCache(module,d)).catch(()=>{})}return c.data}const d=await api('/api/data?module='+module);return writeCache(module,d)}
const NAV=[['dashboard','⌂','Dashboard'],['raw','▣','Raw Fabric'],['dye','◉','Dyeing'],['production','✂','Production'],['stitching','⇄','Stitching'],['qc','✓','QC & Rework'],['handover','⇥','Warehouse Handover'],['reports','▤','Reports'],['masters','◆','Masters'],['users','⚙','Users']];
function allowed(m){if(!state.user)return false;if(m==='dashboard')return true;if(m==='users'||m==='masters')return !!state.user.admin;if(m==='handover')return state.user.admin||state.user.permissions?.qc;return state.user.admin||!!state.user.permissions?.[m]}
function actionModule(m){return m==='handover'?'qc':m}
function canAction(m,action='view'){
  if(!state.user)return false;if(state.user.admin)return true;
  const mod=actionModule(m),base=mod==='reports'?!!state.user.permissions?.reports:!!state.user.permissions?.[mod];
  if(!base)return false;
  const x=state.user.actions?.[mod];return x?x[action]!==false:true
}
function fmtDate(v,withTime=false){
  if(v===null||v===undefined||v==='')return'';
  const s=String(v),m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(!m)return s;
  const mon=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m[2])-1];
  const base=m[3]+'-'+mon+'-'+m[1];
  if(!withTime||!s.includes('T'))return base;
  const d=new Date(s);if(Number.isNaN(d.getTime()))return base;
  return base+' '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'Asia/Kolkata'})
}
function isQtyKey(k){return /(?:QTY|COUNT|PIECES|_CUT$|_ISSUED$|_RECEIVED$|PENDING)/i.test(String(k))}
function showApp(){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');$('#sideName').textContent=state.user.name;$('#sideRole').textContent=state.user.role;renderNav();go(allowed(state.current)?state.current:'dashboard')}
function renderNav(){$('#nav').innerHTML=NAV.filter(x=>allowed(x[0])).map(([m,i,l])=>`<button data-m="${m}">${i} &nbsp; ${l}</button>`).join('');$('#nav').querySelectorAll('button').forEach(b=>b.onclick=()=>go(b.dataset.m))}
async function go(m,force=false){if(!allowed(m))return;state.activeGridKey='';setStatus('↻ Opening '+(NAV.find(x=>x[0]===m)?.[2]||m)+'…','busy');state.current=m;sessionStorage.setItem('rrr_prod_page',m);document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.m===m));$('#pageTitle').textContent=NAV.find(x=>x[0]===m)?.[2]||m;if(m==='dashboard')return renderDashboard(force);if(m==='reports')return renderReports(force);if(m==='masters')return renderMasters(force);if(m==='users')return renderUsers(force);return renderModule(m,force)}
async function renderDashboard(force=false){const s=$('#stage');s.innerHTML=`<section class="hero"><div><h2>Production Control</h2><p>Raw fabric to warehouse handover — one traceable workflow.</p></div><div>${new Date().toLocaleDateString()}</div></section><section class="kpis">${['Raw Available','At Dye','Dyed Available','Cut Pending','At Stitching','Ready Warehouse'].map(x=>`<div class="kpi"><span>${x}</span><strong>—</strong></div>`).join('')}</section><section class="grid2"><div class="panel"><div class="panel-head"><h3>Quick Actions</h3></div><div class="quick">${[['raw','New Fabric Inward'],['dye','Issue to Dye'],['production','Plan Production'],['stitching','Create Stitch Challan'],['qc','QC Entry'],['handover','Warehouse Handover']].filter(x=>allowed(x[0])).map(x=>`<button onclick="window.ERP.quick('${x[0]}')"><b>${x[1]}</b><small>Open module</small></button>`).join('')}</div></div><div class="panel"><div class="panel-head"><h3>System</h3></div><p>Cloudflare D1 primary database</p><p>Cloudflare secure frontend & API</p><p>User-wise permissions & audit trail</p></div></section>`;try{const d=await getCachedModule('dashboard',force);state.user=d.user||d.actor||state.user;const v=d.kpis||{};[v.rawAvailable,v.atDye,v.dyedAvailable,v.cutPending,v.atStitching,v.readyWarehouse].forEach((x,i)=>document.querySelectorAll('.kpi strong')[i].textContent=x??0)}catch(e){toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}}

const prefMem=new Map(),prefTimers=new Map();
function prefLocalKey(page){return 'rrr_prod_pref_'+String(state.user?.userId||'anon')+'_'+page}

function defaultGridPrefs(columns){const d=columns.filter(x=>x!=='__ACTION');return{search:'',filters:{},visibleColumns:[...d],columnOrder:[...d],columnWidths:{},pageSize:25,page:1,sortKey:'',sortDir:'asc',density:'comfortable',namedViews:{},exportScope:'filtered'}}
async function loadGridPrefs(page,columns){
  const base=defaultGridPrefs(columns);let local={};
  try{local=JSON.parse(localStorage.getItem(prefLocalKey(page))||'{}')}catch{}
  const merged={...base,...local,filters:{...(base.filters||{}),...(local.filters||{})},columnWidths:{...(base.columnWidths||{}),...(local.columnWidths||{})},namedViews:{...(base.namedViews||{}),...(local.namedViews||{})}};
  if(prefMem.has(page)){const x=prefMem.get(page);return{...merged,...x,filters:{...merged.filters,...(x.filters||{})},columnWidths:{...merged.columnWidths,...(x.columnWidths||{})},namedViews:{...merged.namedViews,...(x.namedViews||{})}}}
  try{
    const r=await fetch('/api/preferences?page='+encodeURIComponent(page),{headers:{authorization:'Bearer '+state.token}});
    if(r.ok){
      const d=await r.json(),server=d.prefs||{};
      const p={...merged,...server,filters:{...merged.filters,...(server.filters||{})},columnWidths:{...merged.columnWidths,...(server.columnWidths||{})},namedViews:{...merged.namedViews,...(server.namedViews||{})}};
      prefMem.set(page,p);localStorage.setItem(prefLocalKey(page),JSON.stringify(p));return p
    }
  }catch{}
  prefMem.set(page,merged);return merged
}
function saveGridPrefs(page,prefs){
  prefMem.set(page,prefs);try{localStorage.setItem(prefLocalKey(page),JSON.stringify(prefs))}catch{}
  clearTimeout(prefTimers.get(page));prefTimers.set(page,setTimeout(async()=>{
    try{await fetch('/api/preferences',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+state.token},body:JSON.stringify({page,prefs})})}catch{}
  },350))
}
function gridLabel(k){return String(k||'').replace(/^__/,'').replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase())}
function gridCell(k,v){
  if(['ACTIVE','FABRIC_SUPPLIER','DYE_VENDOR','STITCHING_VENDOR','CUTTING_VENDOR','admin','active'].includes(k))return boolText(v);
  return displayCell(k,v)
}
function uniqueFilterValues(items,key){
  const m=new Map();
  for(const r of items||[]){
    const raw=r?.[key];if(raw===undefined||raw===null||raw==='')continue;
    const label=String(gridCell(key,raw)).replace(/<[^>]+>/g,'');
    m.set(String(raw),label)
  }
  return [...m.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]),undefined,{numeric:true,sensitivity:'base'}))
}
function isDateColumn(k,items=[]){
  if(/(?:DATE|TIMESTAMP|_AT|CREATED|UPDATED|LAST_LOGIN)/i.test(String(k)))return true;
  const sample=(items||[]).map(r=>r?.[k]).find(v=>v!==null&&v!==undefined&&v!=='');
  return typeof sample==='string'&&/^\d{4}-\d{2}-\d{2}(?:T|\s|$)/.test(sample)
}
function dateYmd(v){
  if(v===null||v===undefined||v==='')return'';
  const s=String(v);const m=s.match(/^(\d{4}-\d{2}-\d{2})/);if(m)return m[1];
  const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10)
}
function normalizeFilterState(v,isDate=false){
  if(isDate){
    if(v&&typeof v==='object'&&!Array.isArray(v))return{type:'date',from:String(v.from||''),to:String(v.to||'')};
    return{type:'date',from:'',to:''}
  }
  if(Array.isArray(v))return v.map(String);
  if(v===null||v===undefined||v==='')return[];
  return[String(v)]
}
function filterIsActive(v,isDate=false){
  const n=normalizeFilterState(v,isDate);
  return isDate?!!(n.from||n.to):n.length>0
}
function sortableValue(v){
  if(v===null||v===undefined)return'';
  const s=String(v).trim();
  if(s!==''&&!Number.isNaN(Number(s)))return Number(s);
  const d=Date.parse(s);if(/\d{4}-\d{2}-\d{2}/.test(s)&&!Number.isNaN(d))return d;
  return s.toLowerCase()
}
function applyGridData(items,prefs,columns){
  let out=[...(items||[])],q=String(prefs.search||'').trim().toLowerCase();
  if(q)out=out.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  for(const key of columns||[]){
    if(key==='__ACTION')continue;
    const dateCol=isDateColumn(key,items),f=normalizeFilterState(prefs.filters?.[key],dateCol);
    if(dateCol){
      if(f.from)out=out.filter(r=>{const d=dateYmd(r?.[key]);return d&&d>=f.from});
      if(f.to)out=out.filter(r=>{const d=dateYmd(r?.[key]);return d&&d<=f.to})
    }else if(f.length){
      const set=new Set(f.map(String));out=out.filter(r=>set.has(String(r?.[key]??'')))
    }
  }
  if(prefs.sortKey){
    const key=prefs.sortKey,dir=prefs.sortDir==='desc'?-1:1;
    out.sort((a,b)=>{const av=sortableValue(a?.[key]),bv=sortableValue(b?.[key]);if(av<bv)return-dir;if(av>bv)return dir;return 0})
  }
  return out
}
function gridPageNumbers(current,total){
  const set=new Set([1,total,current,current-1,current+1]);if(total>5){set.add(2);set.add(total-1)}
  return [...set].filter(x=>x>=1&&x<=total).sort((a,b)=>a-b)
}
function isTotalableKey(k){return /(?:MTR|METER|QTY|COUNT|PIECES|_CUT$|_ISSUED$|_RECEIVED$|PENDING|BALANCE)/i.test(String(k))&&!/(?:ID|DATE|STATUS|AGE)/i.test(String(k))}
function gridTotals(rows,cols){const o={};for(const k of cols)if(isTotalableKey(k)){const v=rows.map(r=>Number(r?.[k])).filter(Number.isFinite);if(v.length)o[k]=v.reduce((a,b)=>a+b,0)}return o}
function gridViewSnapshot(p){return{search:p.search,filters:structuredClone(p.filters||{}),visibleColumns:[...(p.visibleColumns||[])],columnOrder:[...(p.columnOrder||[])],columnWidths:{...(p.columnWidths||{})},pageSize:p.pageSize,sortKey:p.sortKey,sortDir:p.sortDir,density:p.density,exportScope:p.exportScope}}
function buildHeaderFilterPopup(k,items,prefs){
  const dateCol=isDateColumn(k,items),current=normalizeFilterState(prefs.filters?.[k],dateCol);
  if(dateCol)return `
    <div class="th-filter-menu hidden" data-filter-pop="${esc(k)}">
      <div class="th-filter-title">Filter ${gridLabel(k)}</div>
      <div class="date-range-grid">
        <label><span>From</span><input type="date" data-date-from="${esc(k)}" value="${esc(current.from)}"></label>
        <label><span>To</span><input type="date" data-date-to="${esc(k)}" value="${esc(current.to)}"></label>
      </div>
      <div class="th-filter-actions">
        <button type="button" data-date-clear="${esc(k)}">Clear</button>
        <button type="button" class="apply" data-date-apply="${esc(k)}">Apply</button>
      </div>
    </div>`;
  const vals=uniqueFilterValues(items,k),selected=new Set(current.map(String));
  return `
    <div class="th-filter-menu hidden" data-filter-pop="${esc(k)}">
      <div class="th-filter-title">Filter ${gridLabel(k)}</div>
      <input class="th-filter-search" data-filter-search="${esc(k)}" placeholder="Search values...">
      <div class="th-filter-shortcuts"><button type="button" data-select-all="${esc(k)}">Select all</button><button type="button" data-clear-all="${esc(k)}">Clear</button></div>
      <div class="th-filter-values" data-filter-values="${esc(k)}">
        ${vals.length?vals.map(([v,l])=>`<label data-value-label="${esc(String(l).toLowerCase())}"><input type="checkbox" data-filter-check="${esc(k)}" value="${esc(v)}" ${selected.has(String(v))?'checked':''}> <span>${esc(l)}</span></label>`).join(''):'<div class="filter-empty">No values</div>'}
      </div>
      <div class="th-filter-actions"><button type="button" data-popup-cancel="${esc(k)}">Cancel</button><button type="button" class="apply" data-multi-apply="${esc(k)}">Apply</button></div>
    </div>`
}
async function mountDataGrid(container,opt){
  const key=opt.key,columns=opt.columns||[],dataCols=columns.filter(x=>x!=='__ACTION'),items=(opt.items||[]).map((r,i)=>({...r,__gridIndex:i}));
  let prefs=await loadGridPrefs(key,columns);
  prefs.columnOrder=(prefs.columnOrder||[]).filter(x=>dataCols.includes(x));for(const x of dataCols)if(!prefs.columnOrder.includes(x))prefs.columnOrder.push(x);
  prefs.visibleColumns=(prefs.visibleColumns||dataCols).filter(x=>dataCols.includes(x));if(!prefs.visibleColumns.length)prefs.visibleColumns=[...dataCols];
  prefs.pageSize=[10,25,50,100].includes(Number(prefs.pageSize))?Number(prefs.pageSize):25;
  prefs.sortKey=dataCols.includes(prefs.sortKey)?prefs.sortKey:'';prefs.sortDir=prefs.sortDir==='desc'?'desc':'asc';
  prefs.density=['compact','comfortable'].includes(prefs.density)?prefs.density:'comfortable';prefs.columnWidths=prefs.columnWidths||{};prefs.namedViews=prefs.namedViews||{};prefs.exportScope=['filtered','page','selected'].includes(prefs.exportScope)?prefs.exportScope:'filtered';
  const selected=new Set(),rt={key,opt,items,prefs,filtered:[],pageRows:[],selected};state.grids[key]=rt;state.activeGridKey=key;

  function headerCell(k){
    const sorted=prefs.sortKey===k,arrow=sorted?(prefs.sortDir==='asc'?'▲':'▼'):'↕';
    const dateCol=isDateColumn(k,items),filterOn=filterIsActive(prefs.filters?.[k],dateCol),w=Number(prefs.columnWidths[k]||0);
    return `<th data-col-key="${esc(k)}" ${w?`style="width:${w}px;min-width:${w}px;max-width:${w}px"`:''}>
      <div class="th-main">
        <button class="th-sort" data-sort="${esc(k)}"><span>${gridLabel(k)}</span><i>${arrow}</i></button>
        <button class="th-filter-btn ${filterOn?'active':''}" data-filter-menu="${esc(k)}" title="Filter ${gridLabel(k)}">⏷</button>
      </div>
      <span class="col-resizer" data-resize="${esc(k)}"></span>
      ${buildHeaderFilterPopup(k,items,prefs)}
    </th>`
  }

  function render(){
    const filtered=applyGridData(items,prefs,columns);rt.filtered=filtered;
    const pages=Math.max(1,Math.ceil(filtered.length/prefs.pageSize));prefs.page=Math.min(Math.max(1,Number(prefs.page)||1),pages);
    const start=(prefs.page-1)*prefs.pageSize,end=Math.min(start+prefs.pageSize,filtered.length),pageRows=filtered.slice(start,end);rt.pageRows=pageRows;
    const visible=prefs.columnOrder.filter(x=>prefs.visibleColumns.includes(x)),totals=gridTotals(filtered,visible),hasTotals=Object.keys(totals).length>0;
    const nums=gridPageNumbers(prefs.page,pages),buttons=[];let last=0;
    for(const n of nums){if(last&&n-last>1)buttons.push('<span class="page-gap">…</span>');buttons.push(`<button class="page-btn ${n===prefs.page?'active':''}" data-page="${n}">${n}</button>`);last=n}
    const selectHead='<th class="select-col"><input type="checkbox" class="select-page" title="Select current page"></th>';
    const head=selectHead+visible.map(headerCell).join('')+(columns.includes('__ACTION')?'<th class="action-sticky"><div class="th-main"><span class="th-static">Action</span></div></th>':'');
    const body=pageRows.length?pageRows.map((r,pi)=>{const sel=`<td class="select-col"><input type="checkbox" class="row-select" data-ridx="${r.__gridIndex}" ${selected.has(r.__gridIndex)?'checked':''}></td>`;const cells=visible.map(k=>{const w=Number(prefs.columnWidths[k]||0),sty=w?` style="width:${w}px;min-width:${w}px;max-width:${w}px"`:'';return k==='STATUS'?`<td${sty}>${badge(r[k])}</td>`:`<td${sty}>${gridCell(k,r[k])}</td>`}).join('');return '<tr>'+sel+cells+(columns.includes('__ACTION')?`<td class="action-sticky">${opt.actionRenderer?opt.actionRenderer(r,pi):'—'}</td>`:'')+'</tr>'}).join(''):`<tr><td colspan="${visible.length+(columns.includes('__ACTION')?1:0)+1}"><div class="smart-empty"><b>No matching records</b><span>Change filters/search or create a new record.</span></div></td></tr>`;
    const foot=hasTotals?`<tfoot><tr><td class="select-col"></td>${visible.map((k,i)=>`<td>${i===0?'<b>Filtered Total</b>':totals[k]!==undefined?`<b>${displayCell(k,totals[k])}</b>`:''}</td>`).join('')}${columns.includes('__ACTION')?'<td class="action-sticky"></td>':''}</tr></tfoot>`:'';

    const activeFilters=visible.filter(k=>filterIsActive(prefs.filters?.[k],isDateColumn(k,items))).length;
    container.innerHTML=`
      <div class="smart-grid-toolbar">
        <div class="grid-search-wrap"><span>⌕</span><input class="grid-search" placeholder="Search..." value="${esc(prefs.search||'')}"></div>
        <div class="grid-tools-cluster"><div class="grid-tool-wrap view-wrap"><button class="grid-tool-btn view-btn">Views ▾</button><div class="view-menu hidden"><div class="view-save-row"><input class="view-name" placeholder="Name this view"><button class="save-view-btn">Save</button></div><div class="saved-view-list">${Object.keys(prefs.namedViews||{}).sort().length?Object.keys(prefs.namedViews||{}).sort().map(n=>`<div><button class="load-view" data-view="${esc(n)}">${esc(n)}</button><button class="delete-view" data-view="${esc(n)}">×</button></div>`).join(''):'<small>No saved views yet</small>'}</div></div></div><button class="grid-tool-btn density-btn">${prefs.density==='compact'?'Compact':'Comfortable'}</button><select class="export-scope grid-tool-select"><option value="filtered" ${prefs.exportScope==='filtered'?'selected':''}>Export: Filtered</option><option value="page" ${prefs.exportScope==='page'?'selected':''}>Export: This page</option><option value="selected" ${prefs.exportScope==='selected'?'selected':''}>Export: Selected</option></select><div class="grid-tool-wrap"><button class="grid-tool-btn column-btn">Columns ▾</button><div class="column-menu hidden">${prefs.columnOrder.map((k,i)=>`<div class="column-config-row"><label><input type="checkbox" data-col="${esc(k)}" ${visible.includes(k)?'checked':''}> ${gridLabel(k)}</label><span><button type="button" class="col-up" data-colmove="${esc(k)}" ${i===0?'disabled':''}>↑</button><button type="button" class="col-down" data-colmove="${esc(k)}" ${i===prefs.columnOrder.length-1?'disabled':''}>↓</button></span></div>`).join('')}</div></div></div>
      </div>
      <div class="grid-active-meta"><span>Showing ${filtered.length?`${start+1}–${end}`:'0'} of ${filtered.length} filtered · ${items.length} total${activeFilters?` · ${activeFilters} filter${activeFilters>1?'s':''}`:''}${prefs.sortKey?` · Sorted by ${gridLabel(prefs.sortKey)} ${prefs.sortDir==='asc'?'↑':'↓'}`:''}</span><button class="clear-grid-filters ${(!prefs.search&&!activeFilters&&!prefs.sortKey)?'hidden':''}">Reset view</button></div>
      <div class="table-wrap grid-scroll density-${prefs.density}"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table></div>
      <div class="grid-footer">
        <div class="rows-control"><span>Rows per page</span><select class="page-size">${[10,25,50,100].map(n=>`<option value="${n}" ${n===prefs.pageSize?'selected':''}>${n}</option>`).join('')}</select>${selected.size?`<button class="clear-selection">Clear ${selected.size} selected</button>`:''}</div>
        <div class="pagination"><button class="page-btn prev" ${prefs.page<=1?'disabled':''}>‹</button>${buttons.join('')}<button class="page-btn next" ${prefs.page>=pages?'disabled':''}>›</button></div>
        <div class="page-count">Page ${prefs.page} of ${pages}</div>
      </div>`;

    const search=container.querySelector('.grid-search');
    let searchTimer=null;
    search.oninput=()=>{
      prefs.search=search.value;prefs.page=1;saveGridPrefs(key,prefs);
      clearTimeout(searchTimer);searchTimer=setTimeout(()=>{
        const pos=search.selectionStart??prefs.search.length;
        render();
        const next=container.querySelector('.grid-search');
        if(next){next.focus();try{next.setSelectionRange(pos,pos)}catch{}}
      },120)
    };

    container.querySelectorAll('[data-sort]').forEach(btn=>btn.onclick=e=>{
      e.stopPropagation();const k=btn.dataset.sort;
      if(prefs.sortKey===k)prefs.sortDir=prefs.sortDir==='asc'?'desc':'asc';
      else{prefs.sortKey=k;prefs.sortDir='asc'}
      prefs.page=1;saveGridPrefs(key,prefs);render()
    });

    container.querySelectorAll('[data-filter-menu]').forEach(btn=>btn.onclick=e=>{
      e.stopPropagation();
      const k=btn.dataset.filterMenu,pop=container.querySelector('[data-filter-pop="'+CSS.escape(k)+'"]');
      container.querySelectorAll('.th-filter-menu').forEach(x=>{if(x!==pop)x.classList.add('hidden')});
      if(!pop)return;
      const willOpen=pop.classList.contains('hidden');
      pop.classList.toggle('hidden');
      if(willOpen){
        const r=btn.getBoundingClientRect(),w=Math.max(240,pop.offsetWidth||240),gap=6;
        pop.style.position='fixed';
        pop.style.zIndex='9999';
        pop.style.width=w+'px';
        pop.style.left=Math.min(Math.max(8,r.right-w),window.innerWidth-w-8)+'px';
        pop.style.maxHeight=Math.min(420,window.innerHeight-24)+'px';
        requestAnimationFrame(()=>{
          const h=Math.min(pop.scrollHeight,Math.min(420,window.innerHeight-24));
          const below=window.innerHeight-r.bottom-gap;
          const top=below>=Math.min(h,260)?r.bottom+gap:Math.max(8,r.top-gap-h);
          pop.style.top=top+'px';
        });
      }
    });
    container.querySelectorAll('.th-filter-menu').forEach(pop=>pop.onclick=e=>e.stopPropagation());

    container.querySelectorAll('[data-filter-search]').forEach(inp=>inp.oninput=()=>{
      const k=inp.dataset.filterSearch,q=inp.value.trim().toLowerCase(),box=container.querySelector('[data-filter-values="'+CSS.escape(k)+'"]');
      box?.querySelectorAll('[data-value-label]').forEach(l=>l.classList.toggle('hidden',q&&!String(l.dataset.valueLabel||'').includes(q)))
    });
    container.querySelectorAll('[data-select-all]').forEach(btn=>btn.onclick=()=>{
      const k=btn.dataset.selectAll;container.querySelectorAll('[data-filter-check="'+CSS.escape(k)+'"]').forEach(cb=>{if(!cb.closest('label')?.classList.contains('hidden'))cb.checked=true})
    });
    container.querySelectorAll('[data-clear-all]').forEach(btn=>btn.onclick=()=>{
      const k=btn.dataset.clearAll;container.querySelectorAll('[data-filter-check="'+CSS.escape(k)+'"]').forEach(cb=>cb.checked=false)
    });
    container.querySelectorAll('[data-multi-apply]').forEach(btn=>btn.onclick=()=>{
      const k=btn.dataset.multiApply;prefs.filters[k]=[...container.querySelectorAll('[data-filter-check="'+CSS.escape(k)+'"]:checked')].map(cb=>cb.value);
      prefs.page=1;saveGridPrefs(key,prefs);render()
    });
    container.querySelectorAll('[data-popup-cancel]').forEach(btn=>btn.onclick=()=>btn.closest('.th-filter-menu')?.classList.add('hidden'));

    container.querySelectorAll('[data-date-apply]').forEach(btn=>btn.onclick=()=>{
      const k=btn.dataset.dateApply,from=container.querySelector('[data-date-from="'+CSS.escape(k)+'"]')?.value||'',to=container.querySelector('[data-date-to="'+CSS.escape(k)+'"]')?.value||'';
      if(from&&to&&from>to){toast('From date cannot be after To date.','bad',3000);return}
      prefs.filters[k]={type:'date',from,to};prefs.page=1;saveGridPrefs(key,prefs);render()
    });
    container.querySelectorAll('[data-date-clear]').forEach(btn=>btn.onclick=()=>{
      const k=btn.dataset.dateClear;prefs.filters[k]={type:'date',from:'',to:''};prefs.page=1;saveGridPrefs(key,prefs);render()
    });

    const colBtn=container.querySelector('.column-btn'),colMenu=container.querySelector('.column-menu');
    colBtn.onclick=e=>{e.stopPropagation();colMenu.classList.toggle('hidden')};colMenu.onclick=e=>e.stopPropagation();
    colMenu.querySelectorAll('[data-col]').forEach(cb=>cb.onchange=()=>{
      const col=cb.dataset.col;if(cb.checked&&!prefs.visibleColumns.includes(col))prefs.visibleColumns.push(col);
      if(!cb.checked)prefs.visibleColumns=prefs.visibleColumns.filter(x=>x!==col);
      if(!prefs.visibleColumns.length){cb.checked=true;prefs.visibleColumns=[col]}
      saveGridPrefs(key,prefs);render()
    });
    colMenu.querySelectorAll('.col-up,.col-down').forEach(b=>b.onclick=e=>{e.stopPropagation();const k=b.dataset.colmove,i=prefs.columnOrder.indexOf(k),j=i+(b.classList.contains('col-up')?-1:1);if(i<0||j<0||j>=prefs.columnOrder.length)return;[prefs.columnOrder[i],prefs.columnOrder[j]]=[prefs.columnOrder[j],prefs.columnOrder[i]];saveGridPrefs(key,prefs);render()});
    const viewBtn=container.querySelector('.view-btn'),viewMenu=container.querySelector('.view-menu');viewBtn.onclick=e=>{e.stopPropagation();viewMenu.classList.toggle('hidden')};viewMenu.onclick=e=>e.stopPropagation();
    container.querySelector('.save-view-btn').onclick=()=>{const n=container.querySelector('.view-name').value.trim();if(!n)return toast('Enter a view name.','bad',2500);prefs.namedViews[n]=gridViewSnapshot(prefs);saveGridPrefs(key,prefs);toast('View saved: '+n,'ok',2200);render()};
    container.querySelectorAll('.load-view').forEach(b=>b.onclick=()=>{const v=prefs.namedViews[b.dataset.view];if(!v)return;Object.assign(prefs,{...v,filters:structuredClone(v.filters||{}),visibleColumns:[...(v.visibleColumns||dataCols)],columnOrder:[...(v.columnOrder||dataCols)],columnWidths:{...(v.columnWidths||{})},page:1});saveGridPrefs(key,prefs);render()});
    container.querySelectorAll('.delete-view').forEach(b=>b.onclick=()=>{delete prefs.namedViews[b.dataset.view];saveGridPrefs(key,prefs);render()});
    container.querySelector('.density-btn').onclick=()=>{prefs.density=prefs.density==='compact'?'comfortable':'compact';saveGridPrefs(key,prefs);render()};
    container.querySelector('.export-scope').onchange=e=>{prefs.exportScope=e.target.value;saveGridPrefs(key,prefs)};
    container.querySelectorAll('.col-resizer').forEach(grip=>grip.onmousedown=e=>{e.preventDefault();e.stopPropagation();const k=grip.dataset.resize,th=grip.closest('th'),sx=e.clientX,sw=th.getBoundingClientRect().width;const move=ev=>{prefs.columnWidths[k]=Math.max(70,Math.min(520,sw+ev.clientX-sx));th.style.width=prefs.columnWidths[k]+'px';th.style.minWidth=prefs.columnWidths[k]+'px';th.style.maxWidth=prefs.columnWidths[k]+'px'};const up=()=>{document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);saveGridPrefs(key,prefs);render()};document.addEventListener('mousemove',move);document.addEventListener('mouseup',up)});
    const pageIds=pageRows.map(r=>r.__gridIndex),selectPage=container.querySelector('.select-page');if(selectPage){const all=pageIds.length&&pageIds.every(x=>selected.has(x));selectPage.checked=all;selectPage.indeterminate=!all&&pageIds.some(x=>selected.has(x));selectPage.onchange=()=>{for(const x of pageIds)selectPage.checked?selected.add(x):selected.delete(x);render()}}
    container.querySelectorAll('.row-select').forEach(cb=>cb.onchange=()=>{const x=Number(cb.dataset.ridx);cb.checked?selected.add(x):selected.delete(x);render()});
    container.querySelector('.clear-selection')?.addEventListener('click',()=>{selected.clear();render()});
    container.querySelector('.page-size').onchange=e=>{prefs.pageSize=Number(e.target.value);prefs.page=1;saveGridPrefs(key,prefs);render()};
    container.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{prefs.page=Number(b.dataset.page);saveGridPrefs(key,prefs);render()});
    container.querySelector('.prev').onclick=()=>{if(prefs.page>1){prefs.page--;saveGridPrefs(key,prefs);render()}};
    container.querySelector('.next').onclick=()=>{if(prefs.page<pages){prefs.page++;saveGridPrefs(key,prefs);render()}};
    container.querySelector('.clear-grid-filters')?.addEventListener('click',()=>{prefs.search='';prefs.filters={};prefs.sortKey='';prefs.sortDir='asc';prefs.page=1;saveGridPrefs(key,prefs);render()});
    if(opt.bindActions)opt.bindActions(pageRows,container);
  }
  rt.render=render;render();return rt
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.grid-tool-wrap'))document.querySelectorAll('.column-menu,.view-menu').forEach(x=>x.classList.add('hidden'));
  if(!e.target.closest('th'))document.querySelectorAll('.th-filter-menu').forEach(x=>x.classList.add('hidden'));
  if(!e.target.closest('.export-menu-wrap'))$('#exportMenu')?.classList.add('hidden')
});
const configs={
raw:{title:'Raw Fabric',columns:['ROLL_ID','INWARD_DATE','SUPPLIER','VENDOR_ROLL_NO','FABRIC','INWARD_MTR','ISSUED_MTR','BALANCE_MTR','STATUS','__ACTION'],filters:['SUPPLIER','FABRIC','STATUS'],action:'New Inward',fields:['INWARD_DATE','SUPPLIER_ID','VENDOR_ROLL_NO','FABRIC_ID','INWARD_MTR','INVOICE_CHALLAN','LOT_REF','NOTES']},
dye:{title:'Dyeing',columns:['DYE_PLAN_ID','DYE_BATCH_ID','ISSUE_DATE','DYE_VENDOR','FABRIC','COLOR','ROLL_COUNT','ISSUE_MTR','RECEIVED_MTR','VARIANCE_MTR','USABLE_MTR','STATUS','__ACTION'],filters:['DYE_VENDOR','FABRIC','COLOR','STATUS'],action:'New Dye Plan',fields:['ISSUE_DATE','DYE_VENDOR_ID','ROLL_ID','COLOR_ID','ISSUE_MTR','NOTES']},
production:{title:'Production / Cutting',columns:['PRODUCTION_BATCH_ID','PLAN_DATE','STYLE','COLOR','DYE_BATCH_ID','PLANNED_QTY','ALLOCATED_MTR','ACTUAL_CONSUMED_MTR','ACTUAL_CUT_QTY','CUT_BALANCE','STATUS','__ACTION'],filters:['STYLE','DYE_BATCH_ID','STATUS'],action:'New Production Batch',fields:['PLAN_DATE','DYE_BATCH_ID','STYLE_ID','PLANNED_QTY','ALLOCATED_MTR','NOTES']},
stitching:{title:'Stitching',columns:['CHALLAN_ID','ISSUE_DATE','STITCHING_VENDOR','PRODUCTION_BATCH_ID','STYLE','COLOR','ACTUAL_ISSUED','ACTUAL_RECEIVED','PENDING_QTY','RECEIPT_COUNT','STATUS','__ACTION'],filters:['STITCHING_VENDOR','PRODUCTION_BATCH_ID','STATUS'],action:'New Challan',fields:['ISSUE_DATE','STITCHING_VENDOR_ID','PRODUCTION_BATCH_ID','M_ISSUED','L_ISSUED','XL_ISSUED','2XL_ISSUED','3XL_ISSUED','OTHER_ISSUED','NOTES']},
qc:{title:'QC & Rework',columns:['QC_ID','QC_DATE','CHALLAN_ID','SIZE_NAME','STYLE','COLOR','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','FINAL_ACCEPTED_QTY','STATUS','__ACTION'],filters:['SIZE','CHALLAN_ID','STATUS'],action:'New QC Entry',fields:['QC_DATE','CHALLAN_ID','SIZE','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','DEFECT_REASON','NOTES']},
handover:{title:'Warehouse Handover',columns:['HANDOVER_ID','HANDOVER_DATE','PRODUCTION_BATCH_ID','STYLE','COLOR','SIZE_NAME','ACCEPTED_QTY','TOTAL_WAREHOUSE_RECEIVED','PENDING_QTY','STATUS','__ACTION'],filters:['STYLE','COLOR','SIZE','STATUS'],action:'New Handover',fields:['HANDOVER_DATE','PRODUCTION_BATCH_ID','STYLE_ID','COLOR_ID','SIZE','ACCEPTED_QTY','WAREHOUSE_RECEIVED_QTY','WAREHOUSE_REF','NOTES']}
};

function moduleRecordIdentity(m,r){
  const map={
    raw:['raw','ROLL_ID'],production:['production','PRODUCTION_BATCH_ID'],
    stitching:['stitching','CHALLAN_ID'],qc:['qc','QC_ID'],handover:['handover','HANDOVER_ID']
  },x=map[m];return x?{type:x[0],id:String(r?.[x[1]]||''),label:String(r?.[x[1]]||'')}:{type:m,id:'',label:''}
}
function summaryForModule(m,items){
  const groups=new Map(),add=(key,seed,r)=>{let g=groups.get(key);if(!g){g={...seed,__items:[]};groups.set(key,g)}g.__items.push(r);return g};
  if(m==='raw'){
    for(const r of items){
      const key=String(r.INWARD_ID||r.ROLL_ID),g=add(key,{INWARD_ID:key,INWARD_DATE:r.INWARD_DATE,SUPPLIER:r.SUPPLIER,FABRICS:new Set(),ROLL_COUNT:0,INWARD_MTR:0,ISSUED_MTR:0,BALANCE_MTR:0},r);
      g.FABRICS.add(String(r.FABRIC||''));g.ROLL_COUNT++;g.INWARD_MTR+=Number(r.INWARD_MTR||0);g.ISSUED_MTR+=Number(r.ISSUED_MTR||0);g.BALANCE_MTR+=Number(r.BALANCE_MTR||0)
    }
    return [...groups.values()].map(g=>({...g,FABRIC:[...g.FABRICS].filter(Boolean).join(', '),STATUS:g.ISSUED_MTR<=.0001?'AVAILABLE':g.BALANCE_MTR<=.0001?'FULLY ISSUED':'PARTIAL'}))
  }
  if(m==='production'){
    for(const r of items){
      const key=[r.DYE_BATCH_ID||'',r.STYLE_ID||r.STYLE||''].join('|'),g=add(key,{SUMMARY_ID:key,PLAN_DATE:r.PLAN_DATE,DYE_BATCH_ID:r.DYE_BATCH_ID,STYLE:r.STYLE,BATCH_COUNT:0,PLANNED_QTY:0,ALLOCATED_MTR:0,TOTAL_CUT:0},r);
      g.BATCH_COUNT++;g.PLANNED_QTY+=Number(r.PLANNED_QTY||0);g.ALLOCATED_MTR+=Number(r.ALLOCATED_MTR||0);g.TOTAL_CUT+=Number(r.ACTUAL_CUT_QTY??r.TOTAL_CUT??0)
    }
    return [...groups.values()].map(g=>({...g,STATUS:g.__items.every(x=>/complete|closed|done/i.test(String(x.STATUS||'')))?'COMPLETE':'IN PROCESS'}))
  }
  if(m==='stitching'){
    for(const r of items){
      const key=String(r.PRODUCTION_BATCH_ID||r.CHALLAN_ID),g=add(key,{PRODUCTION_BATCH_ID:key,ISSUE_DATE:r.ISSUE_DATE,VENDORS:new Set(),CHALLAN_COUNT:0,TOTAL_ISSUED:0,TOTAL_RECEIVED:0,PENDING_QTY:0},r);
      g.VENDORS.add(String(r.STITCHING_VENDOR||''));g.CHALLAN_COUNT++;g.TOTAL_ISSUED+=Number(r.ACTUAL_ISSUED??r.TOTAL_ISSUED??0);g.TOTAL_RECEIVED+=Number(r.ACTUAL_RECEIVED??r.TOTAL_RECEIVED??0);g.PENDING_QTY+=Number(r.PENDING_QTY||0)
    }
    return [...groups.values()].map(g=>({...g,STITCHING_VENDOR:[...g.VENDORS].filter(Boolean).join(', '),STATUS:g.PENDING_QTY<=.0001?'COMPLETE':'AT STITCHING'}))
  }
  if(m==='qc'){
    for(const r of items){
      const key=String(r.CHALLAN_ID||r.QC_ID),g=add(key,{CHALLAN_ID:key,QC_DATE:r.QC_DATE,QC_ENTRY_COUNT:0,QC_QTY:0,PASS_QTY:0,REWORK_QTY:0,REJECT_QTY:0,FINAL_ACCEPTED_QTY:0},r);
      g.QC_ENTRY_COUNT++;g.QC_QTY+=Number(r.QC_QTY||0);g.PASS_QTY+=Number(r.PASS_QTY||0);g.REWORK_QTY+=Number(r.REWORK_QTY||0);g.REJECT_QTY+=Number(r.REJECT_QTY||0);g.FINAL_ACCEPTED_QTY+=Number(r.FINAL_ACCEPTED_QTY||0)
    }
    return [...groups.values()].map(g=>({...g,STATUS:g.REWORK_QTY>0?'REWORK':g.REJECT_QTY>0?'QC COMPLETE WITH REJECT':'QC COMPLETE'}))
  }
  if(m==='handover'){
    for(const r of items){
      const key=String(r.PRODUCTION_BATCH_ID||r.HANDOVER_ID),g=add(key,{PRODUCTION_BATCH_ID:key,HANDOVER_DATE:r.HANDOVER_DATE,STYLES:new Set(),COLORS:new Set(),HANDOVER_COUNT:0,ACCEPTED_QTY:0,WAREHOUSE_RECEIVED_QTY:0,PENDING_QTY:0},r);
      g.STYLES.add(String(r.STYLE||''));g.COLORS.add(String(r.COLOR||''));g.HANDOVER_COUNT++;g.ACCEPTED_QTY+=Number(r.ACCEPTED_QTY||0);g.WAREHOUSE_RECEIVED_QTY+=Number(r.TOTAL_WAREHOUSE_RECEIVED??r.WAREHOUSE_RECEIVED_QTY??0);g.PENDING_QTY+=Number(r.PENDING_QTY||0)
    }
    return [...groups.values()].map(g=>({...g,STYLE:[...g.STYLES].filter(Boolean).join(', '),COLOR:[...g.COLORS].filter(Boolean).join(', '),STATUS:g.PENDING_QTY<=.0001?'COMPLETE':'PENDING'}))
  }
  return items
}
function summaryColumns(m){
  return {
    raw:['INWARD_ID','INWARD_DATE','SUPPLIER','FABRIC','ROLL_COUNT','INWARD_MTR','ISSUED_MTR','BALANCE_MTR','STATUS','__ACTION'],
    production:['PLAN_DATE','DYE_BATCH_ID','STYLE','BATCH_COUNT','PLANNED_QTY','ALLOCATED_MTR','TOTAL_CUT','STATUS','__ACTION'],
    stitching:['PRODUCTION_BATCH_ID','ISSUE_DATE','STITCHING_VENDOR','CHALLAN_COUNT','TOTAL_ISSUED','TOTAL_RECEIVED','PENDING_QTY','STATUS','__ACTION'],
    qc:['CHALLAN_ID','QC_DATE','QC_ENTRY_COUNT','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','FINAL_ACCEPTED_QTY','STATUS','__ACTION'],
    handover:['PRODUCTION_BATCH_ID','HANDOVER_DATE','STYLE','COLOR','HANDOVER_COUNT','ACCEPTED_QTY','WAREHOUSE_RECEIVED_QTY','PENDING_QTY','STATUS','__ACTION']
  }[m]||[]
}
function firstTrailIdentity(m,summary){
  const r=summary.__items?.[0]||summary;return moduleRecordIdentity(m,r)
}

function actionMenuHtml(actions,idx){
  const a=(actions||[]).filter(Boolean);
  if(!a.length)return'—';
  if(a.length===1)return `<button class="btn ghost ${a[0].cls}" data-idx="${idx}">${esc(a[0].label)}</button>`;
  return `<div class="compact-action-wrap">
    <button class="compact-action-btn" type="button" aria-label="Actions" title="Actions">⋯</button>
    <div class="compact-action-menu hidden">
      ${a.map(x=>`<button type="button" class="${x.cls}" data-idx="${idx}">${esc(x.label)}</button>`).join('')}
    </div>
  </div>`
}
function openSummaryDetails(m,summary,onTrail){
  const rows=summary.__items||[],cfg=configs[m],cols=cfg.columns.filter(x=>x!=='__ACTION');
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>${cfg.title} Details</h3><small>${rows.length} linked record${rows.length===1?'':'s'}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <div class="table-wrap"><table class="data"><thead><tr>${cols.map(k=>`<th>${gridLabel(k)}</th>`).join('')}<th>Trail</th></tr></thead>
    <tbody>${rows.map((r,i)=>`<tr>${cols.map(k=>k==='STATUS'?`<td>${badge(r[k])}</td>`:`<td>${gridCell(k,r[k])}</td>`).join('')}<td><button class="btn ghost summary-trail" data-i="${i}">Trail</button></td></tr>`).join('')}</tbody></table></div>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;
  document.querySelectorAll('.summary-trail').forEach(b=>b.onclick=()=>{const r=rows[Number(b.dataset.i)];closeModal();onTrail(moduleRecordIdentity(m,r))})
}
function trailStageColumns(key,items){
  const presets={
    raw:['ROLL_ID','INWARD_ID','INWARD_DATE','SUPPLIER','VENDOR_ROLL_NO','FABRIC','INWARD_MTR'],
    dye:['DYE_PLAN_ID','DYE_BATCH_ID','ISSUE_DATE','DYE_VENDOR','ROLL_ID','FABRIC','COLOR','ISSUE_MTR'],
    dye_receipt:['RECEIPT_ID','DYE_BATCH_ID','RECEIPT_DATE','RECEIVED_MTR','DEFECT_MTR','USABLE_MTR','VARIANCE_MTR','STATUS'],
    production:['PRODUCTION_BATCH_ID','PLAN_DATE','STYLE','COLOR','PLANNED_QTY','ALLOCATED_MTR','TOTAL_CUT','STATUS'],
    stitching:['CHALLAN_ID','ISSUE_DATE','STITCHING_VENDOR','STYLE','COLOR','TOTAL_ISSUED','TOTAL_RECEIVED','PENDING_QTY','STATUS'],
    qc:['QC_ID','QC_DATE','CHALLAN_ID','STYLE','COLOR','SIZE','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','FINAL_ACCEPTED_QTY','STATUS'],
    handover:['HANDOVER_ID','HANDOVER_DATE','PRODUCTION_BATCH_ID','STYLE','COLOR','SIZE','WAREHOUSE_RECEIVED_QTY','PENDING_QTY','STATUS']
  };
  return (presets[key]||Object.keys(items?.[0]||{}).slice(0,10)).filter(k=>items?.some(r=>r[k]!==undefined))
}
async function renderTrailView(host,identity){
  if(!identity?.id){host.innerHTML='<div class="trail-empty">Select any record from Detail View and click <b>Trail</b> to see its complete production genealogy.</div>';return}
  host.innerHTML='<div class="trail-loading">Loading complete production trail…</div>';
  try{
    const d=await api('/api/data?module=trail&type='+encodeURIComponent(identity.type)+'&id='+encodeURIComponent(identity.id),{activity:'Loading production trail…'});
    const trail=d.trail,stages=trail?.stages||[];
    host.innerHTML=`
      <div class="trail-head"><div><h3>Complete Production Trail</h3><small>Selected: ${esc(identity.label||identity.id)}</small></div><div class="trail-id-strip">${Object.entries(trail.ids||{}).filter(([,v])=>Array.isArray(v)&&v.length).map(([k,v])=>`<span>${gridLabel(k)}: ${esc(v.join(', '))}</span>`).join('')}</div></div>
      <div class="trail-flow">
        ${stages.map((stage,si)=>{
          const items=stage.items||[],cols=trailStageColumns(stage.key,items);
          return `<section class="trail-stage ${items.length?'has-data':'empty'}">
            <div class="trail-stage-title"><span class="trail-step">${si+1}</span><div><b>${esc(stage.label)}</b><small>${items.length} record${items.length===1?'':'s'}</small></div></div>
            ${items.length?`<div class="table-wrap"><table class="data trail-table"><thead><tr>${cols.map(k=>`<th>${gridLabel(k)}</th>`).join('')}</tr></thead><tbody>${items.map(r=>`<tr>${cols.map(k=>k==='STATUS'?`<td>${badge(r[k])}</td>`:`<td>${gridCell(k,r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:'<div class="trail-none">No record at this stage yet.</div>'}
          </section>`
        }).join('<div class="trail-connector">↓</div>')}
      </div>`
  }catch(e){host.innerHTML='';toast(e.message,'bad',5000)}
}
async function renderModule(m,force=false){
  const cfg=configs[m],s=$('#stage');
  if(m==='dye')return renderDyeModule(force);
  s.innerHTML=`<section class="panel">
    <div class="panel-head"><div><h3>${cfg.title}</h3><small>Summary, transaction detail and full genealogy</small></div>${canAction(m,'create')?`<button class="btn teal" id="newBtn">+ ${cfg.action}</button>`:''}</div>
    <div class="master-tabs module-view-tabs" id="moduleViewTabs">
      <button data-view="summary">Summary View</button><button data-view="detail">Detail View</button><button data-view="trail">Trail View</button>
    </div>
    <div id="gridHost">Loading…</div>
  </section>`;
  if($('#newBtn'))$('#newBtn').onclick=()=>openActionForm(m);
  try{
    const d=await getCachedModule(m,force),items=d.items||[],summaries=summaryForModule(m,items);
    let current='summary',selectedTrail=null;
    try{const pr=await api('/api/preferences?page='+encodeURIComponent(m+':view'));current=['summary','detail','trail'].includes(pr?.prefs?.view)?pr.prefs.view:'summary'}catch{}
    async function setView(view,trailIdentity=null){
      current=view;if(trailIdentity)selectedTrail=trailIdentity;
      document.querySelectorAll('#moduleViewTabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===current));
      fetch('/api/preferences',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+state.token},body:JSON.stringify({page:m+':view',prefs:{view:current}})}).catch(()=>{});
      const host=$('#gridHost');
      if(current==='trail')return renderTrailView(host,selectedTrail);
      if(current==='summary'){
        return mountDataGrid(host,{
          key:'module:'+m+':summary',title:cfg.title+' - Summary',items:summaries,columns:summaryColumns(m),filters:[],
          actionRenderer:r=>actionMenuHtml([{cls:'summary-detail-btn',label:'Details'},{cls:'summary-trail-btn',label:'Trail'}],r.__gridIndex),
          bindActions:(pageRows,h)=>{
            h.querySelectorAll('.summary-detail-btn').forEach(b=>b.onclick=()=>openSummaryDetails(m,summaries[Number(b.dataset.idx)],id=>setView('trail',id)));
            h.querySelectorAll('.summary-trail-btn').forEach(b=>b.onclick=()=>setView('trail',firstTrailIdentity(m,summaries[Number(b.dataset.idx)])))
          }
        })
      }
      return mountDataGrid(host,{
        key:'module:'+m+':detail',title:cfg.title+' - Detail',items,columns:cfg.columns,filters:cfg.filters||[],
        actionRenderer:r=>{
          const actions=[];
          if(m==='raw'&&(canAction('raw','edit')||canAction('raw','cancel')))actions.push({cls:'raw-manage-btn',label:'Manage'});
          if(['production','stitching','qc','handover'].includes(m)&&(canAction(m,'edit')||canAction(m,'cancel')||canAction(m,'create')))actions.push({cls:'txn-cancel-btn',label:'Manage'});
          if(canAction(m,'view'))actions.push({cls:'txn-trail-btn',label:'Trail'});
          return actionMenuHtml(actions,r.__gridIndex)
        },
        bindActions:(pageRows,h)=>{
          if(m==='raw')h.querySelectorAll('.raw-manage-btn').forEach(b=>b.onclick=()=>openRawManage(items[Number(b.dataset.idx)]));
          if(['production','stitching','qc','handover'].includes(m))h.querySelectorAll('.txn-cancel-btn').forEach(b=>b.onclick=()=>openTxnManage(m,items[Number(b.dataset.idx)]));
          h.querySelectorAll('.txn-trail-btn').forEach(b=>b.onclick=()=>setView('trail',moduleRecordIdentity(m,items[Number(b.dataset.idx)])))
        }
      })
    }
    document.querySelectorAll('#moduleViewTabs button').forEach(b=>b.onclick=()=>setView(b.dataset.view));
    await setView(current)
  }catch(e){toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}
}

function buildDyePlans(items){
  const map=new Map();
  for(const r of items||[]){
    const id=String(r.DYE_PLAN_ID||'UNPLANNED');
    let p=map.get(id);
    if(!p){
      p={DYE_PLAN_ID:id,ISSUE_DATE:r.ISSUE_DATE||'',vendors:new Set(),fabrics:new Set(),colors:new Set(),BATCH_COUNT:0,ISSUE_MTR:0,RECEIVED_MTR:0,PENDING_MTR:0,USABLE_MTR:0,OPEN_BATCHES:0,batches:[]};
      map.set(id,p)
    }
    if(r.DYE_VENDOR)p.vendors.add(String(r.DYE_VENDOR));
    if(r.FABRIC)p.fabrics.add(String(r.FABRIC));
    if(r.COLOR)p.colors.add(String(r.COLOR));
    p.BATCH_COUNT++;
    p.ISSUE_MTR+=Number(r.ISSUE_MTR||0);
    p.RECEIVED_MTR+=Number(r.RECEIVED_MTR||0);
    p.PENDING_MTR+=Number(r.PENDING_MTR||0);
    p.USABLE_MTR+=Number(r.USABLE_MTR||0);
    if(!isTrue(r.CLOSED))p.OPEN_BATCHES++;
    p.batches.push(r)
  }
  return [...map.values()].map(p=>{
    const complete=p.OPEN_BATCHES===0;
    const variance=complete?p.RECEIVED_MTR-p.ISSUE_MTR:null;
    let status;
    if(complete)status=variance>0.0001?'COMPLETE EXCESS':variance<-0.0001?'COMPLETE SHORT':'COMPLETE EXACT';
    else status=p.RECEIVED_MTR>0?'PARTIAL RECEIVED':'AT DYE VENDOR';
    return{
      DYE_PLAN_ID:p.DYE_PLAN_ID,ISSUE_DATE:p.ISSUE_DATE,
      DYE_VENDOR:[...p.vendors].join(', '),FABRIC:[...p.fabrics].join(', '),
      COLOR_COUNT:p.colors.size,BATCH_COUNT:p.BATCH_COUNT,OPEN_BATCHES:p.OPEN_BATCHES,
      ISSUE_MTR:p.ISSUE_MTR,RECEIVED_MTR:p.RECEIVED_MTR,PENDING_MTR:p.PENDING_MTR,
      USABLE_MTR:p.USABLE_MTR,FINAL_NET_VARIANCE_MTR:complete?variance:'',PLAN_STATUS:status,
      __batches:p.batches
    }
  }).sort((a,b)=>String(b.ISSUE_DATE).localeCompare(String(a.ISSUE_DATE))||String(b.DYE_PLAN_ID).localeCompare(String(a.DYE_PLAN_ID)))
}

async function renderDyeModule(force=false){
  const s=$('#stage');
  s.innerHTML=`<section class="panel">
    <div class="panel-head">
      <div><h3>Dyeing</h3><small>Plan-level control with color/batch drill-down</small></div>
      ${canAction('dye','create')?'<button class="btn teal" id="newBtn">+ New Dye Plan</button>':''}
    </div>
    <div class="master-tabs dye-view-tabs" id="dyeViewTabs">
      <button data-view="plan">Plan View</button>
      <button data-view="batch">Batch View</button>
      <button data-view="trail">Trail View</button>
    </div>
    <div id="gridHost">Loading…</div>
  </section>`;
  if($('#newBtn'))$('#newBtn').onclick=()=>openActionForm('dye');
  try{
    const d=await getCachedModule('dye',force),items=d.items||[];
    let view='plan',selectedTrail=null;
    try{
      const pr=await api('/api/preferences?page='+encodeURIComponent('dye:view'));
      view=['plan','batch','trail'].includes(pr?.prefs?.view)?pr.prefs.view:'plan'
    }catch{
      const lv=localStorage.getItem(prefLocalKey('dye:view'));view=['plan','batch','trail'].includes(lv)?lv:'plan'
    }
    async function setView(next,trailIdentity=null){
      view=next;if(trailIdentity)selectedTrail=trailIdentity;
      document.querySelectorAll('#dyeViewTabs button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
      try{localStorage.setItem(prefLocalKey('dye:view'),view)}catch{}
      fetch('/api/preferences',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+state.token},body:JSON.stringify({page:'dye:view',prefs:{view}})}).catch(()=>{});
      if(view==='trail')return renderTrailView($('#gridHost'),selectedTrail);
      if(view==='plan')await renderDyePlanGrid(items,id=>setView('trail',id));else await renderDyeBatchGrid(items,id=>setView('trail',id))
    }
    document.querySelectorAll('#dyeViewTabs button').forEach(b=>b.onclick=()=>setView(b.dataset.view));
    await setView(view)
  }catch(e){toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}
}

async function renderDyeBatchGrid(items,onTrail){
  await mountDataGrid($('#gridHost'),{
    key:'module:dye:batch',title:'Dyeing - Batch View',items,columns:configs.dye.columns,filters:configs.dye.filters||[],
    actionRenderer:r=>actionMenuHtml([!/^RECEIVED/.test(String(r.STATUS))?{cls:'dye-receive-btn',label:'Receive'}:null,{cls:'dye-manage-btn',label:'Manage'},{cls:'dye-trail-btn',label:'Trail'}],r.__gridIndex),
    bindActions:(pageRows,host)=>{
      host.querySelectorAll('.dye-receive-btn').forEach(b=>b.onclick=()=>openDyeReceive(items[Number(b.dataset.idx)]));
      host.querySelectorAll('.dye-manage-btn').forEach(b=>b.onclick=()=>openDyeManage(items[Number(b.dataset.idx)]));host.querySelectorAll('.dye-trail-btn').forEach(b=>b.onclick=()=>onTrail?.({type:'dye',id:String(items[Number(b.dataset.idx)]?.DYE_BATCH_ID||''),label:String(items[Number(b.dataset.idx)]?.DYE_BATCH_ID||'')}))
    }
  })
}

async function renderDyePlanGrid(batchItems,onTrail){
  const plans=buildDyePlans(batchItems);
  await mountDataGrid($('#gridHost'),{
    key:'module:dye:plan',title:'Dyeing - Plan View',items:plans,
    columns:['DYE_PLAN_ID','ISSUE_DATE','DYE_VENDOR','FABRIC','COLOR_COUNT','BATCH_COUNT','OPEN_BATCHES','ISSUE_MTR','RECEIVED_MTR','PENDING_MTR','USABLE_MTR','FINAL_NET_VARIANCE_MTR','PLAN_STATUS','__ACTION'],
    filters:['DYE_VENDOR','FABRIC','PLAN_STATUS'],
    actionRenderer:r=>actionMenuHtml([{cls:'dye-plan-detail-btn',label:'View Details'},{cls:'dye-plan-trail-btn',label:'Trail'}],r.__gridIndex),
    bindActions:(pageRows,host)=>{host.querySelectorAll('.dye-plan-detail-btn').forEach(b=>b.onclick=()=>openDyePlanDetails(plans[Number(b.dataset.idx)],onTrail));host.querySelectorAll('.dye-plan-trail-btn').forEach(b=>b.onclick=()=>{const p=plans[Number(b.dataset.idx)],first=p?.__batches?.[0];if(first)onTrail?.({type:'dye',id:String(first.DYE_BATCH_ID||''),label:String(p.DYE_PLAN_ID||'')})})}
  })
}

function openDyePlanDetails(plan,onTrail){
  const batches=plan.__batches||[],complete=Number(plan.OPEN_BATCHES||0)===0;
  $('#modalBody').innerHTML=`
    <div class="panel-head">
      <div><h3>Dye Plan ${esc(plan.DYE_PLAN_ID)}</h3><small>${esc(plan.FABRIC||'')} · ${esc(plan.DYE_VENDOR||'')}</small></div>
      <button class="btn ghost" id="closeModal">Close</button>
    </div>
    <div class="plan-summary-kpis">
      <div><span>Total Issued</span><strong>${moneyless(plan.ISSUE_MTR)} m</strong></div>
      <div><span>Total Received</span><strong>${moneyless(plan.RECEIVED_MTR)} m</strong></div>
      <div><span>Pending</span><strong>${moneyless(plan.PENDING_MTR)} m</strong></div>
      <div><span>Usable</span><strong>${moneyless(plan.USABLE_MTR)} m</strong></div>
      <div><span>Open Batches</span><strong>${esc(plan.OPEN_BATCHES)}</strong></div>
      <div><span>Final Net Variance</span><strong>${complete?moneyless(plan.FINAL_NET_VARIANCE_MTR)+' m':'Pending'}</strong></div>
    </div>
    <div class="smart-note"><b>Plan Status:</b> ${badge(plan.PLAN_STATUS)} ${complete?'All color batches are final. Net variance is now meaningful.':'Net variance will be finalized only after every color batch is closed.'}</div>
    <div class="table-wrap plan-detail-table"><table class="data">
      <thead><tr><th>Batch ID</th><th>Color</th><th>Issued Mtr</th><th>Received Mtr</th><th>Variance Mtr</th><th>Usable Mtr</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>${batches.map((r,i)=>`<tr>
        <td>${esc(r.DYE_BATCH_ID)}</td><td>${esc(r.COLOR||'')}</td><td>${moneyless(r.ISSUE_MTR)}</td><td>${moneyless(r.RECEIVED_MTR)}</td>
        <td>${moneyless(r.VARIANCE_MTR)}</td><td>${moneyless(r.USABLE_MTR)}</td><td>${badge(r.STATUS)}</td>
        <td>${actionMenuHtml([!/^RECEIVED/.test(String(r.STATUS))?{cls:'plan-receive',label:'Receive'}:null,{cls:'plan-manage',label:'Manage'},{cls:'plan-trail',label:'Trail'}],i).replaceAll('data-idx','data-i')}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  `;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;
  document.querySelectorAll('.plan-receive').forEach(b=>b.onclick=()=>{const r=batches[Number(b.dataset.i)];closeModal();openDyeReceive(r)});
  document.querySelectorAll('.plan-manage').forEach(b=>b.onclick=()=>{const r=batches[Number(b.dataset.i)];closeModal();openDyeManage(r)});document.querySelectorAll('.plan-trail').forEach(b=>b.onclick=()=>{const r=batches[Number(b.dataset.i)];closeModal();onTrail?.({type:'dye',id:String(r.DYE_BATCH_ID||''),label:String(r.DYE_BATCH_ID||'')})})
}

function closeCompactActionMenus(except=null){
  document.querySelectorAll('.compact-action-menu').forEach(m=>{if(m!==except)m.classList.add('hidden')})
}
document.addEventListener('click',e=>{
  const btn=e.target.closest('.compact-action-btn');
  if(btn){
    e.stopPropagation();
    const menu=btn.parentElement?.querySelector('.compact-action-menu');if(!menu)return;
    const opening=menu.classList.contains('hidden');closeCompactActionMenus(menu);
    menu.classList.toggle('hidden');
    if(opening){
      const r=btn.getBoundingClientRect(),w=170,gap=5;
      menu.style.position='fixed';menu.style.zIndex='10000';menu.style.width=w+'px';
      menu.style.left=Math.min(Math.max(8,r.right-w),window.innerWidth-w-8)+'px';
      requestAnimationFrame(()=>{
        const h=Math.min(menu.scrollHeight,280),below=window.innerHeight-r.bottom-gap;
        menu.style.top=(below>=h?r.bottom+gap:Math.max(8,r.top-gap-h))+'px'
      })
    }
    return
  }
  if(!e.target.closest('.compact-action-menu'))closeCompactActionMenus()
});
function badge(v){
  const s=String(v||'').trim(),x=s.toUpperCase();let cl='neutral';
  if(/CANCEL|REJECT|DEFECT|FAILED|ERROR|SHORT|NEGATIVE|BLOCK/.test(x))cl='danger';
  else if(/REWORK|HOLD|PARTIAL|PENDING|WAIT|DUE|OPEN/.test(x))cl='warn';
  else if(/FULLY ISSUED|DISABLED|INACTIVE/.test(x))cl='muted';
  else if(/AT DYE|AT STITCH|IN PROCESS|PROCESSING|ISSUED|PLANNED|ALLOCATED|CUTTING/.test(x))cl='info';
  else if(/EXCESS|EXTRA|OVER/.test(x))cl='purple';
  else if(/AVAILABLE|ACTIVE|RECEIVED EXACT|RECEIVED$|CLOSED|COMPLETE|COMPLETED|PASSED|PASS|READY|DONE|SUCCESS/.test(x))cl='ok';
  return `<span class="badge ${cl}">${esc(s)}</span>`
}
async function openActionForm(m){
  if(m==='raw')return openRawInward();
  if(m==='dye')return openDyeIssue();
  if(m==='production')return openProductionPlan();
  if(m==='stitching')return openStitchingIssue();
  if(m==='qc')return openQcEntry();
  if(m==='handover')return openWarehouseHandover();
  return openForm(m);
}
function openForm(m){const c=configs[m],requestId=newRequestId();$('#modalBody').innerHTML=`<div class="panel-head"><h3>${c.action}</h3><button class="btn ghost" id="closeModal">Close</button></div><form id="recordForm"><div class="form-grid">${c.fields.map(f=>`<div class="field ${f==='NOTES'?'wide':''}"><label>${f.replaceAll('_',' ')}</label><input name="${f}" ${/DATE/.test(f)?'type="date"':''}></div>`).join('')}</div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save</button></div></form>`;$('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;$('#recordForm').onsubmit=async e=>{e.preventDefault();const rec=Object.fromEntries(new FormData(e.target).entries());try{await api('/api/data',{method:'POST',activity:'Saving '+c.action+'…',success:c.action+' saved',body:JSON.stringify({module:m,record:rec,requestId})});dropCaches();closeModal();go(m,true)}catch(err){toast(err.message,'bad',3500)}}}
function closeModal(){$('#modal').classList.add('hidden')}

let lookupCache=null;
async function getLookups(force=false){if(lookupCache&&!force)return lookupCache;const d=await getCachedModule('lookups',force);lookupCache=d.lookups||{};return lookupCache}
function opts(items,idKey,labelKey,filterFn){return (items||[]).filter(filterFn||(()=>true)).map(x=>`<option value="${esc(x[idKey])}">${esc(x[labelKey]||x[idKey])}</option>`).join('')}
function isTrue(v){return v===true||String(v).toLowerCase()==='true'||v===1}
function todayLocal(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function moneyless(n){const x=Number(n||0);return Number.isFinite(x)?x.toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2}):'0'}
function displayCell(k,v){
  if(v===null||v===undefined)return'';
  const key=String(k);
  if(/(?:TIMESTAMP|CREATED_AT|UPDATED_AT|LAST_LOGIN)/i.test(key))return esc(fmtDate(v,true));
  if(/(?:DATE)$/i.test(key))return esc(fmtDate(v,false));
  if(/(?:MTR|METER|VARIANCE)/i.test(key)&&v!==''&&!Number.isNaN(Number(v)))return moneyless(v);
  if(isQtyKey(key)&&v!==''&&!Number.isNaN(Number(v)))return Number(v).toLocaleString('en-IN',{maximumFractionDigits:0});
  return esc(v)
}

function safeFileName(s){return String(s||'report').replace(/[^a-z0-9-_]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'report'}
function exportStamp(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function currentPageLabel(){return NAV.find(x=>x[0]===state.current)?.[2]||$('#pageTitle')?.textContent||'Report'}
function htmlText(el){return String(el?.textContent||'').replace(/\s+/g,' ').trim()}
function getVisibleExportData(){
  const rt=state.grids[state.activeGridKey];
  if(rt&&rt.filtered){
    const title=rt.opt.title||currentPageLabel(),cols=(rt.prefs.columnOrder||rt.prefs.visibleColumns||rt.opt.columns||[]).filter(k=>k!=='__ACTION'&&(rt.prefs.visibleColumns||[]).includes(k));
    let source=rt.filtered||[];
    if(rt.prefs.exportScope==='page')source=rt.pageRows||[];
    if(rt.prefs.exportScope==='selected')source=(rt.items||[]).filter(r=>rt.selected?.has(r.__gridIndex));
    if(rt.prefs.exportScope==='selected'&&!source.length)throw new Error('Select at least one row before exporting selected records.');
    return{title,headers:cols.map(gridLabel),rows:source.map(r=>cols.map(k=>{const v=gridCell(k,r[k]);return String(v?.replace?v.replace(/<[^>]+>/g,''):v)}))};
  }
  const title=currentPageLabel();
  const kpis=[...document.querySelectorAll('#stage .kpi')].filter(x=>x.offsetParent!==null).map(x=>[htmlText(x.querySelector('span')),htmlText(x.querySelector('strong'))]).filter(x=>x[0]);
  if(kpis.length)return{title,headers:['Metric','Value'],rows:kpis};
  const tables=[...document.querySelectorAll('#stage table.data')].filter(t=>t.offsetParent!==null);
  if(tables.length){
    const table=tables[0],headers=[...table.querySelectorAll('thead th')].map(th=>htmlText(th));
    const keep=headers.map((h,i)=>({h,i})).filter(x=>!/^(ACTION|__ACTION)$/i.test(x.h));
    const rows=[...table.querySelectorAll('tbody tr')].filter(tr=>tr.offsetParent!==null).map(tr=>{const cells=[...tr.querySelectorAll('td')];if(!cells.length)return null;return keep.map(x=>htmlText(cells[x.i]))}).filter(Boolean);
    return{title,headers:keep.map(x=>x.h),rows};
  }
  return{title,headers:['Message'],rows:[['No exportable data on this page.']]};
}
function loadScriptOnce(src,test){
  if(test())return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const existing=[...document.scripts].find(s=>s.src===src);
    if(existing){existing.addEventListener('load',resolve,{once:true});existing.addEventListener('error',reject,{once:true});return}
    const s=document.createElement('script');s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>reject(new Error('Export library failed to load.'));document.head.appendChild(s)
  })
}
async function ensureExcelLib(){
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',()=>!!window.XLSX);
}
async function ensurePdfLib(){
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',()=>!!window.jspdf?.jsPDF);
  await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js',()=>!!window.jspdf?.jsPDF?.API?.autoTable);
}
async function exportExcel(){
  const btn=$('#exportExcelBtn'),data=getVisibleExportData(),slow=activityStart('Preparing Excel export…',btn);
  try{
    await ensureExcelLib();
    const aoa=[[data.title],['Generated',new Date().toLocaleString()],[],data.headers,...data.rows];
    const ws=XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols']=data.headers.map((h,i)=>({wch:Math.min(40,Math.max(String(h).length+3,...data.rows.map(r=>String(r[i]??'').length+2)))}));
    const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Report');
    XLSX.writeFile(wb,'rrr-'+safeFileName(data.title)+'-'+exportStamp()+'.xlsx');
    activityEnd(slow,btn,true,'Excel exported');
  }catch(e){activityEnd(slow,btn,false,e.message||'Excel export failed')}
}
async function exportPdf(){
  const btn=$('#exportPdfBtn'),data=getVisibleExportData(),slow=activityStart('Preparing PDF export…',btn);
  try{
    await ensurePdfLib();
    const {jsPDF}=window.jspdf;
    const landscape=data.headers.length>6;
    const doc=new jsPDF({orientation:landscape?'landscape':'portrait',unit:'pt',format:'a4'});
    const pageWidth=doc.internal.pageSize.getWidth();
    doc.setFontSize(14);doc.text('RRR Production ERP',40,36);
    doc.setFontSize(11);doc.text(data.title,40,54);
    doc.setFontSize(8);doc.text('Generated: '+new Date().toLocaleString(),40,68);
    doc.autoTable({
      head:[data.headers],body:data.rows,startY:82,theme:'grid',
      styles:{fontSize:7,cellPadding:3,overflow:'linebreak'},
      headStyles:{fontStyle:'bold'},
      margin:{left:32,right:32},
      tableWidth:'auto',
      didDrawPage:hook=>{const n=doc.internal.getNumberOfPages();doc.setFontSize(7);doc.text('Page '+n,pageWidth-62,doc.internal.pageSize.getHeight()-18)}
    });
    doc.save('rrr-'+safeFileName(data.title)+'-'+exportStamp()+'.pdf');
    activityEnd(slow,btn,true,'PDF exported');
  }catch(e){activityEnd(slow,btn,false,e.message||'PDF export failed')}
}

function vendorOptions(vendors,role){return (vendors||[]).filter(v=>isTrue(v.ACTIVE)&&(!role||isTrue(v[role]))).map(v=>`<option value="${esc(v.VENDOR_ID)}">${esc(v.VENDOR_NAME)}${role?'':''}</option>`).join('')}
function colorOptions(colors){return (colors||[]).filter(x=>isTrue(x.ACTIVE)).map(x=>`<option value="${esc(x.COLOR_ID)}">${esc(x.COLOR_NAME)}${x.COLOR_CODE?' · '+esc(x.COLOR_CODE):''}</option>`).join('')}
function styleOptions(styles){return (styles||[]).filter(x=>isTrue(x.ACTIVE)).map(x=>`<option value="${esc(x.STYLE_ID)}">${esc(x.STYLE_NAME)}${x.STYLE_CODE?' · '+esc(x.STYLE_CODE):''}</option>`).join('')}
function smartEmpty(msg){return `<div class="smart-empty"><b>Nothing available</b><span>${esc(msg)}</span></div>`}
function deriveRawFabricGroups(rawRolls=[]){
  const m={};
  (rawRolls||[]).filter(r=>Number(r.BALANCE_MTR)>0).forEach(r=>{
    const k=String(r.FABRIC_ID||'');if(!k)return;
    const x=m[k]||(m[k]={FABRIC_ID:k,FABRIC_NAME:r.FABRIC_NAME||r.FABRIC||k,AVAILABLE_MTR:0,ROLL_COUNT:0});
    x.AVAILABLE_MTR+=Number(r.BALANCE_MTR||0);x.ROLL_COUNT++;
  });
  return Object.values(m).sort((x,y)=>String(x.FABRIC_NAME).localeCompare(String(y.FABRIC_NAME)));
}




async function openRawManage(row){
  let l;try{l=await getLookups(false)}catch(e){return toast(e.message,'bad',3500)}
  const issued=Number(row.ISSUED_MTR||0),locked=issued>0.0001;
  const suppliers=(l.vendors||[]).filter(v=>isTrue(v.ACTIVE)&&isTrue(v.FABRIC_SUPPLIER));
  const fabrics=(l.fabrics||[]).filter(x=>isTrue(x.ACTIVE));
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Manage Raw Fabric</h3><small>${esc(row.ROLL_ID)} · ${locked?'partially locked because dye issue exists':'fully editable'}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="rawManageForm"><div class="form-grid">
      <div class="field"><label>Inward Date</label><input name="INWARD_DATE" type="date" value="${esc(String(row.INWARD_DATE||'').slice(0,10))}"></div>
      <div class="field"><label>Supplier</label><select name="SUPPLIER_ID">${suppliers.map(v=>`<option value="${esc(v.VENDOR_ID)}" ${String(v.VENDOR_ID)===String(row.SUPPLIER_ID)?'selected':''}>${esc(v.VENDOR_NAME)}</option>`).join('')}</select></div>
      <div class="field"><label>Vendor Roll No</label><input name="VENDOR_ROLL_NO" value="${esc(row.VENDOR_ROLL_NO||'')}"></div>
      <div class="field"><label>Fabric</label><select name="FABRIC_ID" ${locked?'disabled':''}>${fabrics.map(x=>`<option value="${esc(x.FABRIC_ID)}" ${String(x.FABRIC_ID)===String(row.FABRIC_ID)?'selected':''}>${esc(x.FABRIC_NAME)}</option>`).join('')}</select></div>
      <div class="field"><label>Inward Meter</label><input name="INWARD_MTR" type="number" step="0.01" min="${issued||0.01}" value="${esc(row.INWARD_MTR)}"></div>
      <div class="field"><label>Already Issued</label><input value="${moneyless(issued)} m" disabled></div>
      <div class="field"><label>Balance</label><input value="${moneyless(row.BALANCE_MTR)} m" disabled></div>
      <div class="field"><label>Invoice / Challan</label><input name="INVOICE_CHALLAN" value="${esc(row.INVOICE_CHALLAN||'')}"></div>
      <div class="field"><label>Lot Ref</label><input name="LOT_REF" value="${esc(row.LOT_REF||'')}"></div>
      <div class="field wide"><label>Notes</label><input name="NOTES" value="${esc(row.NOTES||'')}"></div>
    </div>
    ${locked?'<div class="smart-note"><b>Dependency lock:</b> Fabric type and cancellation are blocked because some quantity is already issued to dye. Inward meter can still be corrected, but not below issued meter.</div>':''}
    <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Save Correction</button></div></form>
    ${!locked?'<div class="danger-zone"><div><b>Cancel mistaken inward</b><small>Removes this roll from usable stock while preserving audit history.</small></div><button class="btn danger" id="cancelRawBtn">Cancel Inward</button></div>':''}
  `;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#rawManageForm').onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(e.target);
    const rec={ROLL_ID:row.ROLL_ID,INWARD_DATE:fd.get('INWARD_DATE'),SUPPLIER_ID:fd.get('SUPPLIER_ID'),VENDOR_ROLL_NO:fd.get('VENDOR_ROLL_NO'),FABRIC_ID:locked?row.FABRIC_ID:fd.get('FABRIC_ID'),INWARD_MTR:fd.get('INWARD_MTR'),INVOICE_CHALLAN:fd.get('INVOICE_CHALLAN'),LOT_REF:fd.get('LOT_REF'),NOTES:fd.get('NOTES')};
    try{await api('/api/data',{method:'POST',activity:'Saving raw fabric correction…',success:'Raw fabric corrected',body:JSON.stringify({module:'raw_edit',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('raw',true)}catch(err){toast(err.message,'bad',5000)}
  };
  $('#cancelRawBtn')?.addEventListener('click',async()=>{
    if(!confirm('Cancel this raw inward roll?'))return;const reason=prompt('Reason for cancellation:','Mistaken entry')||'Mistaken entry';
    try{await api('/api/data',{method:'POST',activity:'Cancelling raw inward…',success:'Raw inward cancelled',body:JSON.stringify({module:'raw_cancel',record:{ROLL_ID:row.ROLL_ID,REASON:reason},requestId:newRequestId()})});dropCaches();closeModal();go('raw',true)}catch(err){toast(err.message,'bad',5000)}
  });
}
async function openTxnManage(module,row){
  if(module==='production')return openProductionManage(row);
  if(module==='stitching')return openStitchingManage(row);
  if(module==='qc')return openQcManage(row);
  if(module==='handover')return openHandoverManage(row)
}


function sizeLineFields(sizes,values={},cls='size-qty',maxMap={}){
  return (sizes||[]).map(s=>{
    const val=Number(values[s.SIZE_ID]??0),mx=maxMap[s.SIZE_ID];
    return `<div class="field size-field"><label>${esc(s.SIZE_NAME)}${mx!==undefined?' · '+Number(mx).toLocaleString('en-IN')+' available':''}</label><input class="${cls}" data-size-id="${esc(s.SIZE_ID)}" type="number" min="0" step="1" ${mx!==undefined?`max="${mx}"`:''} value="${val}"></div>`
  }).join('')
}
function collectSizeLines(root,selector='.size-qty'){
  return [...root.querySelectorAll(selector)].map(x=>({SIZE_ID:x.dataset.sizeId,QTY:Number(x.value||0)})).filter(x=>x.QTY>0)
}
async function cancelRecord(module,record,label,goModule){
  const reason=prompt('Reason for cancelling '+label+':','Mistaken entry');if(reason===null)return;
  try{
    await api('/api/data',{method:'POST',activity:'Cancelling '+label+'…',success:label+' cancelled',body:JSON.stringify({module,record:{...record,REASON:reason||'Mistaken entry'},requestId:newRequestId()})});
    dropCaches();closeModal();go(goModule,true)
  }catch(e){toast(e.message,'bad',5000)}
}
async function fetchDetail(module,id){
  const d=await api('/api/data?module='+encodeURIComponent(module+'_detail')+'&id='+encodeURIComponent(id),{activity:'Loading details…'});return d.detail
}
async function openProductionManage(row){
  const id=String(row.PRODUCTION_BATCH_ID||'');let d;
  try{d=await fetchDetail('production',id)}catch(e){return toast(e.message,'bad',4500)}
  const cut=d.cut,lines=d.cutLines||[];
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Manage Production</h3><small>${esc(id)} · ${esc(d.STYLE||'')} · ${esc(d.COLOR||'')}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <div class="manage-kpis">
      <div><span>Allocated</span><b>${moneyless(d.ALLOCATED_MTR)} m</b></div>
      <div><span>Consumed</span><b>${moneyless(cut?.CONSUMED_MTR||0)} m</b></div>
      <div><span>Cut Pieces</span><b>${lines.reduce((s,x)=>s+Number(x.QTY||0),0)}</b></div>
      <div><span>Downstream Challans</span><b>${Number(d.downstreamCount||0)}</b></div>
    </div>
    <div class="manage-actions">
      ${canAction('production','edit')?'<button class="btn ghost" id="editProd">Edit Plan</button>':''}
      ${canAction('production','edit')?'<button class="btn teal" id="cutProd">'+(cut?'Edit Cutting':'Complete Cutting')+'</button>':''}
      ${canAction('production','cancel')?'<button class="btn danger" id="cancelProd">Cancel Batch</button>':''}
    </div>
    ${lines.length?`<div class="subsection"><h4>Size-wise Cut</h4><div class="mini-pills">${lines.map(x=>`<span>${esc(x.SIZE_NAME||x.SIZE_ID)} <b>${x.QTY}</b></span>`).join('')}</div></div>`:''}
    ${d.downstreamCount?'<div class="smart-note"><b>Dependency lock:</b> Production plan/cutting changes that affect issued stock may be blocked until downstream stitching is reversed.</div>':''}
  `;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;
  $('#editProd')?.addEventListener('click',()=>{closeModal();openProductionEdit(d)});
  $('#cutProd')?.addEventListener('click',()=>{closeModal();openCuttingActual(d)});
  $('#cancelProd')?.addEventListener('click',()=>cancelRecord('production_cancel',{PRODUCTION_BATCH_ID:id},'production batch','production'))
}
async function openProductionEdit(d){
  let l;try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const batches=l.dyeBatches||[],styles=l.styles||[],id=d.PRODUCTION_BATCH_ID;
  const allBatch=[...batches];if(!allBatch.some(x=>String(x.DYE_BATCH_ID)===String(d.DYE_BATCH_ID)))allBatch.unshift({DYE_BATCH_ID:d.DYE_BATCH_ID,FABRIC_NAME:d.FABRIC_ID,COLOR_NAME:d.COLOR||d.COLOR_ID,BALANCE_MTR:d.ALLOCATED_MTR});
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Edit Production Plan</h3><small>${esc(id)}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="prodEditForm"><div class="form-grid">
      <div class="field"><label>Plan Date</label><input name="PLAN_DATE" type="date" value="${esc(String(d.PLAN_DATE||'').slice(0,10))}" required></div>
      <div class="field"><label>Dyed Batch</label><select name="DYE_BATCH_ID" required>${allBatch.map(x=>`<option value="${esc(x.DYE_BATCH_ID)}" ${String(x.DYE_BATCH_ID)===String(d.DYE_BATCH_ID)?'selected':''}>${esc(x.DYE_BATCH_ID)} · ${esc(x.FABRIC_NAME||'')} · ${esc(x.COLOR_NAME||'')}</option>`).join('')}</select></div>
      <div class="field"><label>Style</label><select name="STYLE_ID" required>${styles.map(x=>`<option value="${esc(x.STYLE_ID)}" ${String(x.STYLE_ID)===String(d.STYLE_ID)?'selected':''}>${esc(x.STYLE_NAME)}</option>`).join('')}</select></div>
      <div class="field"><label>Planned Qty</label><input name="PLANNED_QTY" type="number" min="0" step="1" value="${Number(d.PLANNED_QTY||0)}"></div>
      <div class="field"><label>Allocated Meter</label><input name="ALLOCATED_MTR" type="number" min="0.01" step="0.01" value="${Number(d.ALLOCATED_MTR||0)}" required></div>
      <div class="field wide"><label>Notes</label><input name="NOTES" value="${esc(d.NOTES||'')}"></div>
    </div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Save Correction</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#prodEditForm').onsubmit=async e=>{e.preventDefault();const rec={...Object.fromEntries(new FormData(e.target).entries()),PRODUCTION_BATCH_ID:id};try{await api('/api/data',{method:'POST',activity:'Updating production plan…',success:'Production plan updated',body:JSON.stringify({module:'production_edit',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('production',true)}catch(err){toast(err.message,'bad',5000)}}
}
async function openCuttingActual(d){
  let l;try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const sizes=(l.sizes||[]).filter(x=>isTrue(x.ACTIVE)),old=Object.fromEntries((d.cutLines||[]).map(x=>[x.SIZE_ID,Number(x.QTY||0)])),cut=d.cut||{};
  if(!sizes.length)return toast('Create active sizes in Masters → Sizes first.','bad',4000);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>${d.cut?'Edit':'Complete'} Cutting</h3><small>${esc(d.PRODUCTION_BATCH_ID)} · allocated ${moneyless(d.ALLOCATED_MTR)} m</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="cutForm"><div class="form-grid">
      <div class="field"><label>Cut Date</label><input name="CUT_DATE" type="date" required value="${esc(String(cut.CUT_DATE||todayLocal()).slice(0,10))}"></div>
      <div class="field"><label>Allocated Meter</label><input value="${moneyless(d.ALLOCATED_MTR)} m" disabled></div>
      <div class="field"><label>Consumed Meter</label><input class="meter-recon" name="CONSUMED_MTR" type="number" min="0" step="0.01" value="${Number(cut.CONSUMED_MTR||0)}"></div>
      <div class="field"><label>Cutting Waste Meter</label><input class="meter-recon" name="WASTE_MTR" type="number" min="0" step="0.01" value="${Number(cut.WASTE_MTR||0)}"></div>
      <div class="field"><label>Defect/Hold Meter</label><input class="meter-recon" name="DEFECT_MTR" type="number" min="0" step="0.01" value="${Number(cut.DEFECT_MTR||0)}"></div>
      <div class="field"><label>Unused Return Meter</label><input class="meter-recon" name="UNUSED_RETURN_MTR" type="number" min="0" step="0.01" value="${Number(cut.UNUSED_RETURN_MTR||0)}"></div>
      <div class="field wide"><label>Notes</label><input name="NOTES" value="${esc(cut.NOTES||'')}"></div>
    </div>
    <div class="recon-strip"><span>Accounted <b id="accountedMtr">0.00 m</b></span><span>Difference <b id="reconDiff">0.00 m</b></span></div>
    <div class="subsection"><h4>Size-wise Cut Pieces</h4><div class="dynamic-size-grid">${sizeLineFields(sizes,old)}</div><div class="size-total">Total Cut <b id="cutPieceTotal">0</b> pcs</div></div>
    <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Save Cutting</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  const form=$('#cutForm'),allocated=Number(d.ALLOCATED_MTR||0);
  function calc(){const accounted=[...form.querySelectorAll('.meter-recon')].reduce((s,x)=>s+(Number(x.value)||0),0),diff=allocated-accounted,total=[...form.querySelectorAll('.size-qty')].reduce((s,x)=>s+(Number(x.value)||0),0);$('#accountedMtr').textContent=moneyless(accounted)+' m';$('#reconDiff').textContent=(diff>=0?'+':'')+moneyless(diff)+' m';$('#reconDiff').classList.toggle('bad',Math.abs(diff)>.011);$('#cutPieceTotal').textContent=total}
  form.addEventListener('input',calc);calc();
  form.onsubmit=async e=>{e.preventDefault();const rec={...Object.fromEntries(new FormData(form).entries()),PRODUCTION_BATCH_ID:d.PRODUCTION_BATCH_ID,items:collectSizeLines(form)};try{await api('/api/data',{method:'POST',activity:'Saving cutting actual…',success:'Cutting saved',body:JSON.stringify({module:'cutting_complete',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('production',true)}catch(err){toast(err.message,'bad',5000)}}
}
async function openStitchingManage(row){
  const id=String(row.CHALLAN_ID||'');let d;
  try{d=await fetchDetail('stitching',id)}catch(e){return toast(e.message,'bad',4500)}
  const pending=(d.pendingLines||[]).reduce((s,x)=>s+Number(x.PENDING_QTY||0),0);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Manage Stitching</h3><small>${esc(id)} · ${esc(d.STITCHING_VENDOR||'')}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <div class="manage-kpis"><div><span>Issued</span><b>${(d.issueLines||[]).reduce((s,x)=>s+x.QTY,0)}</b></div><div><span>Received</span><b>${(d.receivedLines||[]).reduce((s,x)=>s+x.QTY,0)}</b></div><div><span>Pending Vendor</span><b>${pending}</b></div><div><span>Receipts</span><b>${(d.receipts||[]).length}</b></div></div>
    <div class="manage-actions">
      ${canAction('stitching','edit')?'<button class="btn ghost" id="editStitch">Edit Issue</button>':''}
      ${pending>0&&canAction('stitching','create')?'<button class="btn teal" id="receiveStitch">Receive Garments</button>':''}
      ${canAction('stitching','cancel')?'<button class="btn danger" id="cancelStitch">Cancel Challan</button>':''}
    </div>
    <div class="subsection"><h4>Size Balance</h4><div class="mini-pills">${(d.pendingLines||[]).map(x=>`<span>${esc(x.SIZE_NAME)} · Issued <b>${x.QTY}</b> · Rec. <b>${x.RECEIVED_QTY}</b> · Pending <b>${x.PENDING_QTY}</b></span>`).join('')||'—'}</div></div>
    ${(d.receipts||[]).length?`<div class="subsection"><h4>Receipt History</h4><div class="history-list">${d.receipts.map(x=>`<div><b>${esc(x.RECEIPT_ID)}</b><span>${fmtDate(x.RECEIPT_DATE)}</span>${d.qcCount===0&&canAction('stitching','cancel')?`<button class="link-danger cancel-stitch-receipt" data-id="${esc(x.RECEIPT_ID)}">Cancel</button>`:''}</div>`).join('')}</div></div>`:''}
  `;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;
  $('#editStitch')?.addEventListener('click',()=>{closeModal();openStitchingEdit(d)});
  $('#receiveStitch')?.addEventListener('click',()=>{closeModal();openStitchingReceipt(d)});
  $('#cancelStitch')?.addEventListener('click',()=>cancelRecord('stitching_cancel',{CHALLAN_ID:id},'stitching challan','stitching'));
  document.querySelectorAll('.cancel-stitch-receipt').forEach(b=>b.onclick=()=>cancelRecord('stitching_receipt_cancel',{RECEIPT_ID:b.dataset.id},'stitching receipt','stitching'))
}
async function openStitchingEdit(d){
  let l;try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const vendors=(l.vendors||[]).filter(v=>isTrue(v.ACTIVE)&&isTrue(v.STITCHING_VENDOR)),sizes=(l.sizes||[]).filter(x=>isTrue(x.ACTIVE));
  const vals=Object.fromEntries((d.issueLines||[]).map(x=>[x.SIZE_ID,x.QTY])),mx=Object.fromEntries((d.sizeBalances||[]).map(x=>[x.SIZE_ID,Number(x.BALANCE_QTY||0)+(vals[x.SIZE_ID]||0)]));
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Edit Stitching Issue</h3><small>${esc(d.CHALLAN_ID)}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="stitchEditForm"><div class="form-grid">
      <div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" value="${esc(String(d.ISSUE_DATE||'').slice(0,10))}" required></div>
      <div class="field"><label>Vendor</label><select name="STITCHING_VENDOR_ID" required>${vendors.map(v=>`<option value="${esc(v.VENDOR_ID)}" ${String(v.VENDOR_ID)===String(d.STITCHING_VENDOR_ID)?'selected':''}>${esc(v.VENDOR_NAME)}</option>`).join('')}</select></div>
      <div class="field wide"><label>Notes</label><input name="NOTES" value="${esc(d.NOTES||'')}"></div>
    </div><div class="subsection"><h4>Size-wise Issue</h4><div class="dynamic-size-grid">${sizeLineFields(sizes,vals,'size-qty',mx)}</div></div>
    <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Save Correction</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#stitchEditForm').onsubmit=async e=>{e.preventDefault();const rec={...Object.fromEntries(new FormData(e.target).entries()),CHALLAN_ID:d.CHALLAN_ID,items:collectSizeLines(e.target)};try{await api('/api/data',{method:'POST',activity:'Updating stitching issue…',success:'Stitching issue updated',body:JSON.stringify({module:'stitching_edit',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('stitching',true)}catch(err){toast(err.message,'bad',5000)}}
}
async function openStitchingReceipt(d){
  const pending=(d.pendingLines||[]).filter(x=>Number(x.PENDING_QTY)>0);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Receive from Stitching</h3><small>${esc(d.CHALLAN_ID)} · partial receipts allowed</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="stitchReceiptForm"><div class="form-grid"><div class="field"><label>Receipt Date</label><input name="RECEIPT_DATE" type="date" required value="${todayLocal()}"></div><div class="field wide"><label>Notes</label><input name="NOTES"></div></div>
    <div class="subsection"><h4>Size-wise Receipt</h4><div class="dynamic-size-grid">${pending.map(x=>`<div class="field"><label>${esc(x.SIZE_NAME)} · ${x.PENDING_QTY} pending</label><input class="receipt-size" data-size-id="${esc(x.SIZE_ID)}" type="number" min="0" max="${x.PENDING_QTY}" step="1" value="0"></div>`).join('')}</div></div>
    <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Save Receipt</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#stitchReceiptForm').onsubmit=async e=>{e.preventDefault();const rec={...Object.fromEntries(new FormData(e.target).entries()),CHALLAN_ID:d.CHALLAN_ID,items:collectSizeLines(e.target,'.receipt-size')};try{await api('/api/data',{method:'POST',activity:'Saving stitching receipt…',success:'Garments received',body:JSON.stringify({module:'stitching_receive',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('stitching',true)}catch(err){toast(err.message,'bad',5000)}}
}
async function openQcManage(row){
  const id=String(row.QC_ID||'');let d,l;
  try{[d,l]=await Promise.all([fetchDetail('qc',id),getLookups(false)])}catch(e){return toast(e.message,'bad',4500)}
  const issued=(d.reworks||[]).reduce((s,x)=>s+Number(x.ISSUE_QTY||0),0),reworkAvail=Math.max(0,Number(d.REWORK_QTY||0)-issued);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Manage QC</h3><small>${esc(id)} · ${esc(d.SIZE_NAME||d.SIZE||'')}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <div class="manage-kpis"><div><span>QC Qty</span><b>${d.QC_QTY}</b></div><div><span>Pass</span><b>${d.PASS_QTY}</b></div><div><span>Rework</span><b>${d.REWORK_QTY}</b></div><div><span>Reject</span><b>${d.REJECT_QTY}</b></div></div>
    <div class="manage-actions">
      ${canAction('qc','edit')?'<button class="btn ghost" id="editQc">Edit QC</button>':''}
      ${reworkAvail>0&&canAction('qc','create')?'<button class="btn teal" id="issueRework">Send Rework</button>':''}
      ${canAction('qc','cancel')?'<button class="btn danger" id="cancelQc">Cancel QC</button>':''}
    </div>
    ${(d.reworks||[]).length?`<div class="subsection"><h4>Rework Jobs</h4><div class="history-list">${d.reworks.map(x=>{const p=Math.max(0,Number(x.ISSUE_QTY)-Number(x.RETURNED_QTY));return`<div><b>${esc(x.REWORK_ID)}</b><span>${esc(x.STATUS)} · ${p} pending</span>${p>0&&canAction('qc','edit')?`<button class="link-action receive-rework" data-id="${esc(x.REWORK_ID)}" data-pending="${p}">Receive</button>`:''}${Number(x.RETURNED_QTY||0)===0&&canAction('qc','cancel')?`<button class="link-danger cancel-rework" data-id="${esc(x.REWORK_ID)}">Cancel</button>`:''}</div>`}).join('')}</div></div>`:''}
  `;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;
  $('#editQc')?.addEventListener('click',()=>{closeModal();openQcEdit(d,l)});
  $('#issueRework')?.addEventListener('click',()=>{closeModal();openReworkIssue(d,l,reworkAvail)});
  $('#cancelQc')?.addEventListener('click',()=>cancelRecord('qc_cancel',{QC_ID:id},'QC entry','qc'));
  document.querySelectorAll('.receive-rework').forEach(b=>b.onclick=()=>{closeModal();openReworkReceive({REWORK_ID:b.dataset.id,PENDING:Number(b.dataset.pending)},l)});
  document.querySelectorAll('.cancel-rework').forEach(b=>b.onclick=()=>cancelRecord('rework_cancel',{REWORK_ID:b.dataset.id},'rework job','qc'))
}
function openQcEdit(d,l){
  const defects=l.defects||[];
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Edit QC</h3><small>${esc(d.QC_ID)}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="qcEditForm"><div class="form-grid">
      <div class="field"><label>QC Date</label><input name="QC_DATE" type="date" value="${esc(String(d.QC_DATE||'').slice(0,10))}" required></div>
      <div class="field"><label>QC Qty</label><input name="QC_QTY" type="number" min="1" step="1" value="${d.QC_QTY}" required></div>
      <div class="field"><label>Pass</label><input name="PASS_QTY" type="number" min="0" step="1" value="${d.PASS_QTY}"></div>
      <div class="field"><label>Rework</label><input name="REWORK_QTY" type="number" min="0" step="1" value="${d.REWORK_QTY}"></div>
      <div class="field"><label>Reject</label><input name="REJECT_QTY" type="number" min="0" step="1" value="${d.REJECT_QTY}"></div>
      <div class="field"><label>Defect Reason</label><select name="DEFECT_REASON"><option value="">Select</option>${defects.map(x=>`<option value="${esc(x.DEFECT_NAME)}" ${String(x.DEFECT_NAME)===String(d.DEFECT_REASON||'')?'selected':''}>${esc(x.DEFECT_NAME)}</option>`).join('')}</select></div>
      <div class="field wide"><label>Notes</label><input name="NOTES" value="${esc(d.NOTES||'')}"></div>
    </div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Save Correction</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#qcEditForm').onsubmit=async e=>{e.preventDefault();const rec={...Object.fromEntries(new FormData(e.target).entries()),QC_ID:d.QC_ID,SIZE:d.SIZE};try{await api('/api/data',{method:'POST',activity:'Updating QC…',success:'QC updated',body:JSON.stringify({module:'qc_edit',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('qc',true)}catch(err){toast(err.message,'bad',5000)}}
}
function openReworkIssue(d,l,available){
  const vendors=(l.vendors||[]).filter(v=>isTrue(v.ACTIVE)&&(isTrue(v.STITCHING_VENDOR)||isTrue(v.CUTTING_VENDOR)));
  $('#modalBody').innerHTML=`<div class="panel-head"><div><h3>Send for Rework</h3><small>${available} pcs available from QC ${esc(d.QC_ID)}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="rwIssueForm"><div class="form-grid"><div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" value="${todayLocal()}" required></div><div class="field"><label>Vendor</label><select name="VENDOR_ID" required>${vendors.map(v=>`<option value="${esc(v.VENDOR_ID)}" ${String(v.VENDOR_ID)===String(d.VENDOR_ID)?'selected':''}>${esc(v.VENDOR_NAME)}</option>`).join('')}</select></div><div class="field"><label>Qty</label><input name="ISSUE_QTY" type="number" min="1" max="${available}" step="1" value="${available}" required></div><div class="field wide"><label>Notes</label><input name="NOTES"></div></div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Create Rework</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#rwIssueForm').onsubmit=async e=>{e.preventDefault();const rec={...Object.fromEntries(new FormData(e.target).entries()),QC_ID:d.QC_ID};try{await api('/api/data',{method:'POST',activity:'Issuing rework…',success:'Rework issued',body:JSON.stringify({module:'rework_issue',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('qc',true)}catch(err){toast(err.message,'bad',5000)}}
}
function openReworkReceive(rw,l){
  const defects=l.defects||[];
  $('#modalBody').innerHTML=`<div class="panel-head"><div><h3>Receive Rework</h3><small>${esc(rw.REWORK_ID)} · ${rw.PENDING} pending</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="rwReceiveForm"><div class="form-grid"><div class="field"><label>Receipt / Re-QC Date</label><input name="RECEIPT_DATE" type="date" value="${todayLocal()}" required></div><div class="field"><label>Returned Qty</label><input name="RETURNED_QTY" type="number" min="1" max="${rw.PENDING}" step="1" value="${rw.PENDING}" required></div><div class="field"><label>Pass after Rework</label><input name="PASS_QTY" type="number" min="0" step="1" value="${rw.PENDING}"></div><div class="field"><label>Reject after Rework</label><input name="REJECT_QTY" type="number" min="0" step="1" value="0"></div><div class="field"><label>Defect Reason</label><select name="DEFECT_REASON"><option value="">Select</option>${defects.map(x=>`<option value="${esc(x.DEFECT_NAME)}">${esc(x.DEFECT_NAME)}</option>`).join('')}</select></div><div class="field wide"><label>Notes</label><input name="NOTES"></div></div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Save Rework Return</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#rwReceiveForm').onsubmit=async e=>{e.preventDefault();const rec={...Object.fromEntries(new FormData(e.target).entries()),REWORK_ID:rw.REWORK_ID};try{await api('/api/data',{method:'POST',activity:'Receiving rework…',success:'Rework return saved',body:JSON.stringify({module:'rework_receive',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('qc',true)}catch(err){toast(err.message,'bad',5000)}}
}
async function openHandoverManage(row){
  const id=String(row.HANDOVER_ID||'');let d;
  try{d=await fetchDetail('handover',id)}catch(e){return toast(e.message,'bad',4500)}
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Manage Warehouse Handover</h3><small>${esc(id)}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <div class="manage-kpis"><div><span>Handover</span><b>${d.ACCEPTED_QTY}</b></div><div><span>Total Received</span><b>${d.TOTAL_RECEIVED}</b></div><div><span>Pending</span><b>${d.PENDING_QTY}</b></div><div><span>Additional Receipts</span><b>${(d.receipts||[]).length}</b></div></div>
    <div class="manage-actions">
      ${canAction('handover','edit')?'<button class="btn ghost" id="editWh">Edit Handover</button>':''}
      ${d.PENDING_QTY>0&&canAction('handover','create')?'<button class="btn teal" id="receiveWh">Receive Pending</button>':''}
      ${canAction('handover','cancel')?'<button class="btn danger" id="cancelWh">Cancel Handover</button>':''}
    </div>
    ${(d.receipts||[]).length?`<div class="subsection"><h4>Receipt History</h4><div class="history-list">${d.receipts.map(x=>`<div><b>${esc(x.RECEIPT_ID)}</b><span>${fmtDate(x.RECEIPT_DATE)} · ${x.RECEIVED_QTY} pcs</span>${canAction('handover','cancel')?`<button class="link-danger cancel-wh-receipt" data-id="${esc(x.RECEIPT_ID)}">Cancel</button>`:''}</div>`).join('')}</div></div>`:''}
  `;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;
  $('#editWh')?.addEventListener('click',()=>{closeModal();openHandoverEdit(d)});
  $('#receiveWh')?.addEventListener('click',()=>{closeModal();openWarehouseReceipt(d)});
  $('#cancelWh')?.addEventListener('click',()=>cancelRecord('handover_cancel',{HANDOVER_ID:id},'warehouse handover','handover'));
  document.querySelectorAll('.cancel-wh-receipt').forEach(b=>b.onclick=()=>cancelRecord('warehouse_receipt_cancel',{RECEIPT_ID:b.dataset.id},'warehouse receipt','handover'))
}
function openHandoverEdit(d){
  $('#modalBody').innerHTML=`<div class="panel-head"><div><h3>Edit Warehouse Handover</h3><small>${esc(d.HANDOVER_ID)}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="whEditForm"><div class="form-grid"><div class="field"><label>Handover Date</label><input name="HANDOVER_DATE" type="date" value="${esc(String(d.HANDOVER_DATE||'').slice(0,10))}" required></div><div class="field"><label>Handover Qty</label><input name="ACCEPTED_QTY" type="number" min="1" step="1" value="${d.ACCEPTED_QTY}" required></div><div class="field"><label>Initially Received Qty</label><input name="WAREHOUSE_RECEIVED_QTY" type="number" min="0" step="1" value="${d.WAREHOUSE_RECEIVED_QTY||0}"></div><div class="field"><label>Warehouse Ref</label><input name="WAREHOUSE_REF" value="${esc(d.WAREHOUSE_REF||'')}"></div><div class="field wide"><label>Notes</label><input name="NOTES" value="${esc(d.NOTES||'')}"></div></div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Save Correction</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#whEditForm').onsubmit=async e=>{e.preventDefault();const rec={...Object.fromEntries(new FormData(e.target).entries()),HANDOVER_ID:d.HANDOVER_ID};try{await api('/api/data',{method:'POST',activity:'Updating handover…',success:'Handover updated',body:JSON.stringify({module:'handover_edit',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('handover',true)}catch(err){toast(err.message,'bad',5000)}}
}
function openWarehouseReceipt(d){
  $('#modalBody').innerHTML=`<div class="panel-head"><div><h3>Receive Pending Warehouse Qty</h3><small>${esc(d.HANDOVER_ID)} · ${d.PENDING_QTY} pending</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="whReceiptForm"><div class="form-grid"><div class="field"><label>Receipt Date</label><input name="RECEIPT_DATE" type="date" value="${todayLocal()}" required></div><div class="field"><label>Received Qty</label><input name="RECEIVED_QTY" type="number" min="1" max="${d.PENDING_QTY}" step="1" value="${d.PENDING_QTY}" required></div><div class="field"><label>Warehouse Reference</label><input name="WAREHOUSE_REF"></div><div class="field wide"><label>Notes</label><input name="NOTES"></div></div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Close</button><button class="btn primary">Save Receipt</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#whReceiptForm').onsubmit=async e=>{e.preventDefault();const rec={...Object.fromEntries(new FormData(e.target).entries()),HANDOVER_ID:d.HANDOVER_ID};try{await api('/api/data',{method:'POST',activity:'Saving warehouse receipt…',success:'Warehouse receipt saved',body:JSON.stringify({module:'warehouse_receive',record:rec,requestId:newRequestId()})});dropCaches();closeModal();go('handover',true)}catch(err){toast(err.message,'bad',5000)}}
}
async function openDyeIssue(){
  const requestId=newRequestId();let l;
  try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const vendors=(l.vendors||[]).filter(v=>isTrue(v.DYE_VENDOR)&&isTrue(v.ACTIVE));
  const fabrics=(l.rawFabricGroups&&l.rawFabricGroups.length?l.rawFabricGroups:deriveRawFabricGroups(l.rawRolls||[]));
  const colors=(l.colors||[]).filter(c=>isTrue(c.ACTIVE));
  if(!vendors.length)return toast('Create at least one active Dye Vendor in Masters → Vendors.','bad',4200);
  if(!colors.length)return toast('Create at least one active Color in Masters → Colors.','bad',4200);
  if(!fabrics.length){const activeRolls=(l.rawRolls||[]).filter(r=>Number(r.BALANCE_MTR)>0);return toast(activeRolls.length?'Dye planning lookup is outdated. Deploy the latest Apps Script backend, then refresh.':'No raw fabric stock is available for dye planning.','bad',5200)}

  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>New Dye Plan</h3><small>Plan one fabric into multiple colors. Raw rolls are allocated automatically in the backend.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="dyePlanForm">
      <div class="form-grid">
        <div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" required value="${todayLocal()}"></div>
        <div class="field"><label>Fabric</label><select name="FABRIC_ID" id="dyeFabric" required><option value="">Select fabric</option>${fabrics.map(f=>`<option value="${esc(f.FABRIC_ID)}">${esc(f.FABRIC_NAME)} · ${moneyless(f.AVAILABLE_MTR)} m · ${f.ROLL_COUNT} roll(s)</option>`).join('')}</select></div>
        <div class="field"><label>Default Dye Vendor</label><select id="defaultDyeVendor"><option value="">Select default vendor</option>${vendorOptions(vendors,'DYE_VENDOR')}</select></div>
        <div class="field"><label>Available Fabric</label><input id="dyeAvailable" readonly value="—"></div>
        <div class="field wide"><label>Plan Notes</label><input name="NOTES"></div>
      </div>

      <div class="roll-head"><div><b>Color Plan</b><small>Add all colors here. Example: 10 colors × 200 m. Same color cannot repeat in one plan.</small></div><button type="button" class="btn teal" id="addColorRow">+ Add Color</button></div>
      <div class="roll-table"><table class="data"><thead><tr><th>#</th><th>Color</th><th>Dye Vendor</th><th>Meter</th><th></th></tr></thead><tbody id="colorPlanRows"></tbody></table></div>

      <div class="dye-plan-summary">
        <div><span>Available</span><b id="sumAvailable">0.00 m</b></div>
        <div><span>Planned</span><b id="sumPlanned">0.00 m</b></div>
        <div><span>Remaining</span><b id="sumRemaining">0.00 m</b></div>
        <div><span>Colors</span><b id="sumColors">0</b></div>
      </div>

      <div class="smart-note"><b>Automatic roll allocation:</b> system will consume available rolls in sequence and can split one roll across multiple colors. The backend keeps exact roll-to-color traceability.</div>
      <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Create Dye Plan</button></div>
    </form>`;
  $('#modal').classList.remove('hidden');

  const fabricSel=$('#dyeFabric'),defaultVendor=$('#defaultDyeVendor');
  function selectedColors(except=null){return [...$('#colorPlanRows').children].filter(r=>r!==except).map(r=>r.querySelector('.plan-color')?.value||'').filter(Boolean)}
  function currentAvailable(){const f=fabrics.find(x=>String(x.FABRIC_ID)===String(fabricSel.value));return Number(f?.AVAILABLE_MTR||0)}
  function refreshSummary(){
    const rows=[...$('#colorPlanRows').children],avail=currentAvailable(),planned=rows.reduce((s,r)=>s+(Number(r.querySelector('.plan-meter')?.value)||0),0);
    $('#dyeAvailable').value=fabricSel.value?moneyless(avail)+' m':'—';
    $('#sumAvailable').textContent=moneyless(avail)+' m';
    $('#sumPlanned').textContent=moneyless(planned)+' m';
    $('#sumRemaining').textContent=moneyless(Math.max(0,avail-planned))+' m';
    $('#sumColors').textContent=rows.filter(r=>r.querySelector('.plan-color')?.value).length;
    $('#sumRemaining').classList.toggle('over',planned>avail+0.0001);
  }
  function refreshColorOptions(){
    [...$('#colorPlanRows').children].forEach(row=>{
      const sel=row.querySelector('.plan-color'),current=sel.value,used=new Set(selectedColors(row));
      const allowed=colors.filter(c=>!used.has(String(c.COLOR_ID))||String(c.COLOR_ID)===String(current));
      sel.innerHTML='<option value="">Select color</option>'+colorOptions(allowed);
      if(current&&allowed.some(c=>String(c.COLOR_ID)===String(current)))sel.value=current;
    });
  }
  function addColorRow(prefillVendor=true){
    const tr=document.createElement('tr'),n=$('#colorPlanRows').children.length+1;
    tr.innerHTML=`<td class="plan-no">${n}</td>
      <td><select class="plan-color" required><option value="">Select color</option></select></td>
      <td><select class="plan-vendor" required><option value="">Select dye vendor</option>${vendorOptions(vendors,'DYE_VENDOR')}</select></td>
      <td><input class="plan-meter" type="number" min="0.01" step="0.01" placeholder="200" required></td>
      <td><button type="button" class="icon-remove">×</button></td>`;
    $('#colorPlanRows').appendChild(tr);refreshColorOptions();
    if(prefillVendor&&defaultVendor.value)tr.querySelector('.plan-vendor').value=defaultVendor.value;
    tr.querySelector('.plan-color').onchange=()=>{refreshColorOptions();refreshSummary()};
    tr.querySelector('.plan-meter').oninput=()=>{const avail=currentAvailable(),planned=[...$('#colorPlanRows .plan-meter')].reduce((s,x)=>s+(Number(x.value)||0),0);if(avail&&planned>avail+0.0001)toast('Planned meter exceeds available fabric. Reduce one or more color quantities.','bad',2600);refreshSummary()};
    tr.querySelector('.icon-remove').onclick=()=>{tr.remove();[...$('#colorPlanRows').children].forEach((x,i)=>x.querySelector('.plan-no').textContent=i+1);refreshColorOptions();refreshSummary()};
    refreshSummary();
  }

  fabricSel.onchange=refreshSummary;
  defaultVendor.onchange=()=>{if(!defaultVendor.value)return;[...$('#colorPlanRows .plan-vendor')].forEach(s=>{if(!s.value)s.value=defaultVendor.value})};
  $('#addColorRow').onclick=()=>addColorRow(true);
  $('#closeModal').onclick=$('#cancelModal').onclick=closeModal;

  for(let i=0;i<10;i++)addColorRow(false);

  $('#dyePlanForm').onsubmit=async e=>{
    e.preventDefault();
    const base=Object.fromEntries(new FormData(e.target).entries()),rows=[...$('#colorPlanRows').children];
    const items=rows.map(r=>({COLOR_ID:r.querySelector('.plan-color').value,DYE_VENDOR_ID:r.querySelector('.plan-vendor').value||defaultVendor.value,ISSUE_MTR:r.querySelector('.plan-meter').value})).filter(x=>x.COLOR_ID||x.ISSUE_MTR);
    if(!base.FABRIC_ID)return toast('Select fabric first.','bad',3000);
    if(!items.length)return toast('Add at least one color quantity.','bad',3000);
    const avail=currentAvailable(),planned=items.reduce((s,x)=>s+(Number(x.ISSUE_MTR)||0),0);
    if(planned>avail+0.0001)return toast('Total planned meter exceeds available fabric.','bad',3500);
    const missing=items.find(x=>!x.COLOR_ID||!x.DYE_VENDOR_ID||!(Number(x.ISSUE_MTR)>0));
    if(missing)return toast('Every used row needs Color, Dye Vendor and Meter.','bad',3500);
    try{
      const d=await api('/api/data',{method:'POST',activity:'Creating multi-color dye plan…',success:'Dye plan created',body:JSON.stringify({module:'dye_plan',record:{...base,items},requestId})});
      dropCaches();closeModal();toast(`Dye Plan ${d.record.DYE_PLAN_ID} created · ${d.record.BATCH_COUNT} colors · ${moneyless(d.record.TOTAL_MTR)} m`,'ok',5000);go('dye',true);
    }catch(err){toast(err.message,'bad',4500)}
  };
}


async function openDyeManage(batchRow){
  const batchId=String(batchRow.DYE_BATCH_ID||'');let detail,l;
  try{
    const [d,look]=await Promise.all([
      api('/api/data?module=dye_detail&id='+encodeURIComponent(batchId),{activity:'Loading dye batch…'}),
      getLookups(false)
    ]);
    detail=d.detail;l=look;
  }catch(e){return toast(e.message,'bad',4200)}
  const downstream=Number(detail.downstreamCount||0),receipts=detail.receipts||[],lines=detail.lines||[];
  const canEditIssue=downstream===0&&receipts.length===0,canCorrectReceipt=downstream===0&&receipts.length>0,canCancel=downstream===0;
  const vendors=(l.vendors||[]).filter(v=>isTrue(v.ACTIVE)&&isTrue(v.DYE_VENDOR));
  const colors=(l.colors||[]).filter(x=>isTrue(x.ACTIVE));
  const defects=(l.defects||[]).filter(d=>!d.STAGE||/dye/i.test(String(d.STAGE)));
  const receiptHtml=receipts.length?receipts.map((r,i)=>`
    <div class="correction-card">
      <div class="correction-head"><b>Receipt ${esc(r.RECEIPT_ID)}</b><span>${esc(r.STATUS||'')}</span></div>
      <div class="form-grid">
        <div class="field"><label>Receipt Date</label><input class="cr-date" type="date" value="${esc(String(r.RECEIPT_DATE||'').slice(0,10))}" ${canCorrectReceipt?'':'disabled'}></div>
        <div class="field"><label>Received Meter</label><input class="cr-received" type="number" step="0.01" min="0.01" value="${esc(r.RECEIVED_MTR)}" ${canCorrectReceipt?'':'disabled'}></div>
        <div class="field"><label>Defect/Hold Meter</label><input class="cr-defect" type="number" step="0.01" min="0" value="${esc(r.DEFECT_MTR)}" ${canCorrectReceipt?'':'disabled'}></div>
        <div class="field"><label>Final Receipt</label><select class="cr-final" ${canCorrectReceipt?'':'disabled'}><option value="false" ${isTrue(r.FINAL_RECEIPT)?'':'selected'}>Partial</option><option value="true" ${isTrue(r.FINAL_RECEIPT)?'selected':''}>Final</option></select></div>
        <div class="field"><label>Defect Reason</label><select class="cr-reason" ${canCorrectReceipt?'':'disabled'}><option value="">Select reason</option>${defects.map(d=>`<option value="${esc(d.DEFECT_NAME)}" ${String(d.DEFECT_NAME)===String(r.DEFECT_REASON||'')?'selected':''}>${esc(d.DEFECT_NAME)}</option>`).join('')}</select></div>
        <div class="field wide"><label>Notes</label><input class="cr-notes" value="${esc(r.NOTES||'')}" ${canCorrectReceipt?'':'disabled'}></div>
      </div>
      ${canCorrectReceipt?`<div class="form-actions"><button type="button" class="btn primary receipt-correct-btn" data-i="${i}">Save Receipt Correction</button></div>`:''}
    </div>`).join(''):'<div class="smart-note">No dye receipt has been entered for this batch yet.</div>';

  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Manage Dye Batch</h3><small>${esc(batchId)} · corrections are audit logged</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    ${downstream>0?'<div class="smart-note danger-note"><b>Locked:</b> this dye batch is already used in Production. Direct destructive changes are blocked.</div>':''}
    <div class="correction-card">
      <div class="correction-head"><b>Dye Issue</b><span>${canEditIssue?'Editable':'Locked'}</span></div>
      <form id="dyeIssueEditForm">
        <div class="form-grid">
          <div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" value="${esc(String(detail.ISSUE_DATE||'').slice(0,10))}" ${canEditIssue?'':'disabled'}></div>
          <div class="field"><label>Dye Vendor</label><select name="DYE_VENDOR_ID" ${canEditIssue?'':'disabled'}>${vendors.map(v=>`<option value="${esc(v.VENDOR_ID)}" ${String(v.VENDOR_ID)===String(detail.DYE_VENDOR_ID)?'selected':''}>${esc(v.VENDOR_NAME)}</option>`).join('')}</select></div>
          <div class="field"><label>Color</label><select name="COLOR_ID" ${canEditIssue?'':'disabled'}>${colors.map(x=>`<option value="${esc(x.COLOR_ID)}" ${String(x.COLOR_ID)===String(detail.COLOR_ID)?'selected':''}>${esc(x.COLOR_NAME)}</option>`).join('')}</select></div>
          <div class="field wide"><label>Notes</label><input name="NOTES" value="${esc(detail.NOTES||'')}" ${canEditIssue?'':'disabled'}></div>
        </div>
        <div class="roll-table"><table class="data"><thead><tr><th>Roll</th><th>Vendor Roll</th><th>Current Issue</th><th>Max Available</th></tr></thead><tbody>
          ${lines.map((x,i)=>`<tr><td>${esc(x.ROLL_ID)}<input type="hidden" class="edit-roll-id" value="${esc(x.ROLL_ID)}"></td><td>${esc(x.VENDOR_ROLL_NO||'')}</td><td><input class="edit-roll-qty" type="number" min="0.01" step="0.01" value="${esc(x.ISSUE_MTR)}" ${canEditIssue?'':'disabled'}></td><td>${moneyless(x.MAX_AVAILABLE_MTR)} m</td></tr>`).join('')}
        </tbody></table></div>
        ${canEditIssue?'<div class="form-actions"><button class="btn primary">Save Issue Correction</button></div>':''}
      </form>
    </div>
    <div class="panel-head" style="margin-top:14px"><h3>Dye Receipts</h3></div>
    ${receiptHtml}
    ${canCancel?`<div class="danger-zone"><div><b>Cancel this dye batch</b><small>Removes this batch and its dye receipts, restores raw-fabric availability, and writes an audit entry.</small></div><button class="btn danger" id="cancelDyeBatchBtn">Cancel Batch</button></div>`:''}
  `;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;

  if(canEditIssue){
    $('#dyeIssueEditForm').onsubmit=async e=>{
      e.preventDefault();const fd=new FormData(e.target),items=[...document.querySelectorAll('#dyeIssueEditForm tbody tr')].map(tr=>({ROLL_ID:tr.querySelector('.edit-roll-id').value,ISSUE_MTR:tr.querySelector('.edit-roll-qty').value}));
      try{await api('/api/data',{method:'POST',activity:'Saving dye issue correction…',success:'Dye issue corrected',body:JSON.stringify({module:'dye_edit_batch',record:{DYE_BATCH_ID:batchId,ISSUE_DATE:fd.get('ISSUE_DATE'),DYE_VENDOR_ID:fd.get('DYE_VENDOR_ID'),COLOR_ID:fd.get('COLOR_ID'),NOTES:fd.get('NOTES'),items},requestId:newRequestId()})});dropCaches();closeModal();go('dye',true)}catch(err){toast(err.message,'bad',5000)}
    };
  }
  document.querySelectorAll('.receipt-correct-btn').forEach(btn=>btn.onclick=async()=>{
    const card=btn.closest('.correction-card'),r=receipts[Number(btn.dataset.i)];
    const record={RECEIPT_ID:r.RECEIPT_ID,RECEIPT_DATE:card.querySelector('.cr-date').value,RECEIVED_MTR:card.querySelector('.cr-received').value,DEFECT_MTR:card.querySelector('.cr-defect').value,FINAL_RECEIPT:card.querySelector('.cr-final').value==='true',DEFECT_REASON:card.querySelector('.cr-reason').value,NOTES:card.querySelector('.cr-notes').value};
    try{await api('/api/data',{method:'POST',activity:'Saving receipt correction…',success:'Dye receipt corrected',body:JSON.stringify({module:'dye_edit_receipt',record,requestId:newRequestId()})});dropCaches();closeModal();go('dye',true)}catch(err){toast(err.message,'bad',5000)}
  });
  $('#cancelDyeBatchBtn')?.addEventListener('click',async()=>{
    if(!confirm('Cancel '+batchId+'? Its dye receipts will also be removed and raw-fabric availability restored.'))return;
    const reason=prompt('Reason for cancellation:','Mistaken entry')||'Mistaken entry';
    try{await api('/api/data',{method:'POST',activity:'Cancelling dye batch…',success:'Dye batch cancelled',body:JSON.stringify({module:'dye_cancel_batch',record:{DYE_BATCH_ID:batchId,REASON:reason},requestId:newRequestId()})});dropCaches();closeModal();go('dye',true)}catch(err){toast(err.message,'bad',5000)}
  });
}

async function openDyeReceive(batchRow){
  const requestId=newRequestId(),batchId=String(batchRow.DYE_BATCH_ID||'');let l;
  try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const batch=(l.dyePendingReceipt||[]).find(x=>String(x.DYE_BATCH_ID)===batchId)||batchRow;
  const issued=Number(batch.ISSUE_MTR||0),already=Number(batch.RECEIVED_MTR||0),plannedGap=issued-already;
  const defects=(l.defects||[]).filter(d=>!d.STAGE||/dye/i.test(String(d.STAGE)));
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Receive Dyed Fabric</h3><small>${esc(batch.DYE_BATCH_ID)} · ${esc(batch.FABRIC_NAME||batch.FABRIC||'')} · ${esc(batch.COLOR_NAME||batch.COLOR||'')}</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="dyeReceiveForm">
      <div class="form-grid">
        <div class="field"><label>Receipt Date</label><input name="RECEIPT_DATE" type="date" required value="${todayLocal()}"></div>
        <div class="field"><label>Dye Vendor</label><input readonly value="${esc(batch.DYE_VENDOR_NAME||batch.DYE_VENDOR||'')}"></div>
        <div class="field"><label>Issued / Planned for Color</label><input readonly value="${moneyless(issued)} m"></div>
        <div class="field"><label>Already Received</label><input readonly value="${moneyless(already)} m"></div>
        <div class="field"><label>Expected Balance vs Plan</label><input readonly value="${moneyless(plannedGap)} m"></div>
        <div class="field"><label>Actual Received Now</label><input name="RECEIVED_MTR" id="receiveNow" type="number" min="0.01" step="0.01" required value="${plannedGap>0?moneyless(plannedGap):''}"></div>
        <div class="field"><label>Defect / Hold Meter</label><input name="DEFECT_MTR" id="defectNow" type="number" min="0" step="0.01" value="0"></div>
        <div class="field"><label>Usable Now</label><input id="usableNow" readonly></div>
        <div class="field"><label>Defect Reason</label><select name="DEFECT_REASON"><option value="">Select reason</option>${defects.map(d=>`<option value="${esc(d.DEFECT_NAME)}">${esc(d.DEFECT_NAME)}</option>`).join('')}</select></div>
        <div class="field"><label>Receipt Status</label><select name="FINAL_RECEIPT" id="finalReceipt"><option value="false">Partial — more may come</option><option value="true" selected>Final — close this color batch</option></select></div>
        <div class="field wide"><label>Notes</label><input name="NOTES" placeholder="e.g. shade mix-up, excess returned, short receipt"></div>
      </div>
      <div class="dye-plan-summary">
        <div><span>Color Issued</span><b>${moneyless(issued)} m</b></div>
        <div><span>Total Received After This</span><b id="sumReceivedAfter">${moneyless(already)} m</b></div>
        <div><span>Color Variance</span><b id="sumVariance">0 m</b></div>
        <div><span>Usable This Receipt</span><b id="sumUsableNow">0 m</b></div>
      </div>
      <div class="smart-note"><b>Actual truth:</b> production stock will use actual usable received quantity only. A color can close short or excess. Variance stays visible for reconciliation.</div>
      <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save Dye Receipt</button></div>
    </form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  const recv=$('#receiveNow'),def=$('#defectNow'),final=$('#finalReceipt');
  function calc(){
    let r=Math.max(0,Number(recv.value||0)),d=Math.max(0,Number(def.value||0));if(d>r){d=r;def.value=moneyless(d)}
    const total=already+r,usable=r-d,variance=total-issued;
    $('#usableNow').value=moneyless(usable)+' m';$('#sumReceivedAfter').textContent=moneyless(total)+' m';$('#sumUsableNow').textContent=moneyless(usable)+' m';
    const v=$('#sumVariance');v.textContent=(variance>0?'+':'')+moneyless(variance)+' m';v.classList.toggle('over',Math.abs(variance)>0.0001);
  }
  recv.oninput=calc;def.oninput=calc;final.onchange=calc;calc();
  $('#dyeReceiveForm').onsubmit=async e=>{e.preventDefault();const rec=Object.fromEntries(new FormData(e.target).entries());rec.DYE_BATCH_ID=batchId;rec.FINAL_RECEIPT=rec.FINAL_RECEIPT==='true';try{const d=await api('/api/data',{method:'POST',activity:'Saving actual dye receipt…',success:'Dye receipt saved',body:JSON.stringify({module:'dye_receive',record:rec,requestId})});dropCaches();closeModal();const bv=Number(d.record.BATCH?.VARIANCE_MTR||0),pv=Number(d.record.PLAN?.VARIANCE_MTR||0);toast(`Saved · Color variance ${bv>0?'+':''}${moneyless(bv)} m · Plan variance ${pv>0?'+':''}${moneyless(pv)} m`,'ok',5000);go('dye',true)}catch(err){toast(err.message,'bad',4200)}};
}

async function openProductionPlan(){
  const requestId=newRequestId();let l;try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const batches=l.dyeBatches||[],styles=l.styles||[];
  if(!batches.length)return toast('No dyed usable stock is available. Dye receipt must be completed before production allocation.','bad',4500);
  if(!styles.length)return toast('Create active Styles in Masters first.','bad',3500);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Plan Production</h3><small>Allocate only usable dyed stock. Balance is enforced automatically.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="prodSmartForm"><div class="form-grid">
      <div class="field"><label>Plan Date</label><input name="PLAN_DATE" type="date" required value="${todayLocal()}"></div>
      <div class="field"><label>Dyed Batch</label><select name="DYE_BATCH_ID" id="prodBatch" required><option value="">Select dyed batch</option>${batches.map(b=>`<option value="${esc(b.DYE_BATCH_ID)}">${esc(b.DYE_BATCH_ID)} · ${esc(b.FABRIC_NAME)} · ${esc(b.COLOR_NAME)} · ${moneyless(b.BALANCE_MTR)} m available</option>`).join('')}</select></div>
      <div class="field"><label>Style / Product</label><select name="STYLE_ID" id="prodStyle" required><option value="">Select style</option>${styleOptions(styles)}</select></div>
      <div class="field"><label>Available Dyed Meter</label><input id="prodAvail" readonly value="—"></div>
      <div class="field"><label>Planned Garment Qty</label><input name="PLANNED_QTY" type="number" min="1" step="1"></div>
      <div class="field"><label>Allocate Meter</label><input name="ALLOCATED_MTR" id="prodAlloc" type="number" min="0.01" step="0.01" required></div>
      <div class="field wide"><label>Notes</label><input name="NOTES"></div>
    </div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save Production Plan</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#prodBatch').onchange=e=>{const b=batches.find(x=>String(x.DYE_BATCH_ID)===String(e.target.value));$('#prodAvail').value=b?moneyless(b.BALANCE_MTR)+' m':'—';$('#prodAlloc').max=b?b.BALANCE_MTR:'';const sel=$('#prodStyle');if(!b){sel.innerHTML='<option value="">Select style</option>'+styleOptions(styles);return}const compatible=styles.filter(s=>!s.DEFAULT_FABRIC_ID||String(s.DEFAULT_FABRIC_ID)===String(b.FABRIC_ID));sel.innerHTML='<option value="">Select compatible style</option>'+styleOptions(compatible);if(!compatible.length)toast('No style is mapped to this fabric. Update Style Master first.','bad',4200)};
  $('#prodSmartForm').onsubmit=async e=>{e.preventDefault();const rec=Object.fromEntries(new FormData(e.target).entries());try{await api('/api/data',{method:'POST',activity:'Saving production plan…',success:'Production plan saved',body:JSON.stringify({module:'production',record:rec,requestId})});dropCaches();closeModal();go('production',true)}catch(err){toast(err.message,'bad',4200)}};
}

async function openStitchingIssue(){
  const requestId=newRequestId();let l;try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const vendors=(l.vendors||[]).filter(v=>isTrue(v.STITCHING_VENDOR)&&isTrue(v.ACTIVE)),batches=l.productionBatches||[],sizes=(l.sizes||[]).filter(x=>isTrue(x.ACTIVE));
  if(!vendors.length)return toast('Create an active Stitching Vendor in Masters → Vendors.','bad',4200);
  if(!sizes.length)return toast('Create active Sizes in Masters → Sizes.','bad',4200);
  if(!batches.length)return toast('No cut-piece stock is available for stitching issue. Complete cutting first.','bad',4200);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Create Stitching Issue</h3><small>Size-wise available cut stock loads from the selected production batch.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="stitchSmartForm"><div class="form-grid">
      <div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" required value="${todayLocal()}"></div>
      <div class="field"><label>Stitching Vendor</label><select name="STITCHING_VENDOR_ID" required><option value="">Select stitching vendor</option>${vendorOptions(vendors,'STITCHING_VENDOR')}</select></div>
      <div class="field wide"><label>Production Batch</label><select name="PRODUCTION_BATCH_ID" id="stitchBatch" required><option value="">Select cut batch</option>${batches.map(b=>`<option value="${esc(b.PRODUCTION_BATCH_ID)}">${esc(b.PRODUCTION_BATCH_ID)} · ${esc(b.STYLE_NAME||b.STYLE||'')} · ${esc(b.COLOR_NAME||b.COLOR_ID||'')} · ${Number(b.CUT_BALANCE||0)} pcs available</option>`).join('')}</select></div>
      <div class="field wide"><label>Notes</label><input name="NOTES"></div>
    </div>
    <div class="subsection"><h4>Size-wise Issue</h4><div id="stitchSizeHost" class="dynamic-size-grid"><div class="field wide"><small>Select production batch first.</small></div></div><div class="size-total">Total Issue <b id="stitchIssueTotal">0</b> pcs</div></div>
    <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Create Stitching Issue</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  let currentBalances={};
  $('#stitchBatch').onchange=async e=>{
    const id=e.target.value,host=$('#stitchSizeHost');if(!id){host.innerHTML='<div class="field wide"><small>Select production batch first.</small></div>';return}
    host.innerHTML='<div class="field wide"><small>Loading size balances…</small></div>';
    try{
      const d=await fetchDetail('production',id);currentBalances=Object.fromEntries((d.sizeBalances||[]).map(x=>[x.SIZE_ID,Number(x.BALANCE_QTY||0)]));
      host.innerHTML=sizeLineFields(sizes,{},'size-qty',currentBalances);
      host.querySelectorAll('.size-qty').forEach(x=>x.addEventListener('input',()=>{$('#stitchIssueTotal').textContent=[...host.querySelectorAll('.size-qty')].reduce((s,y)=>s+(Number(y.value)||0),0)}))
    }catch(err){host.innerHTML='<div class="field wide"><small>Could not load balances.</small></div>';toast(err.message,'bad',4000)}
  };
  $('#stitchSmartForm').onsubmit=async e=>{
    e.preventDefault();const rec={...Object.fromEntries(new FormData(e.target).entries()),items:collectSizeLines(e.target)};
    if(!rec.items.length)return toast('Enter at least one size quantity.','bad',3000);
    try{await api('/api/data',{method:'POST',activity:'Creating stitching issue…',success:'Stitching issue saved',body:JSON.stringify({module:'stitching',record:rec,requestId})});dropCaches();closeModal();go('stitching',true)}catch(err){toast(err.message,'bad',4200)}
  };
}

async function openQcEntry(){
  const requestId=newRequestId();let l;try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const challans=l.stitchingChallans||[],defects=(l.defects||[]).filter(x=>isTrue(x.ACTIVE));
  if(!challans.length)return toast('No stitching receipt is pending QC. Receive garments from stitching first.','bad',4500);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>QC Entry</h3><small>Received pieces pending QC are loaded size-wise from the selected challan.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="qcSmartForm"><div class="form-grid">
      <div class="field"><label>QC Date</label><input name="QC_DATE" type="date" required value="${todayLocal()}"></div>
      <div class="field"><label>Stitching Challan</label><select name="CHALLAN_ID" id="qcChallan" required><option value="">Select challan</option>${challans.map(x=>`<option value="${esc(x.CHALLAN_ID)}">${esc(x.CHALLAN_ID)} · ${esc(x.VENDOR_NAME||'')} · ${esc(x.STYLE_NAME||'')} · ${Number(x.QC_PENDING||0)} pcs pending QC</option>`).join('')}</select></div>
      <div class="field"><label>Size</label><select name="SIZE" id="qcSize" required><option value="">Select challan first</option></select></div>
      <div class="field"><label>Pending QC Qty</label><input id="qcPending" readonly value="—"></div>
      <div class="field"><label>QC Qty</label><input name="QC_QTY" id="qcQty" type="number" min="1" step="1" required></div>
      <div class="field"><label>Pass</label><input name="PASS_QTY" id="qcPass" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Rework</label><input name="REWORK_QTY" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Reject</label><input name="REJECT_QTY" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Defect Reason</label><select name="DEFECT_REASON"><option value="">Select reason</option>${defects.map(d=>`<option value="${esc(d.DEFECT_NAME)}">${esc(d.DEFECT_NAME)}${d.STAGE?' · '+esc(d.STAGE):''}</option>`).join('')}</select></div>
      <div class="field wide"><label>Notes</label><input name="NOTES"></div>
    </div><div class="recon-strip"><span>QC Split Total <b id="qcSplitTotal">0</b></span><span>Difference <b id="qcSplitDiff">0</b></span></div>
    <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save QC</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  let pendingLines=[];
  $('#qcChallan').onchange=async e=>{
    const id=e.target.value,sel=$('#qcSize');sel.innerHTML='<option value="">Loading…</option>';$('#qcPending').value='—';$('#qcQty').value='';
    if(!id)return;
    try{
      const d=await fetchDetail('stitching',id);pendingLines=d.qcPendingLines||[];
      sel.innerHTML='<option value="">Select size</option>'+pendingLines.map(x=>`<option value="${esc(x.SIZE_ID)}">${esc(x.SIZE_NAME)} · ${x.PENDING_QTY} pending</option>`).join('')
    }catch(err){sel.innerHTML='<option value="">Could not load</option>';toast(err.message,'bad',4000)}
  };
  $('#qcSize').onchange=e=>{const x=pendingLines.find(z=>String(z.SIZE_ID)===String(e.target.value)),bal=Number(x?.PENDING_QTY||0);$('#qcPending').value=bal+' pcs';$('#qcQty').max=bal;$('#qcQty').value=bal||'';$('#qcPass').value=bal||0;calcQc()};
  function calcQc(){const f=$('#qcSmartForm'),q=Number(f.elements.QC_QTY.value||0),sum=Number(f.elements.PASS_QTY.value||0)+Number(f.elements.REWORK_QTY.value||0)+Number(f.elements.REJECT_QTY.value||0);$('#qcSplitTotal').textContent=sum;$('#qcSplitDiff').textContent=q-sum;$('#qcSplitDiff').classList.toggle('bad',q!==sum)}
  $('#qcSmartForm').addEventListener('input',calcQc);
  $('#qcSmartForm').onsubmit=async e=>{e.preventDefault();const rec=Object.fromEntries(new FormData(e.target).entries());try{await api('/api/data',{method:'POST',activity:'Saving QC result…',success:'QC saved',body:JSON.stringify({module:'qc',record:rec,requestId})});dropCaches();closeModal();go('qc',true)}catch(err){toast(err.message,'bad',4200)}};
}

async function openWarehouseHandover(){
  const requestId=newRequestId();let l;try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const ready=l.warehouseReady||[];
  if(!ready.length)return toast('No QC-passed garment quantity is pending warehouse handover.','bad',4200);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Warehouse Handover</h3><small>Only QC-passed quantity not already handed over is shown.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="whSmartForm"><div class="form-grid">
      <div class="field"><label>Handover Date</label><input name="HANDOVER_DATE" type="date" required value="${todayLocal()}"></div>
      <div class="field wide"><label>Ready Stock</label><select id="whReady" required><option value="">Select QC-passed stock</option>${ready.map((x,i)=>`<option value="${i}">${esc(x.STYLE_NAME)} · ${esc(x.COLOR_NAME)} · ${esc(x.SIZE)} · ${moneyless(x.PENDING_QTY)} pcs ready · ${esc(x.PRODUCTION_BATCH_ID)}</option>`).join('')}</select></div>
      <input type="hidden" name="PRODUCTION_BATCH_ID"><input type="hidden" name="STYLE_ID"><input type="hidden" name="COLOR_ID"><input type="hidden" name="SIZE">
      <div class="field"><label>Available Qty</label><input id="whAvail" readonly value="—"></div>
      <div class="field"><label>Handover Qty</label><input name="ACCEPTED_QTY" id="whQty" type="number" min="1" step="1" required></div>
      <div class="field"><label>Warehouse Received Qty</label><input name="WAREHOUSE_RECEIVED_QTY" type="number" min="0" step="1"></div>
      <div class="field"><label>Warehouse Reference</label><input name="WAREHOUSE_REF"></div>
      <div class="field wide"><label>Notes</label><input name="NOTES"></div>
    </div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save Handover</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#whReady').onchange=e=>{const x=ready[Number(e.target.value)];const f=$('#whSmartForm');if(!x)return;f.elements.PRODUCTION_BATCH_ID.value=x.PRODUCTION_BATCH_ID;f.elements.STYLE_ID.value=x.STYLE_ID;f.elements.COLOR_ID.value=x.COLOR_ID;f.elements.SIZE.value=x.SIZE;$('#whAvail').value=moneyless(x.PENDING_QTY)+' pcs';$('#whQty').max=x.PENDING_QTY;$('#whQty').value=moneyless(x.PENDING_QTY);f.elements.WAREHOUSE_RECEIVED_QTY.value=moneyless(x.PENDING_QTY)};
  $('#whSmartForm').onsubmit=async e=>{e.preventDefault();const rec=Object.fromEntries(new FormData(e.target).entries());try{await api('/api/data',{method:'POST',activity:'Saving warehouse handover…',success:'Warehouse handover saved',body:JSON.stringify({module:'handover',record:rec,requestId})});dropCaches();closeModal();go('handover',true)}catch(err){toast(err.message,'bad',4200)}};
}

async function openRawInward(){const requestId=newRequestId();
  let l;try{l=await getLookups(false)}catch(e){return toast(e.message,'bad',3500)}
  const suppliers=(l.vendors||[]).filter(v=>isTrue(v.FABRIC_SUPPLIER)&&isTrue(v.ACTIVE));
  if(!suppliers.length)return alert('First create a Fabric Supplier from Masters → Vendors.');
  if(!(l.fabrics||[]).length)return alert('First create Fabric Types from Masters → Fabrics.');
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>New Fabric Inward</h3><small>One challan can contain multiple fabric types and rolls.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="rawBulkForm">
      <div class="form-grid">
        <div class="field"><label>Inward Date</label><input name="INWARD_DATE" type="date" required value="${todayLocal()}"></div>
        <div class="field"><label>Supplier</label><select name="SUPPLIER_ID" required><option value="">Select supplier</option>${opts(suppliers,'VENDOR_ID','VENDOR_NAME')}</select></div>
        <div class="field"><label>Delivery Challan / Invoice</label><input name="INVOICE_CHALLAN"></div>
        <div class="field"><label>Lot Reference</label><input name="LOT_REF"></div>
        <div class="field wide"><label>General Notes</label><input name="NOTES"></div>
      </div>
      <div class="roll-head"><div><b>Roll Details</b><small>Add every physical roll separately. Vendor roll number may repeat.</small></div><button type="button" class="btn teal" id="addRollBtn">+ Add Roll</button></div>
      <div class="roll-table"><table class="data"><thead><tr><th>#</th><th>Fabric</th><th>Vendor Roll No.</th><th>Meter</th><th>Notes</th><th></th></tr></thead><tbody id="rollRows"></tbody></table></div>
      <div class="roll-summary"><span>Total Rolls <b id="rollCount">0</b></span><span>Total Meter <b id="rollMeters">0.00</b></span></div>
      <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save Complete Inward</button></div>
    </form>`;
  $('#modal').classList.remove('hidden');
  const fabrics=l.fabrics||[];
  function addRoll(){
    const n=$('#rollRows').children.length+1,tr=document.createElement('tr');
    tr.innerHTML=`<td class="roll-no">${n}</td><td><select class="roll-fabric" required><option value="">Select fabric</option>${opts(fabrics,'FABRIC_ID','FABRIC_NAME')}</select></td><td><input class="roll-vendor" placeholder="e.g. 17"></td><td><input class="roll-meter" type="number" min="0.01" step="0.01" required placeholder="0.00"></td><td><input class="roll-note"></td><td><button type="button" class="icon-remove">×</button></td>`;
    $('#rollRows').appendChild(tr);tr.querySelector('.icon-remove').onclick=()=>{tr.remove();renumber();summary()};tr.querySelector('.roll-meter').oninput=summary;summary();
  }
  function renumber(){[...$('#rollRows').children].forEach((tr,i)=>tr.querySelector('.roll-no').textContent=i+1)}
  function summary(){const rows=[...$('#rollRows').children],m=rows.reduce((s,tr)=>s+(Number(tr.querySelector('.roll-meter').value)||0),0);$('#rollCount').textContent=rows.length;$('#rollMeters').textContent=m.toFixed(2)}
  $('#addRollBtn').onclick=addRoll;$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;addRoll();addRoll();addRoll();
  $('#rawBulkForm').onsubmit=async e=>{e.preventDefault();const base=Object.fromEntries(new FormData(e.target).entries());const items=[...$('#rollRows').children].map(tr=>({FABRIC_ID:tr.querySelector('.roll-fabric').value,VENDOR_ROLL_NO:tr.querySelector('.roll-vendor').value,INWARD_MTR:tr.querySelector('.roll-meter').value,NOTES:tr.querySelector('.roll-note').value}));if(!items.length)return alert('Add at least one roll.');try{const d=await api('/api/data',{method:'POST',activity:'Saving complete fabric inward…',success:'Fabric inward saved successfully',body:JSON.stringify({module:'raw_bulk',record:{...base,items},requestId})});dropCaches();closeModal();toast(`Inward saved: ${d.record.INWARD_ID} • ${d.record.ROLL_COUNT} rolls • ${d.record.TOTAL_MTR} m`,'ok',4200);go('raw')}catch(err){toast(err.message,'bad',3500)}}
}

const MASTER_CFG={
 vendor:{label:'Vendors',id:'VENDOR_ID',name:'VENDOR_NAME',cols:['VENDOR_ID','VENDOR_NAME','FABRIC_SUPPLIER','DYE_VENDOR','STITCHING_VENDOR','CUTTING_VENDOR','PHONE','ACTIVE']},
 fabric:{label:'Fabrics',id:'FABRIC_ID',name:'FABRIC_NAME',cols:['FABRIC_ID','FABRIC_NAME','FABRIC_CODE','UOM','ACTIVE']},
 color:{label:'Colors',id:'COLOR_ID',name:'COLOR_NAME',cols:['COLOR_ID','COLOR_NAME','COLOR_CODE','ACTIVE']},
 style:{label:'Styles',id:'STYLE_ID',name:'STYLE_NAME',cols:['STYLE_ID','STYLE_NAME','CATEGORY','STYLE_CODE','DEFAULT_FABRIC_ID','ACTIVE']},
 size:{label:'Sizes',id:'SIZE_ID',name:'SIZE_NAME',cols:['SIZE_ID','SIZE_NAME','SORT_ORDER','ACTIVE']},
 defect:{label:'Defect Reasons',id:'DEFECT_ID',name:'DEFECT_NAME',cols:['DEFECT_ID','DEFECT_NAME','STAGE','CATEGORY','ACTIVE']}
};
let mastersCache=null,masterTab='vendor';
async function renderMasters(force=false){
  const s=$('#stage');s.innerHTML='<section class="panel"><div class="panel-head"><div><h3>Masters</h3><small>Manage the database values used by production entry forms.</small></div><button class="btn teal" id="masterAdd">+ Add</button></div><div class="master-tabs" id="masterTabs"></div><div id="masterContent">Loading…</div></section>';
  try{const d=await getCachedModule('masters',force);mastersCache=d.masters||{};drawMasterTabs();await drawMasterTable();$('#masterAdd').onclick=()=>openMasterForm(masterTab,null)}catch(e){toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}
}
function drawMasterTabs(){$('#masterTabs').innerHTML=Object.entries(MASTER_CFG).map(([k,v])=>`<button class="${k===masterTab?'active':''}" data-k="${k}">${v.label}</button>`).join('');$('#masterTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{masterTab=b.dataset.k;drawMasterTabs();drawMasterTable()})}
function masterItems(type){const key={vendor:'vendors',fabric:'fabrics',color:'colors',style:'styles',size:'sizes',defect:'defects'}[type];return mastersCache?.[key]||[]}
function boolText(v){return isTrue(v)?'Yes':'No'}
const MASTER_FILTERS={
  vendor:['ACTIVE','FABRIC_SUPPLIER','DYE_VENDOR','STITCHING_VENDOR','CUTTING_VENDOR'],
  fabric:['UOM','ACTIVE'],color:['ACTIVE'],style:['CATEGORY','ACTIVE'],size:['ACTIVE'],defect:['STAGE','CATEGORY','ACTIVE']
};
async function drawMasterTable(){
  const cfg=MASTER_CFG[masterTab],items=masterItems(masterTab),host=$('#masterContent');host.innerHTML='Loading…';
  await mountDataGrid(host,{
    key:'masters:'+masterTab,title:'Masters - '+cfg.label,items,
    columns:[...cfg.cols,'__ACTION'],filters:MASTER_FILTERS[masterTab]||[],
    actionRenderer:r=>'<button class="btn ghost master-edit" data-idx="'+r.__gridIndex+'">Edit</button>',
    bindActions:(pageRows,el)=>el.querySelectorAll('.master-edit').forEach(b=>b.onclick=()=>openMasterForm(masterTab,items[Number(b.dataset.idx)]))
  })
}
async function openMasterForm(type,row){
  const requestId=newRequestId(),cfg=MASTER_CFG[type],editing=!!row,l=await getLookups(false),f=[];
  if(type==='vendor')f.push(['VENDOR_NAME','text'],['FABRIC_SUPPLIER','check'],['DYE_VENDOR','check'],['STITCHING_VENDOR','check'],['CUTTING_VENDOR','check'],['PHONE','text'],['GST_REF','text'],['ADDRESS','text'],['ACTIVE','check']);
  if(type==='fabric')f.push(['FABRIC_NAME','text'],['FABRIC_CODE','text'],['UOM','text'],['NOTES','text'],['ACTIVE','check']);
  if(type==='color')f.push(['COLOR_NAME','text'],['COLOR_CODE','text'],['ACTIVE','check']);
  if(type==='style')f.push(['STYLE_NAME','text'],['CATEGORY','text'],['STYLE_CODE','text'],['DEFAULT_FABRIC_ID','fabric'],['NOTES','text'],['ACTIVE','check']);
  if(type==='size')f.push(['SIZE_NAME','text'],['SORT_ORDER','number'],['ACTIVE','check']);
  if(type==='defect')f.push(['DEFECT_NAME','text'],['STAGE','text'],['CATEGORY','text'],['NOTES','text'],['ACTIVE','check']);
  function control([k,t]){const val=row?.[k]??'';if(t==='check')return `<div class="field"><label><input type="checkbox" name="${k}" ${(!editing&&k==='ACTIVE')||isTrue(val)?'checked':''}> ${k.replaceAll('_',' ')}</label></div>`;if(t==='fabric')return `<div class="field"><label>${k.replaceAll('_',' ')}</label><select name="${k}"><option value="">Select fabric</option>${(l.fabrics||[]).map(x=>`<option value="${esc(x.FABRIC_ID)}" ${String(x.FABRIC_ID)===String(val)?'selected':''}>${esc(x.FABRIC_NAME)}</option>`).join('')}</select></div>`;return `<div class="field"><label>${k.replaceAll('_',' ')}</label><input name="${k}" type="${t}" value="${esc(val)}"></div>`}
  $('#modalBody').innerHTML=`<div class="panel-head"><h3>${editing?'Edit':'Add'} ${cfg.label.replace(/s$/,'')}</h3><button class="btn ghost" id="closeModal">Close</button></div><form id="masterForm"><div class="form-grid">${f.map(control).join('')}</div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;$('#masterForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),rec={entity:type};if(editing)rec[cfg.id]=row[cfg.id];for(const [k,t] of f){rec[k]=t==='check'?fd.has(k):(fd.get(k)||'')}try{await api('/api/data',{method:'POST',activity:'Saving '+cfg.label.replace(/s$/,'')+'…',success:cfg.label.replace(/s$/,'')+' saved',body:JSON.stringify({module:'master',record:rec,requestId})});dropCaches();closeModal();const d=await getCachedModule('masters',true);mastersCache=d.masters||{};drawMasterTable()}catch(err){toast(err.message,'bad',3500)}}
}

async function renderReports(force=false){
  $('#stage').innerHTML=`<section class="panel"><div class="panel-head"><h3>Reports</h3></div><div class="master-tabs" id="reportTabs"><button class="active" data-rpt="summary">Production Summary</button><button data-rpt="audit">Audit Trail</button></div><div id="reportBody">Loading…</div></section>`;
  const tabs=[...document.querySelectorAll('#reportTabs button')];
  async function show(tab){
    tabs.forEach(b=>b.classList.toggle('active',b.dataset.rpt===tab));state.activeGridKey='';
    const host=$('#reportBody');host.innerHTML='Loading…';
    try{
      if(tab==='summary'){
        const d=await getCachedModule('reports',force),v=d.kpis||{};
        host.innerHTML=`<div class="kpis">${Object.entries(v).map(([k,x])=>`<div class="kpi"><span>${gridLabel(k)}</span><strong>${moneyless(x)}</strong></div>`).join('')}</div>`
      }else{
        const d=await getCachedModule('audit',force),items=d.items||[];
        await mountDataGrid(host,{key:'reports:audit',title:'Audit Trail',items,columns:['TIMESTAMP','USER_NAME','USER_ID','ACTION','MODULE','RECORD_ID','OLD_VALUE_JSON','NEW_VALUE_JSON'],filters:['USER_NAME','ACTION','MODULE']})
      }
    }catch(e){host.innerHTML='';toast(e.message,'bad',4200)}
  }
  tabs.forEach(b=>b.onclick=()=>show(b.dataset.rpt));await show('summary')
}
async function renderUsers(force=false){
  $('#stage').innerHTML='<section class="panel"><div class="panel-head"><div><h3>User Management</h3><small>Cloudflare D1 user database</small></div><button class="btn teal" onclick="window.ERP.newUser()">+ Add User</button></div><div id="usersGrid">Loading…</div></section><section class="panel" style="margin-top:16px"><div class="panel-head"><h3>Database</h3></div><div class="smart-note"><b>Cloudflare D1 is the live primary database.</b> Google Sheets is no longer part of normal ERP reads/writes.</div></section>';
  try{
    let d;if(!force){const cc=readCache('users');d=cc&&cc.data}
    if(!d){d=await api('/api/users');writeCache('users',d)}
    await mountDataGrid($('#usersGrid'),{key:'users',title:'Users',items:d.items||[],columns:['userId','name','role','admin','active'],filters:['role','admin','active']});
  }catch(e){toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}
}
function newUser(){const requestId=newRequestId(),f=['userId','name','pin','role'];$('#modalBody').innerHTML=`<div class="panel-head"><h3>Add User</h3><button id="closeModal" class="btn ghost">Close</button></div><form id="uForm"><div class="form-grid">${f.map(x=>`<div class="field"><label>${x.toUpperCase()}</label><input name="${x}" ${x==='pin'?'type="password"':''}></div>`).join('')}<div class="field"><label><input type="checkbox" name="admin"> Admin</label></div>${['raw','dye','production','stitching','qc','reports'].map(p=>`<div class="field"><label><input type="checkbox" name="perm_${p}"> ${p.toUpperCase()}</label></div>`).join('')}</div><div class="form-actions"><button class="btn primary">Save User</button></div></form>`;$('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;$('#uForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),b={};for(const[k,v]of fd.entries())b[k]=v==='on'?true:v;['admin','perm_raw','perm_dye','perm_production','perm_stitching','perm_qc','perm_reports'].forEach(k=>b[k]=!!b[k]);b.active=true;try{await api('/api/users',{method:'POST',activity:'Saving user…',success:'User saved',body:JSON.stringify({...b,requestId})});dropCaches();closeModal();renderUsers(true)}catch(err){toast(err.message,'bad',3500)}}}
$('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginError').textContent='';try{const d=await api('/api/login',{method:'POST',activity:'Logging in…',success:'Login successful',body:JSON.stringify({userId:$('#userId').value,pin:$('#pin').value})});state.token=d.token;state.user=d.user;localStorage.setItem('rrr_prod_token',d.token);localStorage.setItem('rrr_prod_user',JSON.stringify(d.user));dropCaches();if(d.kpis)writeCache('dashboard',{user:d.user,kpis:d.kpis});showApp()}catch(err){$('#loginError').textContent=err.message}}
$('#logoutBtn').onclick=()=>{localStorage.removeItem('rrr_prod_token');localStorage.removeItem('rrr_prod_user');sessionStorage.clear();location.reload()};async function refreshCurrent(){if(state.refreshing)return;state.refreshing=true;const b=$('#refreshBtn');b?.classList.add('spinning');setStatus('↻ Refreshing…','busy');try{dropCaches();await go(state.current,true);setStatus('● Updated just now','ok')}catch(e){setStatus('● Refresh failed','bad');if(e.status===401){localStorage.removeItem('rrr_prod_token');localStorage.removeItem('rrr_prod_user');location.reload()}else toast(e.message,'bad',3500)}finally{state.refreshing=false;b?.classList.remove('spinning')}}
$('#refreshBtn')?.addEventListener('click',refreshCurrent);
$('#exportMenuBtn')?.addEventListener('click',e=>{e.stopPropagation();$('#exportMenu')?.classList.toggle('hidden')});
$('#exportExcelBtn')?.addEventListener('click',()=>{$('#exportMenu')?.classList.add('hidden');exportExcel()});
$('#exportPdfBtn')?.addEventListener('click',()=>{$('#exportMenu')?.classList.add('hidden');exportPdf()});
window.addEventListener('online',()=>setStatus('● Online','ok'));window.addEventListener('offline',()=>setStatus('● Offline','bad'));
window.ERP={quick:m=>go(m).then(()=>setTimeout(()=>$('#newBtn')?.click(),50)),newUser,refresh:refreshCurrent,exportExcel,exportPdf};
if(state.token&&state.user){showApp();setStatus(navigator.onLine?'● Ready':'● Offline',navigator.onLine?'ok':'bad')}else if(state.token&&!state.user){localStorage.removeItem('rrr_prod_token')}