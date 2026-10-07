const APP_BUILD='0.16';const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
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
function showApp(){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');$('#sideName').textContent=state.user.name;$('#sideRole').textContent=state.user.role;renderNav();go(allowed(state.current)?state.current:'dashboard')}
function renderNav(){$('#nav').innerHTML=NAV.filter(x=>allowed(x[0])).map(([m,i,l])=>`<button data-m="${m}">${i} &nbsp; ${l}</button>`).join('');$('#nav').querySelectorAll('button').forEach(b=>b.onclick=()=>go(b.dataset.m))}
async function go(m,force=false){if(!allowed(m))return;state.activeGridKey='';setStatus('↻ Opening '+(NAV.find(x=>x[0]===m)?.[2]||m)+'…','busy');state.current=m;sessionStorage.setItem('rrr_prod_page',m);document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.m===m));$('#pageTitle').textContent=NAV.find(x=>x[0]===m)?.[2]||m;if(m==='dashboard')return renderDashboard(force);if(m==='reports')return renderReports(force);if(m==='masters')return renderMasters(force);if(m==='users')return renderUsers(force);return renderModule(m,force)}
async function renderDashboard(force=false){const s=$('#stage');s.innerHTML=`<section class="hero"><div><h2>Production Control</h2><p>Raw fabric to warehouse handover — one traceable workflow.</p></div><div>${new Date().toLocaleDateString()}</div></section><section class="kpis">${['Raw Available','At Dye','Dyed Available','Cut Pending','At Stitching','Ready Warehouse'].map(x=>`<div class="kpi"><span>${x}</span><strong>—</strong></div>`).join('')}</section><section class="grid2"><div class="panel"><div class="panel-head"><h3>Quick Actions</h3></div><div class="quick">${[['raw','New Fabric Inward'],['dye','Issue to Dye'],['production','Plan Production'],['stitching','Create Stitch Challan'],['qc','QC Entry'],['handover','Warehouse Handover']].filter(x=>allowed(x[0])).map(x=>`<button onclick="window.ERP.quick('${x[0]}')"><b>${x[1]}</b><small>Open module</small></button>`).join('')}</div></div><div class="panel"><div class="panel-head"><h3>System</h3></div><p>Cloudflare D1 primary database</p><p>Cloudflare secure frontend & API</p><p>User-wise permissions & audit trail</p></div></section>`;try{const d=await getCachedModule('dashboard',force);state.user=d.user||d.actor||state.user;const v=d.kpis||{};[v.rawAvailable,v.atDye,v.dyedAvailable,v.cutPending,v.atStitching,v.readyWarehouse].forEach((x,i)=>document.querySelectorAll('.kpi strong')[i].textContent=x??0)}catch(e){toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}}

const prefMem=new Map(),prefTimers=new Map();
function prefLocalKey(page){return 'rrr_prod_pref_'+String(state.user?.userId||'anon')+'_'+page}
function defaultGridPrefs(columns){return{search:'',filters:{},visibleColumns:columns.filter(x=>x!=='__ACTION'),pageSize:25,page:1}}
async function loadGridPrefs(page,columns){
  const base=defaultGridPrefs(columns);let local={};
  try{local=JSON.parse(localStorage.getItem(prefLocalKey(page))||'{}')}catch{}
  const merged={...base,...local,filters:{...(base.filters||{}),...(local.filters||{})}};
  if(prefMem.has(page))return{...merged,...prefMem.get(page),filters:{...merged.filters,...(prefMem.get(page).filters||{})}};
  try{
    const r=await fetch('/api/preferences?page='+encodeURIComponent(page),{headers:{authorization:'Bearer '+state.token}});
    if(r.ok){const d=await r.json(),server=d.prefs||{};const p={...merged,...server,filters:{...merged.filters,...(server.filters||{})}};prefMem.set(page,p);localStorage.setItem(prefLocalKey(page),JSON.stringify(p));return p}
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
  const m=new Map();for(const r of items||[]){const raw=r?.[key];if(raw===undefined||raw===null||raw==='')continue;const label=gridCell(key,raw);m.set(String(raw),label)}
  return [...m.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])))
}
function applyGridData(items,prefs,filters){
  let out=[...(items||[])],q=String(prefs.search||'').trim().toLowerCase();
  if(q)out=out.filter(r=>JSON.stringify(r).toLowerCase().includes(q));
  for(const key of filters||[]){const val=String(prefs.filters?.[key]??'');if(val!=='')out=out.filter(r=>String(r?.[key]??'')===val)}
  return out
}
function gridPageNumbers(current,total){
  const set=new Set([1,total,current,current-1,current+1]);if(total>5){set.add(2);set.add(total-1)}
  return [...set].filter(x=>x>=1&&x<=total).sort((a,b)=>a-b)
}
async function mountDataGrid(container,opt){
  const key=opt.key,columns=opt.columns||[],filters=opt.filters||[],items=(opt.items||[]).map((r,i)=>({...r,__gridIndex:i}));
  let prefs=await loadGridPrefs(key,columns);
  prefs.visibleColumns=(prefs.visibleColumns||columns.filter(x=>x!=='__ACTION')).filter(x=>columns.includes(x)&&x!=='__ACTION');
  if(!prefs.visibleColumns.length)prefs.visibleColumns=columns.filter(x=>x!=='__ACTION');
  prefs.pageSize=[10,25,50,100].includes(Number(prefs.pageSize))?Number(prefs.pageSize):25;
  const rt={key,opt,items,prefs,filtered:[],pageRows:[]};state.grids[key]=rt;state.activeGridKey=key;

  function render(){
    const filtered=applyGridData(items,prefs,filters);rt.filtered=filtered;
    const pages=Math.max(1,Math.ceil(filtered.length/prefs.pageSize));prefs.page=Math.min(Math.max(1,Number(prefs.page)||1),pages);
    const start=(prefs.page-1)*prefs.pageSize,end=Math.min(start+prefs.pageSize,filtered.length),pageRows=filtered.slice(start,end);rt.pageRows=pageRows;
    const visible=prefs.visibleColumns;
    const filterHtml=filters.map(k=>`<label class="grid-filter"><span>${gridLabel(k)}</span><select data-filter="${esc(k)}"><option value="">All</option>${uniqueFilterValues(items,k).map(([v,l])=>`<option value="${esc(v)}" ${String(prefs.filters?.[k]??'')===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select></label>`).join('');
    const nums=gridPageNumbers(prefs.page,pages),buttons=[];let last=0;for(const n of nums){if(last&&n-last>1)buttons.push('<span class="page-gap">…</span>');buttons.push(`<button class="page-btn ${n===prefs.page?'active':''}" data-page="${n}">${n}</button>`);last=n}
    const head=visible.map(k=>`<th>${gridLabel(k)}</th>`).join('')+(columns.includes('__ACTION')?'<th>ACTION</th>':'');
    const body=pageRows.length?pageRows.map((r,pi)=>'<tr>'+visible.map(k=>k==='STATUS'?`<td>${badge(r[k])}</td>`:`<td>${gridCell(k,r[k])}</td>`).join('')+(columns.includes('__ACTION')?`<td>${opt.actionRenderer?opt.actionRenderer(r,pi):'—'}</td>`:'')+'</tr>').join(''):`<tr><td colspan="${visible.length+(columns.includes('__ACTION')?1:0)}">No matching records.</td></tr>`;
    container.innerHTML=`
      <div class="smart-grid-toolbar">
        <div class="grid-search-wrap"><span>⌕</span><input class="grid-search" placeholder="Search..." value="${esc(prefs.search||'')}"></div>
        <div class="grid-filters">${filterHtml}</div>
        <div class="grid-tool-wrap"><button class="grid-tool-btn column-btn">Columns ▾</button><div class="column-menu hidden">${columns.filter(k=>k!=='__ACTION').map(k=>`<label><input type="checkbox" data-col="${esc(k)}" ${visible.includes(k)?'checked':''}> ${gridLabel(k)}</label>`).join('')}</div></div>
      </div>
      <div class="grid-active-meta"><span>Showing ${filtered.length?`${start+1}–${end}`:'0'} of ${filtered.length} filtered · ${items.length} total</span><button class="clear-grid-filters ${(!prefs.search&&!Object.values(prefs.filters||{}).some(Boolean))?'hidden':''}">Clear filters</button></div>
      <div class="table-wrap"><table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="grid-footer">
        <div class="rows-control"><span>Rows per page</span><select class="page-size">${[10,25,50,100].map(n=>`<option value="${n}" ${n===prefs.pageSize?'selected':''}>${n}</option>`).join('')}</select></div>
        <div class="pagination"><button class="page-btn prev" ${prefs.page<=1?'disabled':''}>‹</button>${buttons.join('')}<button class="page-btn next" ${prefs.page>=pages?'disabled':''}>›</button></div>
        <div class="page-count">Page ${prefs.page} of ${pages}</div>
      </div>`;

    const search=container.querySelector('.grid-search');search.oninput=()=>{prefs.search=search.value;prefs.page=1;saveGridPrefs(key,prefs);render()};
    container.querySelectorAll('[data-filter]').forEach(sel=>sel.onchange=()=>{prefs.filters[sel.dataset.filter]=sel.value;prefs.page=1;saveGridPrefs(key,prefs);render()});
    const colBtn=container.querySelector('.column-btn'),colMenu=container.querySelector('.column-menu');colBtn.onclick=e=>{e.stopPropagation();colMenu.classList.toggle('hidden')};
    colMenu.onclick=e=>e.stopPropagation();
    colMenu.querySelectorAll('[data-col]').forEach(cb=>cb.onchange=()=>{const col=cb.dataset.col;if(cb.checked&&!prefs.visibleColumns.includes(col))prefs.visibleColumns.push(col);if(!cb.checked)prefs.visibleColumns=prefs.visibleColumns.filter(x=>x!==col);if(!prefs.visibleColumns.length){cb.checked=true;prefs.visibleColumns=[col]}saveGridPrefs(key,prefs);render()});
    container.querySelector('.page-size').onchange=e=>{prefs.pageSize=Number(e.target.value);prefs.page=1;saveGridPrefs(key,prefs);render()};
    container.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{prefs.page=Number(b.dataset.page);saveGridPrefs(key,prefs);render()});
    container.querySelector('.prev').onclick=()=>{if(prefs.page>1){prefs.page--;saveGridPrefs(key,prefs);render()}};
    container.querySelector('.next').onclick=()=>{if(prefs.page<pages){prefs.page++;saveGridPrefs(key,prefs);render()}};
    container.querySelector('.clear-grid-filters')?.addEventListener('click',()=>{prefs.search='';prefs.filters={};prefs.page=1;saveGridPrefs(key,prefs);render()});
    if(opt.bindActions)opt.bindActions(pageRows,container);
  }
  rt.render=render;render();return rt
}
document.addEventListener('click',e=>{if(!e.target.closest('.grid-tool-wrap'))document.querySelectorAll('.column-menu').forEach(x=>x.classList.add('hidden'));if(!e.target.closest('.export-menu-wrap'))$('#exportMenu')?.classList.add('hidden')});
const configs={
raw:{title:'Raw Fabric',columns:['ROLL_ID','INWARD_DATE','SUPPLIER','VENDOR_ROLL_NO','FABRIC','INWARD_MTR','ISSUED_MTR','BALANCE_MTR','STATUS','__ACTION'],filters:['SUPPLIER','FABRIC','STATUS'],action:'New Inward',fields:['INWARD_DATE','SUPPLIER_ID','VENDOR_ROLL_NO','FABRIC_ID','INWARD_MTR','INVOICE_CHALLAN','LOT_REF','NOTES']},
dye:{title:'Dyeing',columns:['DYE_PLAN_ID','DYE_BATCH_ID','ISSUE_DATE','DYE_VENDOR','FABRIC','COLOR','ROLL_COUNT','ISSUE_MTR','RECEIVED_MTR','VARIANCE_MTR','USABLE_MTR','PLAN_VARIANCE_MTR','STATUS','__ACTION'],filters:['DYE_VENDOR','FABRIC','COLOR','STATUS'],action:'New Dye Plan',fields:['ISSUE_DATE','DYE_VENDOR_ID','ROLL_ID','COLOR_ID','ISSUE_MTR','NOTES']},
production:{title:'Production / Cutting',columns:['PRODUCTION_BATCH_ID','PLAN_DATE','STYLE','DYE_BATCH_ID','PLANNED_QTY','ALLOCATED_MTR','TOTAL_CUT','STATUS','__ACTION'],filters:['STYLE','DYE_BATCH_ID','STATUS'],action:'New Production Batch',fields:['PLAN_DATE','DYE_BATCH_ID','STYLE_ID','PLANNED_QTY','ALLOCATED_MTR','NOTES']},
stitching:{title:'Stitching',columns:['CHALLAN_ID','ISSUE_DATE','STITCHING_VENDOR','PRODUCTION_BATCH_ID','TOTAL_ISSUED','TOTAL_RECEIVED','PENDING_QTY','STATUS','__ACTION'],filters:['STITCHING_VENDOR','PRODUCTION_BATCH_ID','STATUS'],action:'New Challan',fields:['ISSUE_DATE','STITCHING_VENDOR_ID','PRODUCTION_BATCH_ID','M_ISSUED','L_ISSUED','XL_ISSUED','2XL_ISSUED','3XL_ISSUED','OTHER_ISSUED','NOTES']},
qc:{title:'QC & Rework',columns:['QC_ID','QC_DATE','CHALLAN_ID','SIZE','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','STATUS','__ACTION'],filters:['SIZE','CHALLAN_ID','STATUS'],action:'New QC Entry',fields:['QC_DATE','CHALLAN_ID','SIZE','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','DEFECT_REASON','NOTES']},
handover:{title:'Warehouse Handover',columns:['HANDOVER_ID','HANDOVER_DATE','PRODUCTION_BATCH_ID','STYLE','COLOR','SIZE','ACCEPTED_QTY','WAREHOUSE_RECEIVED_QTY','PENDING_QTY','STATUS','__ACTION'],filters:['STYLE','COLOR','SIZE','STATUS'],action:'New Handover',fields:['HANDOVER_DATE','PRODUCTION_BATCH_ID','STYLE_ID','COLOR_ID','SIZE','ACCEPTED_QTY','WAREHOUSE_RECEIVED_QTY','WAREHOUSE_REF','NOTES']}
};
async function renderModule(m,force=false){
  const cfg=configs[m],s=$('#stage');
  s.innerHTML=`<section class="panel"><div class="panel-head"><h3>${cfg.title}</h3><button class="btn teal" id="newBtn">+ ${cfg.action}</button></div><div id="gridHost">Loading…</div></section>`;
  $('#newBtn').onclick=()=>openActionForm(m);
  try{
    const d=await getCachedModule(m,force),items=d.items||[];
    await mountDataGrid($('#gridHost'),{
      key:'module:'+m,title:cfg.title,items,columns:cfg.columns,filters:cfg.filters||[],
      actionRenderer:(r=>{
        if(m==='dye')return '<div class="row-actions">'+(!/^RECEIVED/.test(String(r.STATUS))?'<button class="btn ghost dye-receive-btn" data-idx="'+r.__gridIndex+'">Receive</button>':'')+'<button class="btn ghost dye-manage-btn" data-idx="'+r.__gridIndex+'">Manage</button></div>';
        if(m==='raw')return '<button class="btn ghost raw-manage-btn" data-idx="'+r.__gridIndex+'">Manage</button>';
        if(['production','stitching','qc','handover'].includes(m))return '<button class="btn ghost txn-cancel-btn" data-idx="'+r.__gridIndex+'">Manage</button>';
        return '—'
      }),
      bindActions:(pageRows,host)=>{
        if(m==='dye'){host.querySelectorAll('.dye-receive-btn').forEach(b=>b.onclick=()=>openDyeReceive(items[Number(b.dataset.idx)]));host.querySelectorAll('.dye-manage-btn').forEach(b=>b.onclick=()=>openDyeManage(items[Number(b.dataset.idx)]))}
        if(m==='raw')host.querySelectorAll('.raw-manage-btn').forEach(b=>b.onclick=()=>openRawManage(items[Number(b.dataset.idx)]));
        if(['production','stitching','qc','handover'].includes(m))host.querySelectorAll('.txn-cancel-btn').forEach(b=>b.onclick=()=>openTxnManage(m,items[Number(b.dataset.idx)]));
      }
    });
  }catch(e){toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}
}
function badge(v){const s=String(v||''),cl=/reject|defect|negative/i.test(s)?'danger':/pending|partial|rework|vendor/i.test(s)?'warn':'ok';return `<span class="badge ${cl}">${esc(s)}</span>`}
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
function displayCell(k,v){if(v===null||v===undefined)return'';if(/(?:MTR|METER|VARIANCE)/i.test(String(k))&&v!==''&&!Number.isNaN(Number(v)))return moneyless(v);return esc(v)}

function safeFileName(s){return String(s||'report').replace(/[^a-z0-9-_]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'report'}
function exportStamp(){const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')}
function currentPageLabel(){return NAV.find(x=>x[0]===state.current)?.[2]||$('#pageTitle')?.textContent||'Report'}
function htmlText(el){return String(el?.textContent||'').replace(/\s+/g,' ').trim()}
function getVisibleExportData(){
  const rt=state.grids[state.activeGridKey];
  if(rt&&rt.filtered){
    const title=rt.opt.title||currentPageLabel(),cols=(rt.prefs.visibleColumns||rt.opt.columns||[]).filter(k=>k!=='__ACTION');
    return{title,headers:cols.map(gridLabel),rows:rt.filtered.map(r=>cols.map(k=>String(gridCell(k,r[k]).replace?gridCell(k,r[k]).replace(/<[^>]+>/g,''):gridCell(k,r[k]))))};
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
function openTxnManage(module,row){
  const map={
    production:{id:'PRODUCTION_BATCH_ID',cancel:'production_cancel',label:'Production Batch'},
    stitching:{id:'CHALLAN_ID',cancel:'stitching_cancel',label:'Stitching Challan'},
    qc:{id:'QC_ID',cancel:'qc_cancel',label:'QC Entry'},
    handover:{id:'HANDOVER_ID',cancel:'handover_cancel',label:'Warehouse Handover'}
  },cfg=map[module];if(!cfg)return;
  const id=row[cfg.id];
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Manage ${cfg.label}</h3><small>${esc(id)} · safe correction policy</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <div class="smart-note"><b>Global dependency rule:</b> cancellation is allowed only while no downstream transaction depends on this entry. If dependency exists, the system will block it and tell you what must be reversed first.</div>
    <div class="danger-zone"><div><b>Cancel mistaken entry</b><small>Balances will recalculate automatically and the action will be audit logged.</small></div><button class="btn danger" id="cancelTxnBtn">Cancel Entry</button></div>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;
  $('#cancelTxnBtn').onclick=async()=>{
    if(!confirm('Cancel '+cfg.label+' '+id+'?'))return;const reason=prompt('Reason for cancellation:','Mistaken entry')||'Mistaken entry';
    try{await api('/api/data',{method:'POST',activity:'Cancelling entry…',success:'Entry cancelled',body:JSON.stringify({module:cfg.cancel,record:{[cfg.id]:id,REASON:reason},requestId:newRequestId()})});dropCaches();closeModal();go(module,true)}catch(err){toast(err.message,'bad',5000)}
  }
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
  const vendors=(l.vendors||[]).filter(v=>isTrue(v.STITCHING_VENDOR)&&isTrue(v.ACTIVE)),batches=l.productionBatches||[];
  if(!vendors.length)return toast('Create an active Stitching Vendor in Masters → Vendors.','bad',4200);
  if(!batches.length)return toast('No cut-piece stock is available for stitching issue. Complete cutting first.','bad',4200);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Create Stitching Challan</h3><small>Only production batches with unissued cut pieces are shown.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="stitchSmartForm"><div class="form-grid">
      <div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" required value="${todayLocal()}"></div>
      <div class="field"><label>Stitching Vendor</label><select name="STITCHING_VENDOR_ID" required><option value="">Select stitching vendor</option>${vendorOptions(vendors,'STITCHING_VENDOR')}</select></div>
      <div class="field wide"><label>Production Batch</label><select name="PRODUCTION_BATCH_ID" id="stitchBatch" required><option value="">Select cut batch</option>${batches.map(b=>`<option value="${esc(b.PRODUCTION_BATCH_ID)}">${esc(b.PRODUCTION_BATCH_ID)} · ${esc(b.STYLE_NAME||b.STYLE)} · ${esc(b.COLOR_NAME||b.COLOR_ID)} · ${moneyless(b.CUT_BALANCE)} pcs available</option>`).join('')}</select></div>
      <div class="field"><label>Available Cut Pieces</label><input id="stitchAvail" readonly value="—"></div>
      <div class="field"><label>M <small id="balM"></small></label><input name="M_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>L <small id="balL"></small></label><input name="L_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>XL <small id="balXL"></small></label><input name="XL_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>2XL <small id="bal2XL"></small></label><input name="2XL_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>3XL <small id="bal3XL"></small></label><input name="3XL_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Other <small id="balOTHER"></small></label><input name="OTHER_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field wide"><label>Notes</label><input name="NOTES"></div>
    </div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Create Challan</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#stitchBatch').onchange=e=>{const b=batches.find(x=>String(x.PRODUCTION_BATCH_ID)===String(e.target.value));$('#stitchAvail').value=b?moneyless(b.CUT_BALANCE)+' pcs':'—';const pairs=[['M','M_BALANCE'],['L','L_BALANCE'],['XL','XL_BALANCE'],['2XL','2XL_BALANCE'],['3XL','3XL_BALANCE'],['OTHER','OTHER_BALANCE']];pairs.forEach(([sz,key])=>{const bal=b?Number(b[key]||0):0;const input=$('#stitchSmartForm').elements[sz+'_ISSUED'];if(input)input.max=bal;const hint=$('#bal'+sz);if(hint)hint.textContent='· '+moneyless(bal)+' available'})};
  $('#stitchSmartForm').onsubmit=async e=>{e.preventDefault();const rec=Object.fromEntries(new FormData(e.target).entries());try{await api('/api/data',{method:'POST',activity:'Creating stitching challan…',success:'Stitching challan saved',body:JSON.stringify({module:'stitching',record:rec,requestId})});dropCaches();closeModal();go('stitching',true)}catch(err){toast(err.message,'bad',4200)}};
}

async function openQcEntry(){
  const requestId=newRequestId();let l;try{l=await getLookups(true)}catch(e){return toast(e.message,'bad',3500)}
  const challans=l.stitchingChallans||[],defects=l.defects||[];
  if(!challans.length)return toast('No stitching receipt is pending QC. Receive garments from stitching first.','bad',4500);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>QC Entry</h3><small>Only received pieces still pending QC are selectable.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="qcSmartForm"><div class="form-grid">
      <div class="field"><label>QC Date</label><input name="QC_DATE" type="date" required value="${todayLocal()}"></div>
      <div class="field"><label>Stitching Challan</label><select name="CHALLAN_ID" id="qcChallan" required><option value="">Select challan</option>${challans.map(x=>`<option value="${esc(x.CHALLAN_ID)}">${esc(x.CHALLAN_ID)} · ${esc(x.VENDOR_NAME)} · ${esc(x.STYLE_NAME)} · ${moneyless(x.QC_PENDING)} pcs pending QC</option>`).join('')}</select></div>
      <div class="field"><label>Pending QC Qty</label><input id="qcPending" readonly value="—"></div>
      <div class="field"><label>Size</label><select name="SIZE" id="qcSize" required><option value="">Select challan first</option></select></div>
      <div class="field"><label>QC Qty</label><input name="QC_QTY" id="qcQty" type="number" min="1" step="1" required></div>
      <div class="field"><label>Pass</label><input name="PASS_QTY" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Rework</label><input name="REWORK_QTY" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Reject</label><input name="REJECT_QTY" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Defect Reason</label><select name="DEFECT_REASON"><option value="">Select reason</option>${defects.map(d=>`<option value="${esc(d.DEFECT_NAME)}">${esc(d.DEFECT_NAME)}${d.STAGE?' · '+esc(d.STAGE):''}</option>`).join('')}</select></div>
      <div class="field wide"><label>Notes</label><input name="NOTES"></div>
    </div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save QC</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#qcChallan').onchange=e=>{const x=challans.find(z=>String(z.CHALLAN_ID)===String(e.target.value));$('#qcPending').value=x?moneyless(x.QC_PENDING)+' pcs':'—';const sizes=[['M','M_QC_PENDING'],['L','L_QC_PENDING'],['XL','XL_QC_PENDING'],['2XL','2XL_QC_PENDING'],['3XL','3XL_QC_PENDING'],['OTHER','OTHER_QC_PENDING']];const sel=$('#qcSize');sel.innerHTML='<option value="">Select size</option>'+(x?sizes.filter(([s,k])=>Number(x[k]||0)>0).map(([s,k])=>'<option value="'+s+'">'+s+' · '+moneyless(x[k])+' pending</option>').join(''):'');$('#qcQty').value='';$('#qcQty').max=''};$('#qcSize').onchange=e=>{const x=challans.find(z=>String(z.CHALLAN_ID)===String($('#qcChallan').value));const key={M:'M_QC_PENDING',L:'L_QC_PENDING',XL:'XL_QC_PENDING','2XL':'2XL_QC_PENDING','3XL':'3XL_QC_PENDING',OTHER:'OTHER_QC_PENDING'}[e.target.value];const bal=x&&key?Number(x[key]||0):0;$('#qcQty').max=bal;$('#qcQty').value=bal?moneyless(bal):''};
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

async function renderReports(force=false){try{const d=await getCachedModule('reports',force),v=d.kpis||{};$('#stage').innerHTML=`<section class="panel"><div class="panel-head"><h3>Production Reports</h3></div><div class="kpis">${Object.entries(v).map(([k,x])=>`<div class="kpi"><span>${k}</span><strong>${x}</strong></div>`).join('')}</div></section>`}catch(e){toast(e.message,'bad',3500)}}
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