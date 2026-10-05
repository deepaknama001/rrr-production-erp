let READ_MEMO={};let DB_MEMO=null;let SHEET_MEMO={};
const ERP={TZ:'Asia/Kolkata',DB_ID:'1iTKvM-KaGd3HuoknpyYz9IYpFRw1dtFlmv2f8sZo-HA',S:{USERS:'USERS',VENDORS:'VENDORS',FABRICS:'FABRICS',COLORS:'COLORS',STYLES:'STYLES',SIZES:'SIZES',DEFECTS:'DEFECT_REASONS',RAW:'RAW_INWARD',DYE:'DYE_JOBS',PROD:'PRODUCTION_BATCHES',STITCH:'STITCHING_JOBS',QC:'QC_EVENTS',HANDOVER:'WAREHOUSE_HANDOVER',AUDIT:'AUDIT_LOG',SETTINGS:'SETTINGS'}};
function doGet(){return out_({ok:true,name:'RRR Production ERP API',time:new Date().toISOString()})}
function doPost(e){READ_MEMO={};DB_MEMO=null;SHEET_MEMO={};try{const b=JSON.parse((e&&e.postData&&e.postData.contents)||'{}'),p=PropertiesService.getScriptProperties(),secret=p.getProperty('API_SECRET');if(!secret||!safe_(String(b.apiSecret||''),secret))return out_({ok:false,status:401,error:'Unauthorized API request.'});const x=b.payload||{};let r;switch(String(b.action||'')){case'health':r={sheet:true,time:new Date().toISOString()};break;case'login':r=login_(x);break;case'get_data':r=getData_(x);break;case'save_record':r=idempotent_(x.requestId,()=>saveRecord_(x));break;case'list_users':r=listUsers_(x);break;case'save_user':r=idempotent_(x.requestId,()=>saveUser_(x));break;default:throw err_('Unknown action.',404)}return out_({ok:true,...r})}catch(e2){console.error(e2);return out_({ok:false,status:e2.status||400,error:e2.message||'Unexpected error.'})}}
function idempotent_(requestId,fn){
  const id=String(requestId||'').trim();
  if(!id)return fn();
  const cache=CacheService.getScriptCache(),key='REQ_'+id.replace(/[^A-Za-z0-9_-]/g,'').slice(0,180);
  const old=cache.get(key);
  if(old){try{return JSON.parse(old)}catch{}}
  const result=fn();
  try{cache.put(key,JSON.stringify(result),21600)}catch(e){}
  return result;
}
function activeTxn_(r){return !/^CANCELLED/i.test(String(r.STATUS||''))}
function db_(){if(DB_MEMO)return DB_MEMO;DB_MEMO=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('MASTER_SPREADSHEET_ID')||ERP.DB_ID);return DB_MEMO}
function sh_(n){if(SHEET_MEMO[n])return SHEET_MEMO[n];const s=db_().getSheetByName(n);if(!s)throw err_('Missing sheet: '+n,500);return SHEET_MEMO[n]=s}
function rows_(n){if(READ_MEMO[n])return READ_MEMO[n];const v=sh_(n).getDataRange().getValues();if(!v.length)return READ_MEMO[n]=[];const h=v[0].map(String);return READ_MEMO[n]=v.slice(1).filter(r=>r.some(x=>x!==''&&x!==null)).map((r,i)=>{const o={__row:i+2};h.forEach((k,j)=>o[k]=r[j]);return o})}
function findUser_(id){const u=rows_(ERP.S.USERS).find(x=>uid_(x.USER_ID)===id);return u?{row:u.__row,user:u}:null}
function publicUser_(u){return{userId:String(u.USER_ID||''),name:String(u.NAME||''),role:String(u.ROLE||'EMPLOYEE'),admin:truth_(u.ADMIN),active:truth_(u.ACTIVE),permissions:{raw:truth_(u.PERM_RAW),dye:truth_(u.PERM_DYE),production:truth_(u.PERM_PRODUCTION),stitching:truth_(u.PERM_STITCHING),qc:truth_(u.PERM_QC),reports:truth_(u.PERM_REPORTS)}}}
function actor_(id,perm,admin){const f=findUser_(uid_(id));if(!f||!truth_(f.user.ACTIVE))throw err_('User not active.',401);const u=publicUser_(f.user);if(admin&&!u.admin)throw err_('Admin permission required.',403);if(perm&&!u.admin&&!u.permissions[perm])throw err_('Permission denied.',403);return u}
function login_(p){const id=uid_(p.userId),pin=String(p.pin||'');if(!id||!pin)throw err_('Employee ID and PIN required.',400);const f=findUser_(id);if(!f||!truth_(f.user.ACTIVE))throw err_('Invalid Employee ID or PIN.',401);const now=new Date();if(f.user.LOCKED_UNTIL&&new Date(f.user.LOCKED_UNTIL).getTime()>now.getTime())throw err_('Too many failed attempts. Try again later.',429);if(!safe_(hashPin_(id,pin),String(f.user.PIN_HASH||''))){let a=Number(f.user.FAILED_ATTEMPTS||0)+1,l='';if(a>=5){l=new Date(now.getTime()+10*60*1000);a=0}sh_(ERP.S.USERS).getRange(f.row,13,1,2).setValues([[a,l]]);throw err_(l?'Login locked for 10 minutes.':'Invalid Employee ID or PIN.',l?429:401)}sh_(ERP.S.USERS).getRange(f.row,13,1,3).setValues([[0,'',now]]);return{user:publicUser_(f.user),kpis:kpis_()}}
function listUsers_(p){actor_(p.actorUserId,null,true);return{items:rows_(ERP.S.USERS).map(publicUser_)}}
function saveUser_(p){const a=actor_(p.actorUserId,null,true),id=uid_(p.userId),name=String(p.name||'').trim(),pin=String(p.pin||''),role=String(p.role||'EMPLOYEE').toUpperCase();if(!id||!name)throw err_('User ID and name required.',400);if(pin&&!/^\d{4,8}$/.test(pin))throw err_('PIN must be 4–8 digits.',400);const f=findUser_(id),now=new Date();if(!f&&!pin)throw err_('PIN required for new user.',400);const row=[id,name,pin?hashPin_(id,pin):f.user.PIN_HASH,role,!!p.perm_raw,!!p.perm_dye,!!p.perm_production,!!p.perm_stitching,!!p.perm_qc,!!p.perm_reports,!!p.admin,p.active!==false,f?Number(f.user.FAILED_ATTEMPTS||0):0,f?(f.user.LOCKED_UNTIL||''):'',f?(f.user.LAST_LOGIN||''):'',f?(f.user.CREATED_AT||now):now,now];if(f)sh_(ERP.S.USERS).getRange(f.row,1,1,row.length).setValues([row]);else sh_(ERP.S.USERS).appendRow(row);audit_(a,'SAVE_USER','USERS',id,'',JSON.stringify(publicUser_(objFrom_(ERP.S.USERS,row))));return{user:publicUser_(objFrom_(ERP.S.USERS,row))}}
function getData_(p){const m=String(p.module||'dashboard');const perm={raw:'raw',dye:'dye',production:'production',stitching:'stitching',qc:'qc',handover:'qc',reports:'reports'}[m]||null;const a=actor_(p.actorUserId,perm,false);if(m==='dashboard')return{user:a,kpis:kpis_()};if(m==='lookups')return{lookups:lookupData_()};if(m==='raw')return{items:viewRaw_()};if(m==='dye')return{items:viewDye_()};if(m==='production')return{items:viewProd_()};if(m==='stitching')return{items:viewStitch_()};if(m==='qc')return{items:viewQc_()};if(m==='handover')return{items:viewHandover_()};if(m==='reports')return{items:[],kpis:kpis_()};if(m==='masters'){actor_(p.actorUserId,null,true);return{masters:masterData_()}}throw err_('Unknown module.',404)}
function saveRecord_(p){const m=String(p.module||''),r=p.record||{},perm={raw:'raw',raw_bulk:'raw',dye:'dye',production:'production',stitching:'stitching',qc:'qc',handover:'qc'}[m]||null,a=actor_(p.actorUserId,perm,false),lock=LockService.getScriptLock();lock.waitLock(20000);try{if(m==='raw')return{saved:true,record:saveRaw_(r,a)};if(m==='raw_bulk')return{saved:true,record:saveRawBulk_(r,a)};if(m==='dye')return{saved:true,record:saveDye_(r,a)};if(m==='production')return{saved:true,record:saveProd_(r,a)};if(m==='stitching')return{saved:true,record:saveStitch_(r,a)};if(m==='qc')return{saved:true,record:saveQc_(r,a)};if(m==='handover')return{saved:true,record:saveHandover_(r,a)};if(m==='master'){actor_(p.actorUserId,null,true);return{saved:true,record:saveMaster_(r,a)}}throw err_('Unknown module.',404)}finally{lock.releaseLock()}}
function saveRaw_(r,a){const now=new Date(),id=nextId_('INW'),roll=nextId_('RF'),m=num_(r.INWARD_MTR);requirePos_(m,'Inward meter');const row=[uuid_(),id,roll,date_(r.INWARD_DATE),String(r.SUPPLIER_ID||''),String(r.VENDOR_ROLL_NO||''),String(r.FABRIC_ID||''),m,String(r.INVOICE_CHALLAN||''),String(r.LOT_REF||''),'AVAILABLE',String(r.NOTES||''),a.userId,now,a.userId,now];sh_(ERP.S.RAW).appendRow(row);audit_(a,'CREATE','RAW',roll,'',JSON.stringify(row));return{ROLL_ID:roll,INWARD_ID:id}}
function saveDye_(r,a){const now=new Date(),id=nextId_('DB'),issue=num_(r.ISSUE_MTR),roll=String(r.ROLL_ID||'');requirePos_(issue,'Issue meter');if(rawBalance_(roll)<issue)throw err_('Issue meter exceeds raw roll balance.',409);const row=[uuid_(),id,date_(r.ISSUE_DATE),String(r.DYE_VENDOR_ID||''),roll,vendorRoll_(roll),fabricForRoll_(roll),String(r.COLOR_ID||''),issue,'','','','','','AT DYE VENDOR','',String(r.NOTES||''),a.userId,now,a.userId,now];sh_(ERP.S.DYE).appendRow(row);audit_(a,'CREATE','DYE',id,'',JSON.stringify(row));return{DYE_BATCH_ID:id}}
function saveProd_(r,a){const now=new Date(),id=nextId_('PB'),batch=String(r.DYE_BATCH_ID||''),alloc=num_(r.ALLOCATED_MTR);if(dyeBalance_(batch)<alloc)throw err_('Allocated meter exceeds dyed usable balance.',409);const row=[uuid_(),id,date_(r.PLAN_DATE),batch,String(r.STYLE_ID||''),fabricForDye_(batch),colorForDye_(batch),num_(r.PLANNED_QTY),alloc,'','','','',0,0,0,0,0,0,0,'PLANNED',String(r.NOTES||''),a.userId,now,a.userId,now];sh_(ERP.S.PROD).appendRow(row);audit_(a,'CREATE','PRODUCTION',id,'',JSON.stringify(row));return{PRODUCTION_BATCH_ID:id}}
function saveStitch_(r,a){const now=new Date(),id=nextId_('STC'),sizes=['M','L','XL','2XL','3XL','OTHER'].map(x=>num_(r[x+'_ISSUED'])),total=sizes.reduce((x,y)=>x+y,0),pb=String(r.PRODUCTION_BATCH_ID||'');if(cutBalance_(pb)<total)throw err_('Issued pieces exceed cut stock balance.',409);const row=[uuid_(),id,date_(r.ISSUE_DATE),String(r.STITCHING_VENDOR_ID||''),pb,styleForProd_(pb),colorForProd_(pb),...sizes,0,0,0,0,0,0,total,0,total,'PENDING FROM VENDOR',String(r.NOTES||''),a.userId,now,a.userId,now];sh_(ERP.S.STITCH).appendRow(row);audit_(a,'CREATE','STITCHING',id,'',JSON.stringify(row));return{CHALLAN_ID:id}}
function saveQc_(r,a){const now=new Date(),id=nextId_('QC'),q=num_(r.QC_QTY),pass=num_(r.PASS_QTY),rw=num_(r.REWORK_QTY),rej=num_(r.REJECT_QTY),c=String(r.CHALLAN_ID||'');if(pass+rw+rej>q)throw err_('Pass + Rework + Reject cannot exceed QC Qty.',409);const row=[id,date_(r.QC_DATE),c,prodForChallan_(c),vendorForChallan_(c),styleForChallan_(c),colorForChallan_(c),String(r.SIZE||''),q,pass,rw,rej,0,String(r.DEFECT_REASON||''),'',0,pass,'OPEN',String(r.NOTES||''),a.userId,now,a.userId,now];sh_(ERP.S.QC).appendRow(row);audit_(a,'CREATE','QC',id,'',JSON.stringify(row));return{QC_ID:id}}
function saveHandover_(r,a){const now=new Date(),id=nextId_('WH'),accepted=num_(r.ACCEPTED_QTY),rec=num_(r.WAREHOUSE_RECEIVED_QTY),pending=Math.max(0,accepted-rec),row=[id,date_(r.HANDOVER_DATE),String(r.PRODUCTION_BATCH_ID||''),String(r.STYLE_ID||''),String(r.COLOR_ID||''),String(r.SIZE||''),accepted,rec,pending,String(r.WAREHOUSE_REF||''),pending?'PARTIAL':'RECEIVED',String(r.NOTES||''),a.userId,now,a.userId,now];sh_(ERP.S.HANDOVER).appendRow(row);audit_(a,'CREATE','HANDOVER',id,'',JSON.stringify(row));return{HANDOVER_ID:id}}


function lookupData_(){
  const active=x=>x.filter(r=>truth_(r.ACTIVE));
  return {
    vendors:active(rows_(ERP.S.VENDORS)),
    fabrics:active(rows_(ERP.S.FABRICS)),
    colors:active(rows_(ERP.S.COLORS)),
    styles:active(rows_(ERP.S.STYLES)),
    sizes:active(rows_(ERP.S.SIZES)),
    defects:active(rows_(ERP.S.DEFECTS)),
    rawRolls:viewRaw_().filter(r=>rawBalance_(r.ROLL_ID)>0).map(r=>({...r,BALANCE_MTR:rawBalance_(r.ROLL_ID)})),
    dyeBatches:viewDye_().filter(r=>dyeBalance_(r.DYE_BATCH_ID)>0).map(r=>({...r,BALANCE_MTR:dyeBalance_(r.DYE_BATCH_ID)})),
    productionBatches:viewProd_().filter(r=>cutBalance_(r.PRODUCTION_BATCH_ID)>0).map(r=>({...r,CUT_BALANCE:cutBalance_(r.PRODUCTION_BATCH_ID)}))
  };
}
function rawBulkFingerprint_(supplier,invoice,lot,dateVal,items){
  const day=Utilities.formatDate(dateVal,ERP.TZ,'yyyy-MM-dd');
  const lines=items.map(x=>[String(x.FABRIC_ID||''),String(x.VENDOR_ROLL_NO||''),num_(x.INWARD_MTR).toFixed(3)].join('|')).sort();
  return [String(supplier),String(invoice),String(lot),day,lines.join('~')].join('||');
}
function findExistingRawBulk_(supplier,invoice,lot,dateVal,items){
  const target=rawBulkFingerprint_(supplier,invoice,lot,dateVal,items),groups={};
  rows_(ERP.S.RAW).filter(activeTxn_).forEach(r=>{
    const id=String(r.INWARD_ID||''); if(!id)return;
    (groups[id]||(groups[id]=[])).push(r);
  });
  for(const [id,rs] of Object.entries(groups)){
    const first=rs[0];
    const fp=rawBulkFingerprint_(first.SUPPLIER_ID,first.INVOICE_CHALLAN,first.LOT_REF,new Date(first.INWARD_DATE),rs.map(x=>({FABRIC_ID:x.FABRIC_ID,VENDOR_ROLL_NO:x.VENDOR_ROLL_NO,INWARD_MTR:x.INWARD_MTR})));
    if(fp===target)return {INWARD_ID:id,ROLL_COUNT:rs.length,TOTAL_MTR:rs.reduce((s,x)=>s+num_(x.INWARD_MTR),0),ROLL_IDS:rs.map(x=>x.ROLL_ID),DUPLICATE_PREVENTED:true};
  }
  return null;
}
function saveRawBulk_(r,a){
  const inwardDate=date_(r.INWARD_DATE),supplier=String(r.SUPPLIER_ID||''),invoice=String(r.INVOICE_CHALLAN||''),lot=String(r.LOT_REF||''),notes=String(r.NOTES||''),items=Array.isArray(r.items)?r.items:[];
  if(!supplier) throw err_('Supplier is required.',400);
  if(!items.length) throw err_('Add at least one fabric roll.',400);
  items.forEach((x,i)=>{if(!String(x.FABRIC_ID||''))throw err_('Fabric is required on roll '+(i+1)+'.',400);requirePos_(num_(x.INWARD_MTR),'Roll '+(i+1)+' meter')});
  const existing=findExistingRawBulk_(supplier,invoice,lot,inwardDate,items);
  if(existing)return existing;
  const inwardId=nextId_('INW'),now=new Date(),rows=[];
  items.forEach(x=>{
    const roll=nextId_('RF');
    rows.push([uuid_(),inwardId,roll,inwardDate,supplier,String(x.VENDOR_ROLL_NO||''),String(x.FABRIC_ID||''),num_(x.INWARD_MTR),invoice,lot,'AVAILABLE',String(x.NOTES||notes||''),a.userId,now,a.userId,now]);
  });
  const sh=sh_(ERP.S.RAW),start=sh.getLastRow()+1;
  sh.getRange(start,1,rows.length,rows[0].length).setValues(rows);
  READ_MEMO[ERP.S.RAW]=null;
  audit_(a,'CREATE_BULK','RAW',inwardId,'',JSON.stringify({supplier,invoice,lot,rolls:items.length,totalMeter:items.reduce((s,x)=>s+num_(x.INWARD_MTR),0)}));
  return {INWARD_ID:inwardId,ROLL_COUNT:rows.length,TOTAL_MTR:rows.reduce((s,x)=>s+num_(x[7]),0),ROLL_IDS:rows.map(x=>x[2])};
}

function masterData_(){
  return {
    vendors: rows_(ERP.S.VENDORS),
    fabrics: rows_(ERP.S.FABRICS),
    colors: rows_(ERP.S.COLORS),
    styles: rows_(ERP.S.STYLES),
    sizes: rows_(ERP.S.SIZES),
    defects: rows_(ERP.S.DEFECTS)
  };
}
function saveMaster_(r,a){
  const entity=String(r.entity||'').toLowerCase(),now=new Date();
  const map={
    vendor:{sheet:ERP.S.VENDORS,key:'VENDOR_ID',prefix:'VEN',fields:['VENDOR_ID','VENDOR_NAME','FABRIC_SUPPLIER','DYE_VENDOR','STITCHING_VENDOR','CUTTING_VENDOR','PHONE','GST_REF','ADDRESS','ACTIVE','CREATED_AT','UPDATED_AT']},
    fabric:{sheet:ERP.S.FABRICS,key:'FABRIC_ID',prefix:'FAB',fields:['FABRIC_ID','FABRIC_NAME','FABRIC_CODE','UOM','ACTIVE','NOTES','CREATED_AT','UPDATED_AT']},
    color:{sheet:ERP.S.COLORS,key:'COLOR_ID',prefix:'CLR',fields:['COLOR_ID','COLOR_NAME','COLOR_CODE','ACTIVE','CREATED_AT','UPDATED_AT']},
    style:{sheet:ERP.S.STYLES,key:'STYLE_ID',prefix:'STY',fields:['STYLE_ID','STYLE_NAME','CATEGORY','STYLE_CODE','DEFAULT_FABRIC_ID','ACTIVE','NOTES','CREATED_AT','UPDATED_AT']},
    size:{sheet:ERP.S.SIZES,key:'SIZE_ID',prefix:'SIZ',fields:['SIZE_ID','SIZE_NAME','SORT_ORDER','ACTIVE','CREATED_AT','UPDATED_AT']},
    defect:{sheet:ERP.S.DEFECTS,key:'DEFECT_ID',prefix:'DEF',fields:['DEFECT_ID','DEFECT_NAME','STAGE','CATEGORY','ACTIVE','NOTES','CREATED_AT','UPDATED_AT']}
  };
  const cfg=map[entity]; if(!cfg) throw err_('Unknown master type.',400);
  const id=String(r[cfg.key]||'').trim()||nextMasterId_(cfg.prefix);
  const existing=rows_(cfg.sheet).find(x=>String(x[cfg.key])===id);
  const obj={...r,[cfg.key]:id,ACTIVE:r.ACTIVE===false||String(r.ACTIVE).toLowerCase()==='false'?false:true,CREATED_AT:existing?existing.CREATED_AT:now,UPDATED_AT:now};
  const row=cfg.fields.map(k=>obj[k]===undefined?'':obj[k]);
  const sh=sh_(cfg.sheet);
  if(existing) sh.getRange(existing.__row,1,1,row.length).setValues([row]); else sh.appendRow(row);
  audit_(a,existing?'UPDATE_MASTER':'CREATE_MASTER',entity.toUpperCase(),id,existing?JSON.stringify(existing):'',JSON.stringify(obj));
  return obj;
}
function nextMasterId_(prefix){
  const p=PropertiesService.getScriptProperties(),k='MASTER_SEQ_'+prefix,n=Number(p.getProperty(k)||0)+1;
  p.setProperty(k,String(n)); return prefix+'-'+String(n).padStart(4,'0');
}

function kpis_(){const raw=rows_(ERP.S.RAW).filter(activeTxn_),dye=rows_(ERP.S.DYE),prod=rows_(ERP.S.PROD),st=rows_(ERP.S.STITCH),qc=rows_(ERP.S.QC),hand=rows_(ERP.S.HANDOVER);return{rawAvailable:raw.reduce((s,r)=>s+rawBalance_(r.ROLL_ID),0),atDye:dye.reduce((s,r)=>s+Math.max(0,num_(r.ISSUE_MTR)-num_(r.RECEIVED_MTR)),0),dyedAvailable:dye.reduce((s,r)=>s+dyeBalance_(r.DYE_BATCH_ID),0),cutPending:prod.reduce((s,r)=>s+cutBalance_(r.PRODUCTION_BATCH_ID),0),atStitching:st.reduce((s,r)=>s+Math.max(0,num_(r.TOTAL_ISSUED)-num_(r.TOTAL_RECEIVED)),0),readyWarehouse:qc.reduce((s,r)=>s+num_(r.FINAL_ACCEPTED_QTY),0)-hand.reduce((s,r)=>s+num_(r.WAREHOUSE_RECEIVED_QTY),0)}}
function viewRaw_(){return rows_(ERP.S.RAW).filter(activeTxn_).map(r=>({...r,SUPPLIER:vendorName_(r.SUPPLIER_ID),FABRIC:fabricName_(r.FABRIC_ID)}))}
function viewDye_(){return rows_(ERP.S.DYE).map(r=>({...r,DYE_VENDOR:vendorName_(r.DYE_VENDOR_ID),COLOR:colorName_(r.COLOR_ID)}))}
function viewProd_(){return rows_(ERP.S.PROD).map(r=>({...r,STYLE:styleName_(r.STYLE_ID)}))}
function viewStitch_(){return rows_(ERP.S.STITCH).map(r=>({...r,STITCHING_VENDOR:vendorName_(r.STITCHING_VENDOR_ID)}))}
function viewQc_(){return rows_(ERP.S.QC)}
function viewHandover_(){return rows_(ERP.S.HANDOVER).map(r=>({...r,STYLE:styleName_(r.STYLE_ID),COLOR:colorName_(r.COLOR_ID)}))}
function rawBalance_(roll){const inward=rows_(ERP.S.RAW).filter(r=>activeTxn_(r)&&String(r.ROLL_ID)===String(roll)).reduce((s,r)=>s+num_(r.INWARD_MTR),0),issued=rows_(ERP.S.DYE).filter(r=>String(r.ROLL_ID)===String(roll)).reduce((s,r)=>s+num_(r.ISSUE_MTR),0);return inward-issued}
function dyeBalance_(id){const d=rows_(ERP.S.DYE).find(r=>String(r.DYE_BATCH_ID)===String(id));if(!d)return 0;const usable=num_(d.USABLE_MTR)||(num_(d.RECEIVED_MTR)-num_(d.DEFECT_MTR)),used=rows_(ERP.S.PROD).filter(r=>String(r.DYE_BATCH_ID)===String(id)).reduce((s,r)=>s+num_(r.ALLOCATED_MTR),0);return usable-used}
function cutBalance_(pb){const p=rows_(ERP.S.PROD).find(r=>String(r.PRODUCTION_BATCH_ID)===String(pb));if(!p)return 0;const cut=num_(p.TOTAL_CUT)||['M_CUT','L_CUT','XL_CUT','2XL_CUT','3XL_CUT','OTHER_CUT'].reduce((s,k)=>s+num_(p[k]),0),issued=rows_(ERP.S.STITCH).filter(r=>String(r.PRODUCTION_BATCH_ID)===String(pb)).reduce((s,r)=>s+num_(r.TOTAL_ISSUED),0);return cut-issued}
function audit_(u,action,module,id,oldV,newV){sh_(ERP.S.AUDIT).appendRow([uuid_(),new Date(),u.userId,u.name,action,module,id,oldV,newV,'',''])}
function nextId_(prefix){const p=PropertiesService.getScriptProperties(),k='SEQ_'+prefix,n=Number(p.getProperty(k)||0)+1;p.setProperty(k,String(n));return prefix+'-'+Utilities.formatDate(new Date(),ERP.TZ,'yyMMdd')+'-'+String(n).padStart(4,'0')}
function byId_(sheet,key,id){return rows_(sheet).find(r=>String(r[key])===String(id))||{}}
function vendorName_(id){return String(byId_(ERP.S.VENDORS,'VENDOR_ID',id).VENDOR_NAME||id||'')}
function fabricName_(id){return String(byId_(ERP.S.FABRICS,'FABRIC_ID',id).FABRIC_NAME||id||'')}
function colorName_(id){return String(byId_(ERP.S.COLORS,'COLOR_ID',id).COLOR_NAME||id||'')}
function styleName_(id){return String(byId_(ERP.S.STYLES,'STYLE_ID',id).STYLE_NAME||id||'')}
function vendorRoll_(roll){return String(byId_(ERP.S.RAW,'ROLL_ID',roll).VENDOR_ROLL_NO||'')}
function fabricForRoll_(roll){return String(byId_(ERP.S.RAW,'ROLL_ID',roll).FABRIC_ID||'')}
function fabricForDye_(id){return String(byId_(ERP.S.DYE,'DYE_BATCH_ID',id).FABRIC_ID||'')}
function colorForDye_(id){return String(byId_(ERP.S.DYE,'DYE_BATCH_ID',id).COLOR_ID||'')}
function styleForProd_(id){return String(byId_(ERP.S.PROD,'PRODUCTION_BATCH_ID',id).STYLE_ID||'')}
function colorForProd_(id){return String(byId_(ERP.S.PROD,'PRODUCTION_BATCH_ID',id).COLOR_ID||'')}
function prodForChallan_(id){return String(byId_(ERP.S.STITCH,'CHALLAN_ID',id).PRODUCTION_BATCH_ID||'')}
function vendorForChallan_(id){return String(byId_(ERP.S.STITCH,'CHALLAN_ID',id).STITCHING_VENDOR_ID||'')}
function styleForChallan_(id){return String(byId_(ERP.S.STITCH,'CHALLAN_ID',id).STYLE_ID||'')}
function colorForChallan_(id){return String(byId_(ERP.S.STITCH,'CHALLAN_ID',id).COLOR_ID||'')}
function objFrom_(sheetName,row){const h=sh_(sheetName).getRange(1,1,1,row.length).getValues()[0],o={};h.forEach((k,i)=>o[k]=row[i]);return o}
function uuid_(){return Utilities.getUuid()}
function uid_(v){return String(v||'').trim().toUpperCase()}
function num_(v){const n=Number(v||0);return isFinite(n)?n:0}
function truth_(v){return v===true||String(v).toLowerCase()==='true'||v===1}
function date_(v){return v?new Date(v):new Date()}
function err_(m,s){const e=new Error(m);e.status=s;return e}
function requirePos_(n,l){if(!(Number(n)>0))throw err_(l+' must be greater than zero.',400)}
function safe_(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let o=0;for(let i=0;i<a.length;i++)o|=a.charCodeAt(i)^b.charCodeAt(i);return o===0}
function hashPin_(id,pin){const salt=PropertiesService.getScriptProperties().getProperty('PIN_SALT')||'';return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,id+'|'+pin+'|'+salt))}
function hex_(b){return b.map(x=>(x<0?x+256:x).toString(16).padStart(2,'0')).join('')}
function out_(o){return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON)}