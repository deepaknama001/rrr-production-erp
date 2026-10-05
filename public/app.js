const $=s=>document.querySelector(s);const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
function storedUser(){try{return JSON.parse(localStorage.getItem('rrr_prod_user')||'null')}catch{return null}}
const state={token:localStorage.getItem('rrr_prod_token')||'',user:storedUser(),current:sessionStorage.getItem('rrr_prod_page')||'dashboard',refreshing:false,netCount:0,lastButton:null,lastButtonAt:0};
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
async function go(m,force=false){if(!allowed(m))return;setStatus('↻ Opening '+(NAV.find(x=>x[0]===m)?.[2]||m)+'…','busy');state.current=m;sessionStorage.setItem('rrr_prod_page',m);document.querySelectorAll('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.m===m));$('#pageTitle').textContent=NAV.find(x=>x[0]===m)?.[2]||m;if(m==='dashboard')return renderDashboard(force);if(m==='reports')return renderReports(force);if(m==='masters')return renderMasters(force);if(m==='users')return renderUsers(force);return renderModule(m,force)}
async function renderDashboard(force=false){const s=$('#stage');s.innerHTML=`<section class="hero"><div><h2>Production Control</h2><p>Raw fabric to warehouse handover — one traceable workflow.</p></div><div>${new Date().toLocaleDateString()}</div></section><section class="kpis">${['Raw Available','At Dye','Dyed Available','Cut Pending','At Stitching','Ready Warehouse'].map(x=>`<div class="kpi"><span>${x}</span><strong>—</strong></div>`).join('')}</section><section class="grid2"><div class="panel"><div class="panel-head"><h3>Quick Actions</h3></div><div class="quick">${[['raw','New Fabric Inward'],['dye','Issue to Dye'],['production','Plan Production'],['stitching','Create Stitch Challan'],['qc','QC Entry'],['handover','Warehouse Handover']].filter(x=>allowed(x[0])).map(x=>`<button onclick="window.ERP.quick('${x[0]}')"><b>${x[1]}</b><small>Open module</small></button>`).join('')}</div></div><div class="panel"><div class="panel-head"><h3>System</h3></div><p>Google Sheets permanent database</p><p>Cloudflare secure frontend</p><p>User-wise permissions & audit trail</p></div></section>`;try{const d=await getCachedModule('dashboard',force);state.user=d.user||d.actor||state.user;const v=d.kpis||{};[v.rawAvailable,v.atDye,v.dyedAvailable,v.cutPending,v.atStitching,v.readyWarehouse].forEach((x,i)=>document.querySelectorAll('.kpi strong')[i].textContent=x??0)}catch(e){toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}}
const configs={raw:{title:'Raw Fabric',columns:['ROLL_ID','INWARD_DATE','SUPPLIER','VENDOR_ROLL_NO','FABRIC','INWARD_MTR','STATUS'],action:'New Inward',fields:['INWARD_DATE','SUPPLIER_ID','VENDOR_ROLL_NO','FABRIC_ID','INWARD_MTR','INVOICE_CHALLAN','LOT_REF','NOTES']},dye:{title:'Dyeing',columns:['DYE_BATCH_ID','ISSUE_DATE','DYE_VENDOR','ROLL_ID','COLOR','ISSUE_MTR','USABLE_MTR','STATUS'],action:'New Dye Issue',fields:['ISSUE_DATE','DYE_VENDOR_ID','ROLL_ID','COLOR_ID','ISSUE_MTR','NOTES']},production:{title:'Production / Cutting',columns:['PRODUCTION_BATCH_ID','PLAN_DATE','STYLE','DYE_BATCH_ID','PLANNED_QTY','ALLOCATED_MTR','TOTAL_CUT','STATUS'],action:'New Production Batch',fields:['PLAN_DATE','DYE_BATCH_ID','STYLE_ID','PLANNED_QTY','ALLOCATED_MTR','NOTES']},stitching:{title:'Stitching',columns:['CHALLAN_ID','ISSUE_DATE','STITCHING_VENDOR','PRODUCTION_BATCH_ID','TOTAL_ISSUED','TOTAL_RECEIVED','PENDING_QTY','STATUS'],action:'New Challan',fields:['ISSUE_DATE','STITCHING_VENDOR_ID','PRODUCTION_BATCH_ID','M_ISSUED','L_ISSUED','XL_ISSUED','2XL_ISSUED','3XL_ISSUED','OTHER_ISSUED','NOTES']},qc:{title:'QC & Rework',columns:['QC_ID','QC_DATE','CHALLAN_ID','SIZE','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','STATUS'],action:'New QC Entry',fields:['QC_DATE','CHALLAN_ID','SIZE','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','DEFECT_REASON','NOTES']},handover:{title:'Warehouse Handover',columns:['HANDOVER_ID','HANDOVER_DATE','PRODUCTION_BATCH_ID','STYLE','COLOR','SIZE','ACCEPTED_QTY','WAREHOUSE_RECEIVED_QTY','PENDING_QTY','STATUS'],action:'New Handover',fields:['HANDOVER_DATE','PRODUCTION_BATCH_ID','STYLE_ID','COLOR_ID','SIZE','ACCEPTED_QTY','WAREHOUSE_RECEIVED_QTY','WAREHOUSE_REF','NOTES']}};
async function renderModule(m,force=false){const c=configs[m],s=$('#stage');s.innerHTML=`<section class="panel"><div class="panel-head"><h3>${c.title}</h3><button class="btn teal" id="newBtn">+ ${c.action}</button></div><div class="toolbar"><input class="search" id="searchBox" placeholder="Search..."></div><div class="table-wrap"><table class="data"><thead><tr>${c.columns.map(x=>'<th>'+x.replaceAll('_',' ')+'</th>').join('')}</tr></thead><tbody id="rows"><tr><td colspan="${c.columns.length}">Loading…</td></tr></tbody></table></div></section>`;$('#newBtn').onclick=()=>openActionForm(m);try{const d=await getCachedModule(m,force);drawRows(c,d.items||[]);$('#searchBox').oninput=e=>drawRows(c,(d.items||[]).filter(r=>JSON.stringify(r).toLowerCase().includes(e.target.value.toLowerCase())))}catch(e){drawRows(c,[]);toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}}
function drawRows(c,items){$('#rows').innerHTML=items.length?items.map(r=>'<tr>'+c.columns.map(k=>`<td>${k==='STATUS'?badge(r[k]):esc(r[k])}</td>`).join('')+'</tr>').join(''):`<tr><td colspan="${c.columns.length}">No records yet.</td></tr>`}
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
function moneyless(n){const x=Number(n||0);return Number.isInteger(x)?String(x):x.toFixed(2)}
function vendorOptions(vendors,role){return (vendors||[]).filter(v=>isTrue(v.ACTIVE)&&(!role||isTrue(v[role]))).map(v=>`<option value="${esc(v.VENDOR_ID)}">${esc(v.VENDOR_NAME)}${role?'':''}</option>`).join('')}
function colorOptions(colors){return (colors||[]).filter(x=>isTrue(x.ACTIVE)).map(x=>`<option value="${esc(x.COLOR_ID)}">${esc(x.COLOR_NAME)}${x.COLOR_CODE?' · '+esc(x.COLOR_CODE):''}</option>`).join('')}
function styleOptions(styles){return (styles||[]).filter(x=>isTrue(x.ACTIVE)).map(x=>`<option value="${esc(x.STYLE_ID)}">${esc(x.STYLE_NAME)}${x.STYLE_CODE?' · '+esc(x.STYLE_CODE):''}</option>`).join('')}
function smartEmpty(msg){return `<div class="smart-empty"><b>Nothing available</b><span>${esc(msg)}</span></div>`}



async function openDyeIssue(){
  const requestId=newRequestId();let l;
  try{l=await getLookups(false)}catch(e){return toast(e.message,'bad',3500)}
  const dyeVendors=(l.vendors||[]).filter(v=>isTrue(v.DYE_VENDOR)&&isTrue(v.ACTIVE));
  const rolls=(l.rawRolls||[]).filter(r=>Number(r.BALANCE_MTR)>0);
  const colors=(l.colors||[]).filter(c=>isTrue(c.ACTIVE));
  if(!dyeVendors.length)return toast('Create at least one active Dye Vendor in Masters → Vendors.','bad',4200);
  if(!colors.length)return toast('Create at least one active Color in Masters → Colors.','bad',4200);
  if(!rolls.length)return toast('No raw fabric roll has available balance for dyeing.','bad',4200);
  const rollOptions=arr=>arr.map(r=>`<option value="${esc(r.ROLL_ID)}">${esc(r.FABRIC_NAME||r.FABRIC)} · Vendor Roll ${esc(r.VENDOR_ROLL_NO||'-')} · ${moneyless(r.BALANCE_MTR)} m available</option>`).join('');
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>New Dye Issue</h3><small>Create one dye batch from one fabric type. Multiple source rolls are allowed.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="dyeBulkForm">
      <div class="form-grid">
        <div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" required value="${todayLocal()}"></div>
        <div class="field"><label>Dye Vendor</label><select name="DYE_VENDOR_ID" required><option value="">Select dye vendor</option>${vendorOptions(dyeVendors,'DYE_VENDOR')}</select></div>
        <div class="field"><label>Color</label><select name="COLOR_ID" required><option value="">Select color</option>${colorOptions(colors)}</select></div>
        <div class="field"><label>Batch Fabric</label><input id="dyeBatchFabric" value="Select first roll" readonly></div>
        <div class="field wide"><label>Notes</label><input name="NOTES"></div>
      </div>
      <div class="roll-head"><div><b>Source Rolls</b><small>Only rolls with remaining balance are shown. Full-issued rolls disappear automatically.</small></div><button type="button" class="btn teal" id="addDyeRoll">+ Add Roll</button></div>
      <div class="roll-table"><table class="data"><thead><tr><th>#</th><th>Raw Roll</th><th>Available</th><th>Issue Meter</th><th></th></tr></thead><tbody id="dyeRollRows"></tbody></table></div>
      <div class="roll-summary"><span>Selected Rolls <b id="dyeRollCount">0</b></span><span>Total Issue <b id="dyeTotal">0.00</b> m</span></div>
      <div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save Dye Issue</button></div>
    </form>`;
  $('#modal').classList.remove('hidden');
  let batchFabric='';
  function updateSummary(){const trs=[...$('#dyeRollRows').children];$('#dyeRollCount').textContent=trs.length;$('#dyeTotal').textContent=trs.reduce((s,tr)=>s+(Number(tr.querySelector('.dye-qty').value)||0),0).toFixed(2)}
  function addRow(){
    const tr=document.createElement('tr'),n=$('#dyeRollRows').children.length+1;
    tr.innerHTML=`<td class="dye-no">${n}</td><td><select class="dye-roll" required><option value="">Select available roll</option>${rollOptions(rolls)}</select></td><td class="dye-avail">—</td><td><input class="dye-qty" type="number" min="0.01" step="0.01" required placeholder="0.00"></td><td><button type="button" class="icon-remove">×</button></td>`;
    $('#dyeRollRows').appendChild(tr);
    const sel=tr.querySelector('.dye-roll'),qty=tr.querySelector('.dye-qty');
    sel.onchange=()=>{
      const rr=rolls.find(x=>String(x.ROLL_ID)===String(sel.value));
      if(!rr){tr.querySelector('.dye-avail').textContent='—';return}
      const used=[...$('#dyeRollRows .dye-roll')].filter(x=>x!==sel).some(x=>x.value===sel.value);
      if(used){toast('This roll is already selected in this batch.','bad',3000);sel.value='';return}
      if(batchFabric&&String(rr.FABRIC_ID)!==String(batchFabric)){toast('Different fabric type cannot be mixed in the same dye batch. Create a separate dye batch.','bad',4200);sel.value='';return}
      if(!batchFabric){batchFabric=String(rr.FABRIC_ID);$('#dyeBatchFabric').value=rr.FABRIC_NAME||rr.FABRIC||rr.FABRIC_ID}
      tr.querySelector('.dye-avail').textContent=moneyless(rr.BALANCE_MTR)+' m';qty.max=rr.BALANCE_MTR;qty.value=moneyless(rr.BALANCE_MTR);updateSummary();
    };
    qty.oninput=updateSummary;
    tr.querySelector('.icon-remove').onclick=()=>{tr.remove();[...$('#dyeRollRows').children].forEach((x,i)=>x.querySelector('.dye-no').textContent=i+1);if(!$('#dyeRollRows').children.length){batchFabric='';$('#dyeBatchFabric').value='Select first roll'}updateSummary()};
    updateSummary();
  }
  $('#addDyeRoll').onclick=addRow;$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;addRow();
  $('#dyeBulkForm').onsubmit=async e=>{
    e.preventDefault();const base=Object.fromEntries(new FormData(e.target).entries());
    const items=[...$('#dyeRollRows').children].map(tr=>({ROLL_ID:tr.querySelector('.dye-roll').value,ISSUE_MTR:tr.querySelector('.dye-qty').value}));
    if(!items.length)return toast('Add at least one roll.','bad');
    try{const d=await api('/api/data',{method:'POST',activity:'Creating dye batch…',success:'Dye issue saved',body:JSON.stringify({module:'dye_bulk',record:{...base,items},requestId})});dropCaches();closeModal();toast(`Dye Batch ${d.record.DYE_BATCH_ID} saved · ${d.record.ROLL_COUNT} roll(s) · ${moneyless(d.record.TOTAL_MTR)} m`,'ok',4200);go('dye',true)}catch(err){toast(err.message,'bad',4200)}
  };
}

async function openProductionPlan(){
  const requestId=newRequestId();let l;try{l=await getLookups(false)}catch(e){return toast(e.message,'bad',3500)}
  const batches=l.dyeBatches||[],styles=l.styles||[];
  if(!batches.length)return toast('No dyed usable stock is available. Dye receipt must be completed before production allocation.','bad',4500);
  if(!styles.length)return toast('Create active Styles in Masters first.','bad',3500);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>Plan Production</h3><small>Allocate only usable dyed stock. Balance is enforced automatically.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="prodSmartForm"><div class="form-grid">
      <div class="field"><label>Plan Date</label><input name="PLAN_DATE" type="date" required value="${todayLocal()}"></div>
      <div class="field"><label>Dyed Batch</label><select name="DYE_BATCH_ID" id="prodBatch" required><option value="">Select dyed batch</option>${batches.map(b=>`<option value="${esc(b.DYE_BATCH_ID)}">${esc(b.DYE_BATCH_ID)} · ${esc(b.FABRIC_NAME)} · ${esc(b.COLOR_NAME)} · ${moneyless(b.BALANCE_MTR)} m available</option>`).join('')}</select></div>
      <div class="field"><label>Style / Product</label><select name="STYLE_ID" required><option value="">Select style</option>${styleOptions(styles)}</select></div>
      <div class="field"><label>Available Dyed Meter</label><input id="prodAvail" readonly value="—"></div>
      <div class="field"><label>Planned Garment Qty</label><input name="PLANNED_QTY" type="number" min="1" step="1"></div>
      <div class="field"><label>Allocate Meter</label><input name="ALLOCATED_MTR" id="prodAlloc" type="number" min="0.01" step="0.01" required></div>
      <div class="field wide"><label>Notes</label><input name="NOTES"></div>
    </div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save Production Plan</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#prodBatch').onchange=e=>{const b=batches.find(x=>String(x.DYE_BATCH_ID)===String(e.target.value));$('#prodAvail').value=b?moneyless(b.BALANCE_MTR)+' m':'—';$('#prodAlloc').max=b?b.BALANCE_MTR:''};
  $('#prodSmartForm').onsubmit=async e=>{e.preventDefault();const rec=Object.fromEntries(new FormData(e.target).entries());try{await api('/api/data',{method:'POST',activity:'Saving production plan…',success:'Production plan saved',body:JSON.stringify({module:'production',record:rec,requestId})});dropCaches();closeModal();go('production',true)}catch(err){toast(err.message,'bad',4200)}};
}

async function openStitchingIssue(){
  const requestId=newRequestId();let l;try{l=await getLookups(false)}catch(e){return toast(e.message,'bad',3500)}
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
      <div class="field"><label>M</label><input name="M_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>L</label><input name="L_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>XL</label><input name="XL_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>2XL</label><input name="2XL_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>3XL</label><input name="3XL_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Other</label><input name="OTHER_ISSUED" type="number" min="0" step="1" value="0"></div>
      <div class="field wide"><label>Notes</label><input name="NOTES"></div>
    </div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Create Challan</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#stitchBatch').onchange=e=>{const b=batches.find(x=>String(x.PRODUCTION_BATCH_ID)===String(e.target.value));$('#stitchAvail').value=b?moneyless(b.CUT_BALANCE)+' pcs':'—'};
  $('#stitchSmartForm').onsubmit=async e=>{e.preventDefault();const rec=Object.fromEntries(new FormData(e.target).entries());try{await api('/api/data',{method:'POST',activity:'Creating stitching challan…',success:'Stitching challan saved',body:JSON.stringify({module:'stitching',record:rec,requestId})});dropCaches();closeModal();go('stitching',true)}catch(err){toast(err.message,'bad',4200)}};
}

async function openQcEntry(){
  const requestId=newRequestId();let l;try{l=await getLookups(false)}catch(e){return toast(e.message,'bad',3500)}
  const challans=l.stitchingChallans||[],defects=l.defects||[];
  if(!challans.length)return toast('No stitching receipt is pending QC. Receive garments from stitching first.','bad',4500);
  $('#modalBody').innerHTML=`
    <div class="panel-head"><div><h3>QC Entry</h3><small>Only received pieces still pending QC are selectable.</small></div><button class="btn ghost" id="closeModal">Close</button></div>
    <form id="qcSmartForm"><div class="form-grid">
      <div class="field"><label>QC Date</label><input name="QC_DATE" type="date" required value="${todayLocal()}"></div>
      <div class="field"><label>Stitching Challan</label><select name="CHALLAN_ID" id="qcChallan" required><option value="">Select challan</option>${challans.map(x=>`<option value="${esc(x.CHALLAN_ID)}">${esc(x.CHALLAN_ID)} · ${esc(x.VENDOR_NAME)} · ${esc(x.STYLE_NAME)} · ${moneyless(x.QC_PENDING)} pcs pending QC</option>`).join('')}</select></div>
      <div class="field"><label>Pending QC Qty</label><input id="qcPending" readonly value="—"></div>
      <div class="field"><label>Size</label><select name="SIZE" required><option value="">Select size</option>${(l.sizes||[]).map(s=>`<option value="${esc(s.SIZE_NAME)}">${esc(s.SIZE_NAME)}</option>`).join('')}</select></div>
      <div class="field"><label>QC Qty</label><input name="QC_QTY" id="qcQty" type="number" min="1" step="1" required></div>
      <div class="field"><label>Pass</label><input name="PASS_QTY" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Rework</label><input name="REWORK_QTY" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Reject</label><input name="REJECT_QTY" type="number" min="0" step="1" value="0"></div>
      <div class="field"><label>Defect Reason</label><select name="DEFECT_REASON"><option value="">Select reason</option>${defects.map(d=>`<option value="${esc(d.DEFECT_NAME)}">${esc(d.DEFECT_NAME)}${d.STAGE?' · '+esc(d.STAGE):''}</option>`).join('')}</select></div>
      <div class="field wide"><label>Notes</label><input name="NOTES"></div>
    </div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save QC</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;
  $('#qcChallan').onchange=e=>{const x=challans.find(z=>String(z.CHALLAN_ID)===String(e.target.value));$('#qcPending').value=x?moneyless(x.QC_PENDING)+' pcs':'—';$('#qcQty').max=x?x.QC_PENDING:''};
  $('#qcSmartForm').onsubmit=async e=>{e.preventDefault();const rec=Object.fromEntries(new FormData(e.target).entries());try{await api('/api/data',{method:'POST',activity:'Saving QC result…',success:'QC saved',body:JSON.stringify({module:'qc',record:rec,requestId})});dropCaches();closeModal();go('qc',true)}catch(err){toast(err.message,'bad',4200)}};
}

async function openWarehouseHandover(){
  const requestId=newRequestId();let l;try{l=await getLookups(false)}catch(e){return toast(e.message,'bad',3500)}
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
  const suppliers=(l.vendors||[]).filter(v=>v.FABRIC_SUPPLIER===true||String(v.FABRIC_SUPPLIER).toLowerCase()==='true');
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
  try{const d=await getCachedModule('masters',force);mastersCache=d.masters||{};drawMasterTabs();drawMasterTable();$('#masterAdd').onclick=()=>openMasterForm(masterTab,null)}catch(e){toast(e.message,'bad',3500)}finally{setStatus('● Ready','ok')}
}
function drawMasterTabs(){$('#masterTabs').innerHTML=Object.entries(MASTER_CFG).map(([k,v])=>`<button class="${k===masterTab?'active':''}" data-k="${k}">${v.label}</button>`).join('');$('#masterTabs').querySelectorAll('button').forEach(b=>b.onclick=()=>{masterTab=b.dataset.k;drawMasterTabs();drawMasterTable()})}
function masterItems(type){const key={vendor:'vendors',fabric:'fabrics',color:'colors',style:'styles',size:'sizes',defect:'defects'}[type];return mastersCache?.[key]||[]}
function boolText(v){return v===true||String(v).toLowerCase()==='true'?'Yes':'No'}
function drawMasterTable(){const cfg=MASTER_CFG[masterTab],items=masterItems(masterTab);$('#masterContent').innerHTML=`<div class="table-wrap"><table class="data"><thead><tr>${cfg.cols.map(c=>'<th>'+c.replaceAll('_',' ')+'</th>').join('')}<th>ACTION</th></tr></thead><tbody>${items.length?items.map((r,i)=>'<tr>'+cfg.cols.map(k=>`<td>${['ACTIVE','FABRIC_SUPPLIER','DYE_VENDOR','STITCHING_VENDOR','CUTTING_VENDOR'].includes(k)?boolText(r[k]):esc(r[k])}</td>`).join('')+`<td><button class="btn ghost master-edit" data-i="${i}">Edit</button></td></tr>`).join(''):`<tr><td colspan="${cfg.cols.length+1}">No records yet.</td></tr>`}</tbody></table></div>`;document.querySelectorAll('.master-edit').forEach(b=>b.onclick=()=>openMasterForm(masterTab,items[Number(b.dataset.i)]))}
async function openMasterForm(type,row){
  const requestId=newRequestId(),cfg=MASTER_CFG[type],editing=!!row,l=await getLookups(false),f=[];
  if(type==='vendor')f.push(['VENDOR_NAME','text'],['FABRIC_SUPPLIER','check'],['DYE_VENDOR','check'],['STITCHING_VENDOR','check'],['CUTTING_VENDOR','check'],['PHONE','text'],['GST_REF','text'],['ADDRESS','text'],['ACTIVE','check']);
  if(type==='fabric')f.push(['FABRIC_NAME','text'],['FABRIC_CODE','text'],['UOM','text'],['NOTES','text'],['ACTIVE','check']);
  if(type==='color')f.push(['COLOR_NAME','text'],['COLOR_CODE','text'],['ACTIVE','check']);
  if(type==='style')f.push(['STYLE_NAME','text'],['CATEGORY','text'],['STYLE_CODE','text'],['DEFAULT_FABRIC_ID','fabric'],['NOTES','text'],['ACTIVE','check']);
  if(type==='size')f.push(['SIZE_NAME','text'],['SORT_ORDER','number'],['ACTIVE','check']);
  if(type==='defect')f.push(['DEFECT_NAME','text'],['STAGE','text'],['CATEGORY','text'],['NOTES','text'],['ACTIVE','check']);
  function control([k,t]){const val=row?.[k]??'';if(t==='check')return `<div class="field"><label><input type="checkbox" name="${k}" ${(!editing&&k==='ACTIVE')||val===true||String(val).toLowerCase()==='true'?'checked':''}> ${k.replaceAll('_',' ')}</label></div>`;if(t==='fabric')return `<div class="field"><label>${k.replaceAll('_',' ')}</label><select name="${k}"><option value="">Select fabric</option>${(l.fabrics||[]).map(x=>`<option value="${esc(x.FABRIC_ID)}" ${String(x.FABRIC_ID)===String(val)?'selected':''}>${esc(x.FABRIC_NAME)}</option>`).join('')}</select></div>`;return `<div class="field"><label>${k.replaceAll('_',' ')}</label><input name="${k}" type="${t}" value="${esc(val)}"></div>`}
  $('#modalBody').innerHTML=`<div class="panel-head"><h3>${editing?'Edit':'Add'} ${cfg.label.replace(/s$/,'')}</h3><button class="btn ghost" id="closeModal">Close</button></div><form id="masterForm"><div class="form-grid">${f.map(control).join('')}</div><div class="form-actions"><button type="button" class="btn ghost" id="cancelModal">Cancel</button><button class="btn primary">Save</button></div></form>`;
  $('#modal').classList.remove('hidden');$('#closeModal').onclick=$('#cancelModal').onclick=closeModal;$('#masterForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),rec={entity:type};if(editing)rec[cfg.id]=row[cfg.id];for(const [k,t] of f){rec[k]=t==='check'?fd.has(k):(fd.get(k)||'')}try{await api('/api/data',{method:'POST',activity:'Saving '+cfg.label.replace(/s$/,'')+'…',success:cfg.label.replace(/s$/,'')+' saved',body:JSON.stringify({module:'master',record:rec,requestId})});dropCaches();closeModal();const d=await getCachedModule('masters',true);mastersCache=d.masters||{};drawMasterTable()}catch(err){toast(err.message,'bad',3500)}}
}

async function renderReports(force=false){try{const d=await getCachedModule('reports',force),v=d.kpis||{};$('#stage').innerHTML=`<section class="panel"><div class="panel-head"><h3>Production Reports</h3></div><div class="kpis">${Object.entries(v).map(([k,x])=>`<div class="kpi"><span>${k}</span><strong>${x}</strong></div>`).join('')}</div></section>`}catch(e){toast(e.message,'bad',3500)}}
async function renderUsers(force=false){$('#stage').innerHTML='<section class="panel"><div class="panel-head"><h3>User Management</h3><button class="btn teal" onclick="window.ERP.newUser()">+ Add User</button></div><div class="table-wrap"><table class="data"><thead><tr><th>User ID</th><th>Name</th><th>Role</th><th>Admin</th><th>Active</th></tr></thead><tbody id="userRows"></tbody></table></div></section>';try{let d;if(!force){const c=readCache('users');d=c&&c.data}if(!d){d=await api('/api/users');writeCache('users',d)}$('#userRows').innerHTML=(d.items||[]).map(u=>`<tr><td>${esc(u.userId)}</td><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td>${u.admin?'Yes':'No'}</td><td>${u.active?'Active':'Disabled'}</td></tr>`).join('')}catch(e){toast(e.message,'bad',3500)}}
function newUser(){const requestId=newRequestId(),f=['userId','name','pin','role'];$('#modalBody').innerHTML=`<div class="panel-head"><h3>Add User</h3><button id="closeModal" class="btn ghost">Close</button></div><form id="uForm"><div class="form-grid">${f.map(x=>`<div class="field"><label>${x.toUpperCase()}</label><input name="${x}" ${x==='pin'?'type="password"':''}></div>`).join('')}<div class="field"><label><input type="checkbox" name="admin"> Admin</label></div>${['raw','dye','production','stitching','qc','reports'].map(p=>`<div class="field"><label><input type="checkbox" name="perm_${p}"> ${p.toUpperCase()}</label></div>`).join('')}</div><div class="form-actions"><button class="btn primary">Save User</button></div></form>`;$('#modal').classList.remove('hidden');$('#closeModal').onclick=closeModal;$('#uForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target),b={};for(const[k,v]of fd.entries())b[k]=v==='on'?true:v;['admin','perm_raw','perm_dye','perm_production','perm_stitching','perm_qc','perm_reports'].forEach(k=>b[k]=!!b[k]);b.active=true;try{await api('/api/users',{method:'POST',activity:'Saving user…',success:'User saved',body:JSON.stringify({...b,requestId})});dropCaches();closeModal();renderUsers(true)}catch(err){toast(err.message,'bad',3500)}}}
$('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginError').textContent='';try{const d=await api('/api/login',{method:'POST',activity:'Logging in…',success:'Login successful',body:JSON.stringify({userId:$('#userId').value,pin:$('#pin').value})});state.token=d.token;state.user=d.user;localStorage.setItem('rrr_prod_token',d.token);localStorage.setItem('rrr_prod_user',JSON.stringify(d.user));dropCaches();if(d.kpis)writeCache('dashboard',{user:d.user,kpis:d.kpis});showApp()}catch(err){$('#loginError').textContent=err.message}}
$('#logoutBtn').onclick=()=>{localStorage.removeItem('rrr_prod_token');localStorage.removeItem('rrr_prod_user');sessionStorage.clear();location.reload()};async function refreshCurrent(){if(state.refreshing)return;state.refreshing=true;const b=$('#refreshBtn');b?.classList.add('spinning');setStatus('↻ Refreshing…','busy');try{dropCaches();await go(state.current,true);setStatus('● Updated just now','ok')}catch(e){setStatus('● Refresh failed','bad');if(e.status===401){localStorage.removeItem('rrr_prod_token');localStorage.removeItem('rrr_prod_user');location.reload()}else toast(e.message,'bad',3500)}finally{state.refreshing=false;b?.classList.remove('spinning')}}
$('#refreshBtn')?.addEventListener('click',refreshCurrent);
window.addEventListener('online',()=>setStatus('● Online','ok'));window.addEventListener('offline',()=>setStatus('● Offline','bad'));
window.ERP={quick:m=>go(m).then(()=>setTimeout(()=>$('#newBtn')?.click(),50)),newUser,refresh:refreshCurrent};
if(state.token&&state.user){showApp();setStatus(navigator.onLine?'● Ready':'● Offline',navigator.onLine?'ok':'bad')}else if(state.token&&!state.user){localStorage.removeItem('rrr_prod_token')}