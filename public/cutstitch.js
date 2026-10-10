(function(){
'use strict';

function token(){return localStorage.getItem('rrr_prod_token')||''}
function esc(v){return String(v??'').replace(/[&<>"']/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]})}
function truth(v){return v===true||v===1||String(v).toLowerCase()==='true'}
function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
function fmt(v){return num(v).toLocaleString('en-IN',{maximumFractionDigits:2})}
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
function styleOptions(items){
  return (items||[]).map(function(x){return '<option value="'+esc(x.STYLE_ID)+'">'+esc(x.STYLE_NAME||x.STYLE_ID)+'</option>'}).join('')
}

async function openBulkIssuePage(){
  const stage=document.getElementById('stage');if(!stage)return;
  document.getElementById('pageTitle').textContent='New Cutting & Stitching Issue';
  stage.innerHTML='<section class="cs-page"><div class="cs-page-head"><div><button class="cs-back" id="csBack">← Back to Cutting & Stitching</button><h2>Bulk Cutting & Stitching Issue</h2><p>Issue dyed fabric directly to the vendor who will cut and stitch the garments.</p></div></div><div class="cs-page-loading">Loading dyed stock and masters…</div></section>';
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

    stage.innerHTML='<section class="cs-page">'+
      '<div class="cs-page-head"><div><button class="cs-back" id="csBack">← Back to Cutting & Stitching</button><h2>Bulk Cutting & Stitching Issue</h2><p>One vendor can take multiple dyed fabrics/styles in the same issue.</p></div><button type="button" class="btn teal cs-add-top" id="csAddTop">+ Add Issue Line</button></div>'+
      '<form id="csPageForm">'+
        '<section class="cs-common-card"><div class="cs-section-title"><span>1</span><div><b>Vendor & Schedule</b><small>Common details for all issue lines below</small></div></div>'+
          '<div class="cs-common-grid">'+
            '<div class="field"><label>Cutting & Stitching Vendor</label><select name="STITCHING_VENDOR_ID" required><option value="">Select vendor</option>'+vendorOptions(vendors)+'</select></div>'+
            '<div class="field"><label>Issue Date</label><input name="ISSUE_DATE" type="date" value="'+today()+'" required></div>'+
            '<div class="field"><label>Expected Return</label><input name="EXPECTED_DATE" type="date"></div>'+
            '<div class="field cs-notes-field"><label>General Notes</label><input name="NOTES" placeholder="Optional instructions for vendor"></div>'+
          '</div>'+
        '</section>'+
        '<section class="cs-lines-section"><div class="cs-lines-heading"><div class="cs-section-title"><span>2</span><div><b>Fabric & Production Plan</b><small>Add one card for each dye batch / style combination</small></div></div><button type="button" class="btn teal" id="csAdd">+ Add Issue Line</button></div><div id="csCards" class="cs-cards"></div></section>'+
        '<div class="cs-sticky-bar"><div class="cs-totals"><div><small>Issue Lines</small><b id="csLines">0</b></div><div><small>Total Fabric</small><b><span id="csMeters">0</span> m</b></div><div><small>Target Pieces</small><b id="csPieces">0</b></div></div><div class="cs-save-actions"><button type="button" class="btn ghost" id="csCancel">Cancel</button><button class="btn primary cs-save-btn" type="submit">Create Bulk Vendor Issue</button></div></div>'+
      '</form></section>';

    document.getElementById('csBack').onclick=document.getElementById('csCancel').onclick=backToList;

    const host=document.getElementById('csCards');

    function compatible(batch){
      return styles.filter(function(s){return !s.DEFAULT_FABRIC_ID||String(s.DEFAULT_FABRIC_ID)===String(batch.FABRIC_ID)})
    }
    function batchOptions(){
      return '<option value="">Select dyed batch</option>'+batches.map(function(b){
        return '<option value="'+esc(b.DYE_BATCH_ID)+'">'+esc(b.DYE_BATCH_ID)+' · '+esc(b.FABRIC_NAME||b.FABRIC||b.FABRIC_ID||'')+' · '+esc(b.COLOR_NAME||b.COLOR||b.COLOR_ID||'')+' · '+fmt(b.BALANCE_MTR)+' m available</option>'
      }).join('')
    }
    function updateCard(card){
      const total=[].slice.call(card.querySelectorAll('.cs-size-input')).reduce(function(s,x){return s+num(x.value)},0);
      card.querySelector('.cs-card-total').textContent=total;
      totals()
    }
    function totals(){
      const cards=[].slice.call(host.querySelectorAll('.cs-line-card'));
      document.getElementById('csLines').textContent=cards.length;
      document.getElementById('csMeters').textContent=fmt(cards.reduce(function(s,c){return s+num(c.querySelector('.cs-mtr').value)},0));
      document.getElementById('csPieces').textContent=cards.reduce(function(s,c){return s+num(c.querySelector('.cs-card-total').textContent)},0);
      cards.forEach(function(c,i){c.querySelector('.cs-line-no').textContent='Issue Line '+(i+1)})
    }
    function addCard(){
      const card=document.createElement('article');card.className='cs-line-card';
      card.innerHTML=
        '<div class="cs-card-head"><div><span class="cs-line-no"></span><small class="cs-source-summary">Choose a dyed batch to begin</small></div><button type="button" class="cs-remove" title="Remove line">×</button></div>'+
        '<div class="cs-card-main">'+
          '<div class="field cs-batch-field"><label>Dye Batch</label><select class="cs-batch">'+batchOptions()+'</select></div>'+
          '<div class="cs-source-box"><small>Fabric / Colour</small><b class="cs-source-name">—</b><span class="cs-source-meta">Select batch</span></div>'+
          '<div class="field"><label>Style / Item</label><select class="cs-style"><option value="">Select style</option>'+styleOptions(styles)+'</select></div>'+
          '<div class="field cs-meter-field"><label>Fabric Issue (Meter)</label><input class="cs-mtr" type="number" min="0.01" step="0.01" placeholder="0.00"></div>'+
        '</div>'+
        '<div class="cs-size-area"><div class="cs-size-head"><div><b>Target Size-wise Pieces</b><small>Enter expected production quantity</small></div><div class="cs-card-total-wrap"><small>Total Pieces</small><b class="cs-card-total">0</b></div></div>'+
          '<div class="cs-size-grid">'+sizes.map(function(s){return '<label class="cs-size-box"><span>'+esc(s.SIZE_NAME)+'</span><input class="cs-size-input" data-size="'+esc(s.SIZE_ID)+'" type="number" min="0" step="1" value="0"></label>'}).join('')+'</div>'+
        '</div>';
      host.appendChild(card);

      const batchSel=card.querySelector('.cs-batch'),styleSel=card.querySelector('.cs-style'),meter=card.querySelector('.cs-mtr');
      batchSel.onchange=function(){
        const b=batches.find(function(x){return String(x.DYE_BATCH_ID)===String(batchSel.value)});
        const name=card.querySelector('.cs-source-name'),meta=card.querySelector('.cs-source-meta'),summary=card.querySelector('.cs-source-summary');
        if(!b){
          name.textContent='—';meta.textContent='Select batch';summary.textContent='Choose a dyed batch to begin';
          styleSel.innerHTML='<option value="">Select style</option>'+styleOptions(styles);meter.removeAttribute('max');return
        }
        const fabric=b.FABRIC_NAME||b.FABRIC||b.FABRIC_ID||'',color=b.COLOR_NAME||b.COLOR||b.COLOR_ID||'',bal=fmt(b.BALANCE_MTR);
        name.textContent=fabric;meta.textContent=color+' · '+bal+' m available';summary.textContent=fabric+' · '+color;
        styleSel.innerHTML='<option value="">Select style</option>'+styleOptions(compatible(b));meter.max=num(b.BALANCE_MTR)
      };
      card.querySelector('.cs-remove').onclick=function(){
        if(host.querySelectorAll('.cs-line-card').length===1)return notify('At least one issue line is required.',true);
        card.remove();totals()
      };
      meter.oninput=function(){totals()};
      [].slice.call(card.querySelectorAll('.cs-size-input')).forEach(function(x){x.oninput=function(){updateCard(card)}});
      totals();card.scrollIntoView({behavior:'smooth',block:'nearest'})
    }

    document.getElementById('csAdd').onclick=addCard;
    document.getElementById('csAddTop').onclick=addCard;
    addCard();

    document.getElementById('csPageForm').onsubmit=async function(e){
      e.preventDefault();
      const fd=new FormData(e.target),vendor=String(fd.get('STITCHING_VENDOR_ID')||'');
      if(!vendor)return notify('Select Cutting & Stitching Vendor.',true);

      const cards=[].slice.call(host.querySelectorAll('.cs-line-card')),items=[],seen=new Set();
      try{
        for(let i=0;i<cards.length;i++){
          const card=cards[i],batch=card.querySelector('.cs-batch').value,style=card.querySelector('.cs-style').value,mtr=num(card.querySelector('.cs-mtr').value);
          const lineSizes=[].slice.call(card.querySelectorAll('.cs-size-input')).map(function(x){return {SIZE_ID:x.dataset.size,QTY:num(x.value)}}).filter(function(x){return x.QTY>0});
          if(!batch)throw new Error('Select Dye Batch on Issue Line '+(i+1)+'.');
          if(!style)throw new Error('Select Style on Issue Line '+(i+1)+'.');
          if(mtr<=0)throw new Error('Enter Fabric Meter on Issue Line '+(i+1)+'.');
          if(!lineSizes.length)throw new Error('Enter at least one size quantity on Issue Line '+(i+1)+'.');
          const key=batch+'|'+style;if(seen.has(key))throw new Error('Same Dye Batch + Style is repeated. Combine it into one issue line.');seen.add(key);
          items.push({DYE_BATCH_ID:batch,STYLE_ID:style,ALLOCATED_MTR:mtr,sizes:lineSizes})
        }
      }catch(err){notify(err.message,true);return}

      const rec={ISSUE_DATE:fd.get('ISSUE_DATE'),EXPECTED_DATE:fd.get('EXPECTED_DATE'),STITCHING_VENDOR_ID:vendor,NOTES:fd.get('NOTES'),items:items};
      const saveBtn=e.target.querySelector('.cs-save-btn'),old=saveBtn.textContent;saveBtn.disabled=true;saveBtn.textContent='Creating Issue…';
      try{
        const out=await api('/api/data',{method:'POST',body:JSON.stringify({module:'cutstitch_bulk',record:rec,requestId:uid()})});
        notify('Bulk issue created: '+num(out.record&&out.record.ISSUE_COUNT)+' line(s)',false);backToList()
      }catch(err){notify(err.message,true);saveBtn.disabled=false;saveBtn.textContent=old}
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