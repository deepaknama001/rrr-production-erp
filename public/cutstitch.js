(function(){
'use strict';
function token(){return localStorage.getItem('rrr_prod_token')||''}
function esc(v){return String(v??'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
function truth(v){return v===true||v===1||String(v).toLowerCase()==='true'}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function fmt(v){return num(v).toLocaleString('en-IN',{maximumFractionDigits:2})}
function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
async function api(path,opt){
  opt=opt||{};const h=Object.assign({},opt.headers||{});if(token())h.authorization='Bearer '+token();if(opt.body)h['content-type']='application/json';
  const r=await fetch(path,Object.assign({},opt,{headers:h})),d=await r.json().catch(function(){return{}});
  if(!r.ok)throw new Error(d.error||'Request failed');return d
}
function notify(msg,bad){
  const host=document.getElementById('toastHost');if(!host)return alert(msg);
  const e=document.createElement('div');e.className='toast '+(bad?'bad':'ok');e.innerHTML='<b>'+esc(msg)+'</b>';host.appendChild(e);setTimeout(function(){e.remove()},3200)
}
function options(items,id,label){
  return (items||[]).map(function(x){return '<option value="'+esc(x[id])+'">'+esc(x[label]||x[id])+'</option>'}).join('')
}
function styleOptions(items){
  return (items||[]).map(function(x){return '<option value="'+esc(x.STYLE_ID)+'">'+esc(x.STYLE_NAME||x.STYLE_ID)+'</option>'}).join('')
}
async function openBulkIssue(){
  const modal=document.getElementById('modal'),body=document.getElementById('modalBody');if(!modal||!body)return;
  body.innerHTML='<div class="panel-head"><div><h3>Bulk Issue — Cutting & Stitching</h3><small>Loading dyed stock and masters…</small></div><button class="btn ghost" id="csClose">Close</button></div><div class="cs-loading">Loading…</div>';
  modal.classList.remove('hidden');document.getElementById('csClose').onclick=function(){modal.classList.add('hidden')};
  try{
    const d=await api('/api/data?module=lookups'),l=d.lookups||{},vendors=(l.vendors||[]).filter(function(v){return truth(v.STITCHING_VENDOR)&&truth(v.ACTIVE)}),
      batches=l.dyeBatches||[],styles=(l.styles||[]).filter(function(x){return truth(x.ACTIVE)}),sizes=(l.sizes||[]).filter(function(x){return truth(x.ACTIVE)});
    if(!vendors.length)throw new Error('Create an active Cutting / Stitching Vendor in Masters → Vendors.');
    if(!batches.length)throw new Error('No dyed fabric balance is available. Receive dyed fabric first.');
    if(!sizes.length)throw new Error('Create active Sizes in Masters → Sizes.');

    const batchOptions='<option value="">Select dyed batch</option>'+batches.map(function(b){
      return '<option value="'+esc(b.DYE_BATCH_ID)+'">'+esc(b.DYE_BATCH_ID)+' · '+esc(b.FABRIC_NAME||b.FABRIC||b.FABRIC_ID||'')+' · '+esc(b.COLOR_NAME||b.COLOR||b.COLOR_ID||'')+' · '+fmt(b.BALANCE_MTR)+' m</option>'
    }).join('');

    body.innerHTML='<div class="panel-head"><div><h3>Bulk Issue — Cutting & Stitching</h3><small>Same vendor receives dyed fabric, cuts it and stitches the garments.</small></div><button class="btn ghost" id="csClose">Close</button></div>'+
      '<form id="csForm"><div class="form-grid">'+
      '<div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" value="'+today()+'" required></div>'+
      '<div class="field"><label>Expected Return</label><input name="EXPECTED_DATE" type="date"></div>'+
      '<div class="field"><label>Cutting & Stitching Vendor</label><select name="STITCHING_VENDOR_ID" required><option value="">Select vendor</option>'+options(vendors,'VENDOR_ID','VENDOR_NAME')+'</select></div>'+
      '<div class="field wide"><label>General Notes</label><input name="NOTES" placeholder="Optional vendor instructions"></div></div>'+
      '<div class="roll-head"><div><b>Issue Plan</b><small>Add all fabric / style lines for this vendor in one go.</small></div><button type="button" class="btn teal" id="csAdd">+ Add Line</button></div>'+
      '<div class="roll-table cs-table-wrap"><table class="data cs-table"><thead><tr><th>#</th><th>Dye Batch</th><th>Fabric / Colour</th><th>Style</th><th>Fabric Mtr</th>'+
      sizes.map(function(s){return '<th>'+esc(s.SIZE_NAME)+'</th>'}).join('')+
      '<th>Total Pcs</th><th></th></tr></thead><tbody id="csRows"></tbody></table></div>'+
      '<div class="roll-summary"><span>Lines <b id="csLines">0</b></span><span>Total Fabric <b id="csMeters">0</b> m</span><span>Target Pieces <b id="csPieces">0</b></span></div>'+
      '<div class="form-actions"><button type="button" class="btn ghost" id="csCancel">Cancel</button><button class="btn primary">Create Bulk Vendor Issue</button></div></form>';
    document.getElementById('csClose').onclick=document.getElementById('csCancel').onclick=function(){modal.classList.add('hidden')};

    const host=document.getElementById('csRows');
    function totals(){
      const rows=[].slice.call(host.querySelectorAll('.cs-row'));
      document.getElementById('csLines').textContent=rows.length;
      document.getElementById('csMeters').textContent=fmt(rows.reduce(function(s,r){return s+num(r.querySelector('.cs-mtr').value)},0));
      document.getElementById('csPieces').textContent=rows.reduce(function(s,r){return s+[].slice.call(r.querySelectorAll('.cs-size')).reduce(function(a,x){return a+num(x.value)},0)},0)
    }
    function renumber(){[].slice.call(host.querySelectorAll('.cs-row')).forEach(function(r,i){r.querySelector('.cs-no').textContent=i+1})}
    function compatible(batch){return styles.filter(function(s){return !s.DEFAULT_FABRIC_ID||String(s.DEFAULT_FABRIC_ID)===String(batch.FABRIC_ID)})}
    function addRow(){
      const tr=document.createElement('tr');tr.className='cs-row';
      tr.innerHTML='<td class="cs-no"></td><td><select class="cs-batch">'+batchOptions+'</select></td><td class="cs-source">—</td>'+
        '<td><select class="cs-style"><option value="">Select style</option>'+styleOptions(styles)+'</select></td>'+
        '<td><input class="cs-mtr" type="number" min="0.01" step="0.01" placeholder="0"></td>'+
        sizes.map(function(s){return '<td><input class="cs-size" data-size="'+esc(s.SIZE_ID)+'" type="number" min="0" step="1" value="0"></td>'}).join('')+
        '<td class="cs-total">0</td><td><button type="button" class="icon-btn cs-remove">×</button></td>';
      host.appendChild(tr);
      tr.querySelector('.cs-batch').onchange=function(e){
        const b=batches.find(function(x){return String(x.DYE_BATCH_ID)===String(e.target.value)}),src=tr.querySelector('.cs-source'),sty=tr.querySelector('.cs-style'),m=tr.querySelector('.cs-mtr');
        if(!b){src.textContent='—';sty.innerHTML='<option value="">Select style</option>'+styleOptions(styles);m.removeAttribute('max');return}
        src.innerHTML='<b>'+esc(b.FABRIC_NAME||b.FABRIC||b.FABRIC_ID||'')+'</b><small>'+esc(b.COLOR_NAME||b.COLOR||b.COLOR_ID||'')+' · '+fmt(b.BALANCE_MTR)+' m available</small>';
        sty.innerHTML='<option value="">Select style</option>'+styleOptions(compatible(b));m.max=num(b.BALANCE_MTR)
      };
      tr.querySelector('.cs-remove').onclick=function(){tr.remove();renumber();totals()};
      [].slice.call(tr.querySelectorAll('input')).forEach(function(x){x.oninput=function(){tr.querySelector('.cs-total').textContent=[].slice.call(tr.querySelectorAll('.cs-size')).reduce(function(s,y){return s+num(y.value)},0);totals()}});
      renumber();totals()
    }
    document.getElementById('csAdd').onclick=addRow;addRow();

    document.getElementById('csForm').onsubmit=async function(e){
      e.preventDefault();const fd=new FormData(e.target),items=[],seen=new Set(),rows=[].slice.call(host.querySelectorAll('.cs-row'));
      for(let i=0;i<rows.length;i++){
        const row=rows[i],batch=row.querySelector('.cs-batch').value,style=row.querySelector('.cs-style').value,mtr=num(row.querySelector('.cs-mtr').value),
          lineSizes=[].slice.call(row.querySelectorAll('.cs-size')).map(function(x){return {SIZE_ID:x.dataset.size,QTY:num(x.value)}}).filter(function(x){return x.QTY>0});
        if(!batch||!style||mtr<=0||!lineSizes.length)throw new Error('Complete dyed batch, style, fabric meter and size plan on line '+(i+1)+'.');
        const key=batch+'|'+style;if(seen.has(key))throw new Error('Same Dye Batch + Style is repeated. Combine it into one line.');seen.add(key);
        items.push({DYE_BATCH_ID:batch,STYLE_ID:style,ALLOCATED_MTR:mtr,sizes:lineSizes})
      }
      const rec={ISSUE_DATE:fd.get('ISSUE_DATE'),EXPECTED_DATE:fd.get('EXPECTED_DATE'),STITCHING_VENDOR_ID:fd.get('STITCHING_VENDOR_ID'),NOTES:fd.get('NOTES'),items:items};
      const saveBtn=e.target.querySelector('button[type="submit"]');saveBtn.disabled=true;saveBtn.textContent='Saving…';
      try{
        const out=await api('/api/data',{method:'POST',body:JSON.stringify({module:'cutstitch_bulk',record:rec,requestId:crypto.randomUUID()})});
        modal.classList.add('hidden');notify('Bulk issue created: '+num(out.record&&out.record.ISSUE_COUNT)+' line(s)',false);document.getElementById('refreshBtn')?.click()
      }catch(err){notify(err.message,true);saveBtn.disabled=false;saveBtn.textContent='Create Bulk Vendor Issue'}
    }
  }catch(err){body.innerHTML+='<div class="cs-error">'+esc(err.message)+'</div>';notify(err.message,true)}
}
document.addEventListener('click',function(e){
  const b=e.target.closest('#newBtn');if(!b)return;
  if((document.getElementById('pageTitle')?.textContent||'').trim()!=='Cutting & Stitching')return;
  e.preventDefault();e.stopImmediatePropagation();openBulkIssue()
},true);
})();