(function(){
'use strict';

function token(){return localStorage.getItem('rrr_prod_token')||''}
function esc(v){return String(v??'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
function truth(v){return v===true||v===1||String(v).toLowerCase()==='true'}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function meter(v){return num(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}
function today(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)}
async function api(path,opt){
  opt=opt||{};const h=Object.assign({},opt.headers||{});if(token())h.authorization='Bearer '+token();if(opt.body)h['content-type']='application/json';
  const r=await fetch(path,Object.assign({},opt,{headers:h})),d=await r.json().catch(function(){return{}});
  if(!r.ok)throw new Error(d.error||'Request failed');return d
}
function notify(msg,bad){
  const host=document.getElementById('toastHost');if(!host)return alert(msg);
  const e=document.createElement('div');e.className='app-toast '+(bad?'bad':'ok');e.innerHTML='<b>'+esc(msg)+'</b>';host.appendChild(e);
  requestAnimationFrame(function(){e.classList.add('show')});setTimeout(function(){e.classList.remove('show');setTimeout(function(){e.remove()},220)},3200)
}
function backToList(){
  const b=document.querySelector('#nav button[data-m="stitching"]');
  if(b)b.click();else document.getElementById('refreshBtn')?.click()
}
function vendorOptions(items){
  return (items||[]).map(function(x){return '<option value="'+esc(x.VENDOR_ID)+'">'+esc(x.VENDOR_NAME||x.VENDOR_ID)+'</option>'}).join('')
}
function styleOptions(items,selected){
  return (items||[]).map(function(x){return '<option value="'+esc(x.STYLE_ID)+'"'+(String(x.STYLE_ID)===String(selected||'')?' selected':'')+'>'+esc(x.STYLE_NAME||x.STYLE_ID)+'</option>'}).join('')
}

async function openBulkIssuePage(){
  const stage=document.getElementById('stage');if(!stage)return;
  document.getElementById('pageTitle').textContent='New Cutting & Stitching Issue';
  stage.innerHTML='<section class="cs-page"><div class="cs-page-head"><div><button class="cs-back" id="csBack">← Back to Cutting & Stitching</button><h2>Bulk Cutting & Stitching Issue</h2><p>Loading dyed stock and masters…</p></div></div></section>';
  document.getElementById('csBack').onclick=backToList;

  try{
    const d=await api('/api/data?module=lookups'),l=d.lookups||{};
    const vendors=(l.vendors||[]).filter(function(v){return truth(v.STITCHING_VENDOR)&&truth(v.ACTIVE)});
    const batches=l.dyeBatches||[];
    const styles=(l.styles||[]).filter(function(x){return truth(x.ACTIVE)});
    const sizes=(l.sizes||[]).filter(function(x){return truth(x.ACTIVE)});

    if(!vendors.length)throw new Error('Create an active Cutting / Stitching Vendor in Masters → Vendors.');
    if(!batches.length)throw new Error('No dyed fabric balance is available. Receive dyed fabric first.');
    if(!sizes.length)throw new Error('Create active Sizes in Masters → Sizes.');

    const preferredOrder=['M','L','XL','2XL','3XL'];
    sizes.sort(function(a,b){
      const ai=preferredOrder.indexOf(String(a.SIZE_NAME||'').toUpperCase()),bi=preferredOrder.indexOf(String(b.SIZE_NAME||'').toUpperCase());
      if(ai>=0||bi>=0)return (ai<0?99:ai)-(bi<0?99:bi);
      return num(a.SORT_ORDER)-num(b.SORT_ORDER)
    });

    stage.innerHTML='<section class="cs-page">'+
      '<div class="cs-page-head"><div><button class="cs-back" id="csBack">← Back to Cutting & Stitching</button><h2>Bulk Cutting & Stitching Issue</h2><p>Common details once; then one compact line per dye batch / style.</p></div></div>'+
      '<form id="csPageForm">'+
        '<section class="cs-common-card">'+
          '<div class="cs-common-grid">'+
            '<div class="field"><label>Cutting & Stitching Vendor</label><select name="STITCHING_VENDOR_ID" required><option value="">Select vendor</option>'+vendorOptions(vendors)+'</select></div>'+
            '<div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" value="'+today()+'" required></div>'+
            '<div class="field"><label>Expected Return</label><input name="EXPECTED_DATE" type="date"></div>'+
            '<div class="field"><label>General Notes</label><input name="NOTES" placeholder="Optional vendor instruction"></div>'+
          '</div>'+
          '<div class="cs-defaults"><div class="cs-defaults-title"><b>Optional Defaults</b><small>Set once; every new line will auto-fill these values.</small></div>'+
            '<div class="field cs-default-style"><label>Default Style</label><select id="csDefaultStyle"><option value="">No default</option>'+styleOptions(styles)+'</select></div>'+
            sizes.map(function(s){return '<label class="cs-default-size"><span>'+esc(s.SIZE_NAME)+'</span><input id="csDef_'+esc(s.SIZE_ID)+'" data-default-size="'+esc(s.SIZE_ID)+'" type="number" min="0" step="1" value="0"></label>'}).join('')+
          '</div>'+
        '</section>'+
        '<section class="cs-lines-section"><div class="cs-lines-heading"><div><b>Issue Lines</b><small>Meter allows decimals; piece quantities are whole numbers.</small></div></div><div id="csRows" class="cs-rows"></div></section>'+
        '<div class="cs-sticky-bar"><div class="cs-totals"><div><small>Issue Lines</small><b id="csLines">0</b></div><div><small>Total Fabric</small><b><span id="csMeters">0.00</span> m</b></div><div><small>Target Pieces</small><b id="csPieces">0</b></div></div><div class="cs-save-actions"><button type="button" class="btn ghost" id="csCancel">Cancel</button><button class="btn primary cs-save-btn" type="submit">Create Bulk Vendor Issue</button></div></div>'+
      '</form></section>';

    document.getElementById('csBack').onclick=document.getElementById('csCancel').onclick=backToList;

    const host=document.getElementById('csRows');
    function compatible(batch){
      return styles.filter(function(s){return !s.DEFAULT_FABRIC_ID||String(s.DEFAULT_FABRIC_ID)===String(batch.FABRIC_ID)})
    }
    function batchOptions(){
      return '<option value="">Select dyed batch</option>'+batches.map(function(b){
        return '<option value="'+esc(b.DYE_BATCH_ID)+'">'+esc(b.DYE_BATCH_ID)+' · '+esc(b.COLOR_NAME||b.COLOR||b.COLOR_ID||'')+' · '+meter(b.BALANCE_MTR)+' m</option>'
      }).join('')
    }
    function defaultSizes(){
      const out={};
      [].slice.call(document.querySelectorAll('[data-default-size]')).forEach(function(x){out[x.dataset.defaultSize]=Math.max(0,Math.trunc(num(x.value)))});
      return out
    }
    function lineTotal(row){
      return [].slice.call(row.querySelectorAll('.cs-size-input')).reduce(function(s,x){return s+Math.max(0,Math.trunc(num(x.value)))},0)
    }
    function totals(){
      const rows=[].slice.call(host.querySelectorAll('.cs-issue-row'));
      document.getElementById('csLines').textContent=rows.length;
      document.getElementById('csMeters').textContent=meter(rows.reduce(function(s,r){return s+num(r.querySelector('.cs-mtr').value)},0));
      document.getElementById('csPieces').textContent=rows.reduce(function(s,r){return s+lineTotal(r)},0);
      rows.forEach(function(r,i){r.querySelector('.cs-row-index').textContent=i+1;r.querySelector('.cs-total-pcs').textContent=lineTotal(r)})
    }
    function applyDefaults(row,batch){
      const preferred=document.getElementById('csDefaultStyle').value;
      const comp=batch?compatible(batch):styles;
      const style=row.querySelector('.cs-style');
      style.innerHTML='<option value="">Select style</option>'+styleOptions(comp,comp.some(function(s){return String(s.STYLE_ID)===String(preferred)})?preferred:'');
      const ds=defaultSizes();
      [].slice.call(row.querySelectorAll('.cs-size-input')).forEach(function(x){x.value=String(ds[x.dataset.size]||0)});
      totals()
    }
    function addRow(afterRow){
      const row=document.createElement('div');row.className='cs-issue-row';
      row.innerHTML=
        '<div class="cs-row-index"></div>'+
        '<div class="field cs-row-batch"><label>Dye Batch</label><select class="cs-batch">'+batchOptions()+'</select></div>'+
        '<div class="cs-row-source"><small>Fabric / Colour</small><b class="cs-source-name">—</b><span class="cs-source-meta">Select batch</span></div>'+
        '<div class="field cs-row-style"><label>Style</label><select class="cs-style"><option value="">Select style</option>'+styleOptions(styles,document.getElementById('csDefaultStyle').value)+'</select></div>'+
        '<div class="field cs-row-meter"><label>Meter</label><input class="cs-mtr" type="number" min="0.01" step="0.01" placeholder="0.00"></div>'+
        '<div class="cs-row-sizes">'+sizes.map(function(s){return '<label><span>'+esc(s.SIZE_NAME)+'</span><input class="cs-size-input" data-size="'+esc(s.SIZE_ID)+'" type="number" min="0" step="1" value="'+Math.max(0,Math.trunc(num(document.getElementById('csDef_'+s.SIZE_ID)?.value)))+'"></label>'}).join('')+'</div>'+
        '<div class="cs-row-total"><small>Total</small><b class="cs-total-pcs">0</b></div>'+
        '<div class="cs-row-actions"><button type="button" class="cs-add-after" title="Add line below">+ Line</button><button type="button" class="cs-remove" title="Remove">×</button></div>';
      if(afterRow&&afterRow.nextSibling)host.insertBefore(row,afterRow.nextSibling);else host.appendChild(row);

      const batchSel=row.querySelector('.cs-batch'),styleSel=row.querySelector('.cs-style'),mtr=row.querySelector('.cs-mtr');
      batchSel.onchange=function(){
        const batch=batches.find(function(x){return String(x.DYE_BATCH_ID)===String(batchSel.value)});
        const name=row.querySelector('.cs-source-name'),meta=row.querySelector('.cs-source-meta');
        if(!batch){
          name.textContent='—';meta.textContent='Select batch';mtr.removeAttribute('max');applyDefaults(row,null);return
        }
        name.textContent=batch.FABRIC_NAME||batch.FABRIC||batch.FABRIC_ID||'';
        meta.textContent=(batch.COLOR_NAME||batch.COLOR||batch.COLOR_ID||'')+' · '+meter(batch.BALANCE_MTR)+' m available';
        mtr.max=num(batch.BALANCE_MTR);
        applyDefaults(row,batch)
      };
      mtr.onblur=function(){if(mtr.value!=='')mtr.value=num(mtr.value).toFixed(2)};
      mtr.oninput=totals;
      [].slice.call(row.querySelectorAll('.cs-size-input')).forEach(function(x){
        x.oninput=function(){x.value=String(Math.max(0,Math.trunc(num(x.value))));totals()}
      });
      row.querySelector('.cs-add-after').onclick=function(){addRow(row)};
      row.querySelector('.cs-remove').onclick=function(){
        if(host.querySelectorAll('.cs-issue-row').length===1)return notify('At least one issue line is required.',true);
        row.remove();totals()
      };
      totals();row.scrollIntoView({behavior:'smooth',block:'nearest'})
    }

    document.getElementById('csDefaultStyle').onchange=function(){
      const val=this.value;
      [].slice.call(host.querySelectorAll('.cs-issue-row')).forEach(function(row){
        if(row.querySelector('.cs-style').value)return;
        const batch=batches.find(function(x){return String(x.DYE_BATCH_ID)===String(row.querySelector('.cs-batch').value)});
        const comp=batch?compatible(batch):styles;
        if(comp.some(function(s){return String(s.STYLE_ID)===String(val)}))row.querySelector('.cs-style').value=val
      })
    };
    [].slice.call(document.querySelectorAll('[data-default-size]')).forEach(function(x){
      x.oninput=function(){x.value=String(Math.max(0,Math.trunc(num(x.value))))}
    });

    addRow();

    document.getElementById('csPageForm').onsubmit=async function(e){
      e.preventDefault();
      const fd=new FormData(e.target),vendor=String(fd.get('STITCHING_VENDOR_ID')||'');
      if(!vendor)return notify('Select Cutting & Stitching Vendor.',true);
      const rows=[].slice.call(host.querySelectorAll('.cs-issue-row')),items=[],seen=new Set();
      try{
        for(let i=0;i<rows.length;i++){
          const row=rows[i],batch=row.querySelector('.cs-batch').value,style=row.querySelector('.cs-style').value,mtr=Number(num(row.querySelector('.cs-mtr').value).toFixed(2));
          const lineSizes=[].slice.call(row.querySelectorAll('.cs-size-input')).map(function(x){return {SIZE_ID:x.dataset.size,QTY:Math.max(0,Math.trunc(num(x.value)))}}).filter(function(x){return x.QTY>0});
          if(!batch)throw new Error('Select Dye Batch on line '+(i+1)+'.');
          if(!style)throw new Error('Select Style on line '+(i+1)+'.');
          if(mtr<=0)throw new Error('Enter Fabric Meter on line '+(i+1)+'.');
          if(!lineSizes.length)throw new Error('Enter at least one size quantity on line '+(i+1)+'.');
          const key=batch+'|'+style;if(seen.has(key))throw new Error('Same Dye Batch + Style is repeated. Combine it into one line.');seen.add(key);
          items.push({DYE_BATCH_ID:batch,STYLE_ID:style,ALLOCATED_MTR:mtr,sizes:lineSizes})
        }
      }catch(err){notify(err.message,true);return}

      const rec={ISSUE_DATE:fd.get('ISSUE_DATE'),EXPECTED_DATE:fd.get('EXPECTED_DATE'),STITCHING_VENDOR_ID:vendor,NOTES:fd.get('NOTES'),items:items};
      const saveBtn=e.target.querySelector('.cs-save-btn'),oldText=saveBtn.textContent;saveBtn.disabled=true;saveBtn.textContent='Creating Issue…';
      try{
        const out=await api('/api/data',{method:'POST',body:JSON.stringify({module:'cutstitch_bulk',record:rec,requestId:uid()})});
        notify('Bulk issue created: '+num(out.record&&out.record.ISSUE_COUNT)+' line(s)',false);backToList()
      }catch(err){notify(err.message,true);saveBtn.disabled=false;saveBtn.textContent=oldText}
    }
  }catch(err){
    stage.innerHTML='<section class="cs-page"><div class="cs-page-head"><div><button class="cs-back" id="csBack">← Back to Cutting & Stitching</button><h2>Bulk Cutting & Stitching Issue</h2></div></div><div class="cs-page-error"><b>Could not open bulk issue</b><span>'+esc(err.message)+'</span></div></section>';
    document.getElementById('csBack').onclick=backToList;notify(err.message,true)
  }
}

document.addEventListener('click',function(e){
  const b=e.target.closest('#newBtn');if(!b)return;
  if((document.getElementById('pageTitle')?.textContent||'').trim()!=='Cutting & Stitching')return;
  e.preventDefault();e.stopImmediatePropagation();openBulkIssuePage()
},true);
})();