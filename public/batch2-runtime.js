(function(){
'use strict';
const BUILD='0.52';
const MOD_BY_TITLE={
  'Raw Fabric':'raw','Dyeing':'dye','Production':'production','Production / Cutting':'production',
  'Stitching':'stitching','Cutting & Stitching':'stitching','QC & Rework':'qc','Warehouse Handover':'handover'
};
const ID_COL={raw:'ROLL_ID',dye:'DYE_BATCH_ID',production:'PRODUCTION_BATCH_ID',stitching:'CHALLAN_ID',qc:'QC_ID',handover:'HANDOVER_ID'};
const EXPECT_FORMS=['dyePlanForm','stitchSmartForm','stitchEditForm','rwIssueForm'];
let scanQueued=false;

function token(){return localStorage.getItem('rrr_prod_token')||''}
function storedUser(){try{return JSON.parse(localStorage.getItem('rrr_prod_user')||'null')}catch{return null}}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function api(path,opt={}){
  const h={...(opt.headers||{})};if(token())h.authorization='Bearer '+token();
  if(opt.body&&!(opt.body instanceof FormData)&&!h['content-type'])h['content-type']='application/json';
  return fetch(path,{...opt,headers:h}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Request failed');return d})
}
function fmt(v){if(!v)return'—';const m=String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'-'+m[2]+'-'+m[1]:String(v)}
function toast(msg,bad=false){
  const host=document.getElementById('toastHost');if(!host)return;
  const el=document.createElement('div');el.className='app-toast '+(bad?'bad':'ok');el.innerHTML='<b>'+esc(msg)+'</b>';
  host.appendChild(el);requestAnimationFrame(()=>el.classList.add('show'));setTimeout(()=>{el.classList.remove('show');setTimeout(()=>el.remove(),220)},2600)
}
function currentModule(){return MOD_BY_TITLE[(document.getElementById('pageTitle')?.textContent||'').trim()]||''}
function canAudit(){
  const u=storedUser();if(!u)return false;if(u.admin)return true;
  return !!u.permissions?.reports && (!u.actions?.reports || u.actions.reports.audit!==false);
}
function updateBuild(){
  const x=document.getElementById('appVersion');if(x&&x.textContent!=='v'+BUILD)x.textContent='v'+BUILD;
}

function injectExpectedField(){
  for(const id of EXPECT_FORMS){
    const f=document.getElementById(id);if(!f||f.querySelector('[name="EXPECTED_DATE"]'))continue;
    const firstDate=f.querySelector('input[type="date"]');const holder=firstDate?.closest('.field');if(!holder)continue;
    const div=document.createElement('div');div.className='field batch2-due-field';
    div.innerHTML='<label>Expected Return</label><input name="EXPECTED_DATE" type="date">';
    holder.after(div);
  }
}

function inferManageRecord(){
  const body=document.getElementById('modalBody');if(!body)return null;
  if(body.dataset.recordModule&&body.dataset.recordId)return{module:body.dataset.recordModule,id:body.dataset.recordId};
  const h=(body.querySelector('.panel-head h3')?.textContent||'').trim();
  const small=(body.querySelector('.panel-head small')?.textContent||'').trim();
  const id=(small.split('·')[0]||'').trim();
  if(h==='Manage Dye Batch'&&id)return{module:'dye',id};
  return null;
}
async function mountExpectationPanel(){
  const rec=inferManageRecord(),body=document.getElementById('modalBody');if(!rec||!body||body.querySelector('.batch2-expectation-panel'))return;
  const panel=document.createElement('section');panel.className='subsection batch2-expectation-panel';
  panel.innerHTML='<div class="batch2-section-head"><h4>Expected Return / Ageing</h4><small>Loading…</small></div><div class="batch2-inline-state">Loading due date…</div>';
  const head=body.querySelector('.panel-head');head?.after(panel);
  try{
    const d=await api('/api/expectation?module='+encodeURIComponent(rec.module)+'&recordId='+encodeURIComponent(rec.id));
    panel.innerHTML='<div class="batch2-section-head"><h4>Expected Return / Ageing</h4><small>Used by Exceptions & vendor ageing</small></div><div class="batch2-expect-grid"><div class="field"><label>Expected Return</label><input class="b2-exp-date" type="date" value="'+esc(d.expectedDate||'')+'"></div><div class="field"><label>Note</label><input class="b2-exp-note" value="'+esc(d.note||'')+'" placeholder="Optional follow-up note"></div><button type="button" class="btn ghost b2-exp-save">Save Due Date</button></div>';
    panel.querySelector('.b2-exp-save').onclick=async e=>{
      const b=e.currentTarget;b.disabled=true;
      try{
        await api('/api/expectation',{method:'POST',body:JSON.stringify({module:rec.module,recordId:rec.id,expectedDate:panel.querySelector('.b2-exp-date').value,note:panel.querySelector('.b2-exp-note').value})});
        toast('Expected return saved');b.textContent='Saved ✓';setTimeout(()=>{b.textContent='Save Due Date';b.disabled=false},1000)
      }catch(err){b.disabled=false;toast(err.message,true)}
    };
  }catch(err){panel.innerHTML='<div class="batch2-inline-state">Due-date service: '+esc(err.message)+'</div>'}
}

async function mountReworkDates(){
  const body=document.getElementById('modalBody');if(!body)return;
  const h=(body.querySelector('.panel-head h3')?.textContent||'').trim();
  if(h!=='Manage QC')return;
  const rows=[...body.querySelectorAll('.history-list>div')];
  for(const r of rows){
    const id=(r.querySelector('b')?.textContent||'').trim();
    if(!/^RW/i.test(id)||r.querySelector('.b2-rw-due'))continue;
    const span=document.createElement('small');span.className='b2-rw-due';span.textContent='Due: loading…';r.appendChild(span);
    try{
      const d=await api('/api/expectation?module=rework&recordId='+encodeURIComponent(id));
      span.innerHTML='Due: <input type="date" value="'+esc(d.expectedDate||'')+'"> <button type="button">Save</button>';
      span.querySelector('button').onclick=async()=>{
        try{await api('/api/expectation',{method:'POST',body:JSON.stringify({module:'rework',recordId:id,expectedDate:span.querySelector('input').value})});toast('Rework due date saved')}catch(e){toast(e.message,true)}
      };
    }catch{span.textContent=''}
  }
}

async function mountRecordAudit(){
  if(!canAudit())return;
  const rec=inferManageRecord(),body=document.getElementById('modalBody');if(!rec||!body)return;
  const head=body.querySelector('.panel-head');if(!head||head.querySelector('.b2-audit-btn'))return;
  const b=document.createElement('button');b.type='button';b.className='btn ghost b2-audit-btn';b.textContent='Record Audit';
  head.appendChild(b);
  b.onclick=async()=>{
    let host=body.querySelector('.b2-record-audit');
    if(host){host.remove();return}
    host=document.createElement('section');host.className='subsection b2-record-audit';host.innerHTML='<div class="batch2-inline-state">Loading audit…</div>';body.appendChild(host);
    try{
      const d=await api('/api/data?module=audit&search='+encodeURIComponent(rec.id)+'&limit=100');
      const items=(d.items||[]).filter(x=>String(x.RECORD_ID||'')===rec.id||String(x.NEW_VALUE_JSON||'').includes(rec.id)||String(x.OLD_VALUE_JSON||'').includes(rec.id));
      host.innerHTML='<div class="batch2-section-head"><h4>Record Audit</h4><small>'+items.length+' event(s)</small></div>'+
        (items.length?'<div class="b2-audit-list">'+items.map(x=>'<div><b>'+esc(x.ACTION||'Change')+'</b><span>'+esc(x.USER_NAME||x.USER_ID||'')+' · '+esc(fmt(x.TIMESTAMP))+'</span><small>'+esc(auditSummary(x))+'</small></div>').join('')+'</div>':'<div class="batch2-inline-state">No audit events found.</div>');
    }catch(e){host.innerHTML='<div class="batch2-inline-state">'+esc(e.message)+'</div>'}
  };
}
function auditSummary(x){
  let a={},b={};try{a=JSON.parse(x.OLD_VALUE_JSON||'{}')}catch{}try{b=JSON.parse(x.NEW_VALUE_JSON||'{}')}catch{}
  const reason=b.reason||b.REASON||b.correctionReason||'';
  const keys=[...new Set([...Object.keys(a||{}),...Object.keys(b||{})])],out=[];
  for(const k of keys){if(/created|updated|device|ip|row_id/i.test(k))continue;if(JSON.stringify(a[k])!==JSON.stringify(b[k]))out.push(k+': '+String(a[k]??'—')+' → '+String(b[k]??'—'))}
  return (reason?'Reason: '+reason+' · ':'')+(out.slice(0,5).join(' · ')||'Recorded action');
}

function organizePanelActions(head){
  if(!head)return;
  let actions=head.querySelector('.b2-head-actions');
  if(!actions){
    actions=document.createElement('div');actions.className='b2-head-actions';head.appendChild(actions)
  }
  const newBtn=head.querySelector(':scope > #newBtn');
  const large=head.querySelector(':scope > .b2-large-mode');
  if(newBtn)actions.appendChild(newBtn);
  if(large)actions.appendChild(large)
}

function firstTrailAction(){
  return document.querySelector(
    '#gridHost .summary-trail-btn,#gridHost .txn-trail-btn,#gridHost .dye-plan-trail-btn,#gridHost .dye-trail-btn'
  )
}
document.addEventListener('click',e=>{
  const tab=e.target.closest('button[data-view="trail"]');
  if(!tab)return;
  const action=firstTrailAction();
  if(!action)return;
  e.preventDefault();e.stopImmediatePropagation();action.click()
},true);

function addLargeModeButton(){
  const module=currentModule();if(!module)return;
  const stage=document.getElementById('stage'),panel=stage?.querySelector(':scope > .panel');if(!panel)return;
  const head=panel.querySelector('.panel-head');if(!head||head.querySelector('.b2-large-mode'))return;
  const b=document.createElement('button');b.type='button';b.className='btn ghost b2-large-mode';b.textContent='Large Data Mode';
  head.appendChild(b);
  b.onclick=()=>openServerMode(module,panel);
  organizePanelActions(head);
}

function qs(state,facets=false,exportAll=false){
  const p=new URLSearchParams({module:state.module,page:String(state.page),pageSize:String(state.pageSize),search:state.search||'',sort:state.sort||'',dir:state.dir||'desc',dateFrom:state.dateFrom||'',dateTo:state.dateTo||'',filters:JSON.stringify(state.filters||{})});
  if(facets)p.set('facets','1');if(exportAll)p.set('export','1');return p.toString()
}
async function openServerMode(module,panel){
  const host=panel.querySelector('#gridHost')||panel.querySelector('#dyeGridHost')||panel.querySelector('[id$="GridHost"]')||panel.querySelector('.table-wrap')?.parentElement;
  if(!host)return toast('Large Data Mode host not found.',true);
  const st={module,page:1,pageSize:25,search:'',sort:'',dir:'desc',dateFrom:'',dateTo:'',filters:{},columns:[],filterColumns:[],dateColumn:'',facets:{},selected:new Set()};
  host.dataset.b2Server='1';
  host.innerHTML='<div class="b2-server-shell"><div class="batch2-inline-state">Loading server-side grid…</div></div>';
  const shell=host.firstElementChild;
  try{
    const d=await api('/api/grid?'+qs(st,true));Object.assign(st,{columns:d.columns||[],filterColumns:d.filterColumns||[],dateColumn:d.dateColumn||'',facets:d.facets||{}});
    drawServer(shell,st,d);
  }catch(e){shell.innerHTML='<div class="b2-state error"><b>Could not load Large Data Mode</b><span>'+esc(e.message)+'</span><button class="btn ghost b2-standard">Back to Standard View</button></div>';shell.querySelector('.b2-standard').onclick=()=>document.getElementById('refreshBtn')?.click()}
}
function drawServer(shell,st,d){
  const total=Number(d.total||0),pages=Math.max(1,Math.ceil(total/st.pageSize));
  const rows=d.items||[];
  shell.innerHTML='<div class="b2-server-toolbar"><div class="b2-search"><input class="b2-search-input" placeholder="Server search…" value="'+esc(st.search)+'"></div>'+
    '<div class="b2-date"><input class="b2-from" type="date" value="'+esc(st.dateFrom)+'"><span>to</span><input class="b2-to" type="date" value="'+esc(st.dateTo)+'"></div>'+
    '<select class="b2-sort">'+st.columns.map(c=>'<option value="'+esc(c)+'" '+(c===st.sort?'selected':'')+'>'+esc(c.replaceAll('_',' '))+'</option>').join('')+'</select>'+
    '<select class="b2-dir"><option value="desc" '+(st.dir==='desc'?'selected':'')+'>Newest / Desc</option><option value="asc" '+(st.dir==='asc'?'selected':'')+'>Oldest / Asc</option></select>'+
    '<button class="btn ghost b2-export">Export Full Filtered</button><button class="btn ghost b2-standard">Standard View</button></div>'+
    '<div class="b2-filter-row">'+st.filterColumns.map(c=>'<label><span>'+esc(c.replaceAll('_',' '))+'</span><select data-filter="'+esc(c)+'"><option value="">All</option>'+(st.facets[c]||[]).map(v=>'<option value="'+esc(v)+'" '+((st.filters[c]||[])[0]===String(v)?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>').join('')+'</div>'+
    '<div class="b2-grid-meta"><span>Showing '+(total?((st.page-1)*st.pageSize+1):0)+'–'+Math.min(total,st.page*st.pageSize)+' of '+total.toLocaleString('en-IN')+' filtered records</span><span>True server-side pagination</span></div>'+
    '<div class="b2-table-wrap"><table class="data b2-data"><thead><tr><th class="select-col"><input type="checkbox" class="b2-all"></th>'+st.columns.map(c=>'<th>'+esc(c.replaceAll('_',' '))+'</th>').join('')+'<th class="action-sticky">Action</th></tr></thead><tbody>'+
      (rows.length?rows.map((r,i)=>'<tr><td class="select-col"><input type="checkbox" class="b2-sel" data-i="'+i+'"></td>'+st.columns.map(c=>'<td data-label="'+esc(c.replaceAll('_',' '))+'">'+cell(c,r[c])+'</td>').join('')+'<td data-label="Action" class="action-sticky"><button class="btn ghost b2-open-standard" data-id="'+esc(r[ID_COL[st.module]]||'')+'">Open</button></td></tr>').join(''):'<tr><td colspan="'+(st.columns.length+2)+'"><div class="b2-state"><b>No matching records</b><span>Change server filters or search.</span></div></td></tr>')+
    '</tbody></table></div>'+
    '<div class="b2-server-footer"><label>Rows <select class="b2-size">'+[10,25,50,100].map(n=>'<option '+(n===st.pageSize?'selected':'')+'>'+n+'</option>').join('')+'</select></label><div><button class="btn ghost b2-prev" '+(st.page<=1?'disabled':'')+'>‹ Previous</button><span>Page '+st.page+' of '+pages+'</span><button class="btn ghost b2-next" '+(st.page>=pages?'disabled':'')+'>Next ›</button></div></div>';

  let timer;
  shell.querySelector('.b2-search-input').oninput=e=>{clearTimeout(timer);timer=setTimeout(()=>reload(shell,st,{search:e.target.value,page:1}),320)};
  shell.querySelector('.b2-from').onchange=e=>reload(shell,st,{dateFrom:e.target.value,page:1});
  shell.querySelector('.b2-to').onchange=e=>reload(shell,st,{dateTo:e.target.value,page:1});
  shell.querySelector('.b2-sort').onchange=e=>reload(shell,st,{sort:e.target.value,page:1});
  shell.querySelector('.b2-dir').onchange=e=>reload(shell,st,{dir:e.target.value,page:1});
  shell.querySelector('.b2-size').onchange=e=>reload(shell,st,{pageSize:Number(e.target.value),page:1});
  shell.querySelectorAll('[data-filter]').forEach(s=>s.onchange=e=>{const k=e.target.dataset.filter,v=e.target.value;st.filters[k]=v?[v]:[];reload(shell,st,{page:1})});
  shell.querySelector('.b2-prev').onclick=()=>reload(shell,st,{page:Math.max(1,st.page-1)});
  shell.querySelector('.b2-next').onclick=()=>reload(shell,st,{page:Math.min(pages,st.page+1)});
  shell.querySelector('.b2-standard').onclick=()=>document.getElementById('refreshBtn')?.click();
  shell.querySelector('.b2-export').onclick=()=>exportFiltered(st);
  shell.querySelectorAll('.b2-open-standard').forEach(b=>b.onclick=()=>openStandardRecord(b.dataset.id));
  const sels=[...shell.querySelectorAll('.b2-sel')],all=shell.querySelector('.b2-all');
  all.onchange=()=>sels.forEach(x=>x.checked=all.checked);
}
function cell(k,v){
  if(v===null||v===undefined||v==='')return'—';
  if(/STATUS/.test(k))return '<span class="badge">'+esc(v)+'</span>';
  if(/DATE$/.test(k))return esc(fmt(v));
  if(/OVERDUE_DAYS/.test(k)&&Number(v)>0)return '<span class="b2-overdue">'+Number(v)+'d overdue</span>';
  if(/(?:MTR|METER|VARIANCE)/i.test(String(k))&&!Number.isNaN(Number(v)))return Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  if(/(?:QTY|COUNT|PIECES|_CUT$|_ISSUED$|_RECEIVED$|PENDING)/i.test(String(k))&&!Number.isNaN(Number(v)))return Number(v).toLocaleString('en-IN',{maximumFractionDigits:0});
  return esc(v);
}
async function reload(shell,st,patch){
  Object.assign(st,patch);shell.classList.add('is-loading');
  try{const d=await api('/api/grid?'+qs(st));drawServer(shell,st,d)}catch(e){toast(e.message,true)}finally{shell.classList.remove('is-loading')}
}
function openStandardRecord(id){
  document.getElementById('refreshBtn')?.click();
  if(!id)return;
  setTimeout(()=>{
    const s=document.querySelector('.grid-search');if(!s)return;
    s.value=id;s.dispatchEvent(new Event('input',{bubbles:true}));s.focus()
  },800)
}
async function exportFiltered(st){
  try{
    const d=await api('/api/grid?'+qs(st,false,true)),rows=d.items||[];
    if(!rows.length)return toast('No rows to export.',true);
    const cols=d.columns||st.columns;
    const csv=[cols.join(','),...rows.map(r=>cols.map(c=>csvCell(r[c])).join(','))].join('\r\n');
    const blob=new Blob(["\ufeff"+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='rrr-'+st.module+'-filtered-'+new Date().toISOString().slice(0,10)+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    toast('Full filtered export ready');
  }catch(e){toast(e.message,true)}
}
function csvCell(v){const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}

function scan(){
  scanQueued=false;updateBuild();injectExpectedField();mountExpectationPanel();mountReworkDates();mountRecordAudit();addLargeModeButton();
  const head=document.querySelector('#stage > .panel > .panel-head');if(head)organizePanelActions(head)
}
function queueScan(){if(scanQueued)return;scanQueued=true;requestAnimationFrame(scan)}
function startObservers(){
  const stage=document.getElementById('stage'),modalBody=document.getElementById('modalBody');
  if(stage)new MutationObserver(queueScan).observe(stage,{childList:true});
  if(modalBody)new MutationObserver(queueScan).observe(modalBody,{childList:true});
  document.addEventListener('click',e=>{
    if(e.target.closest('#nav button,#refreshBtn,#newBtn,.compact-action-menu button,.btn'))setTimeout(queueScan,0)
  },{passive:true});
  scan()
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startObservers,{once:true});else startObservers()
})();