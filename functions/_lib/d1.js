import {D1_SCHEMA} from './d1-schema.js';

const TABLE_MAP={
  USERS:'users',VENDORS:'vendors',FABRICS:'fabrics',COLORS:'colors',STYLES:'styles',SIZES:'sizes',
  DEFECT_REASONS:'defect_reasons',RAW_INWARD:'raw_inward',DYE_JOBS:'dye_jobs',DYE_RECEIPTS:'dye_receipts',
  PRODUCTION_BATCHES:'production_batches',STITCHING_JOBS:'stitching_jobs',QC_EVENTS:'qc_events',
  WAREHOUSE_HANDOVER:'warehouse_handover',AUDIT_LOG:'audit_log',SETTINGS:'settings'
};
const BOOL_COLS=new Set(['PERM_RAW','PERM_DYE','PERM_PRODUCTION','PERM_STITCHING','PERM_QC','PERM_REPORTS','ADMIN','ACTIVE','FABRIC_SUPPLIER','DYE_VENDOR','STITCHING_VENDOR','CUTTING_VENDOR','FINAL_RECEIPT']);
const NUM_COLS=new Set(['FAILED_ATTEMPTS','SORT_ORDER','INWARD_MTR','ISSUE_MTR','RECEIVED_MTR','SHRINKAGE_MTR','DEFECT_MTR','USABLE_MTR','VARIANCE_MTR','PLANNED_QTY','ALLOCATED_MTR','CONSUMED_MTR','CUTTING_WASTE_MTR','M_CUT','L_CUT','XL_CUT','2XL_CUT','3XL_CUT','OTHER_CUT','TOTAL_CUT','M_ISSUED','L_ISSUED','XL_ISSUED','2XL_ISSUED','3XL_ISSUED','OTHER_ISSUED','M_RECEIVED','L_RECEIVED','XL_RECEIVED','2XL_RECEIVED','3XL_RECEIVED','OTHER_RECEIVED','TOTAL_ISSUED','TOTAL_RECEIVED','PENDING_QTY','QC_QTY','PASS_QTY','REWORK_QTY','REJECT_QTY','SHORT_QTY','REWORK_RETURNED_QTY','FINAL_ACCEPTED_QTY','ACCEPTED_QTY','WAREHOUSE_RECEIVED_QTY']);

function err(message,status=400){const e=new Error(message);e.status=status;return e}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0}
function truth(v){return v===true||v===1||String(v).toLowerCase()==='true'||String(v).toLowerCase()==='yes'}
function iso(v){if(v===null||v===undefined||v==='')return '';const d=v instanceof Date?v:new Date(v);return Number.isNaN(d.getTime())?String(v):d.toISOString()}
function dateOnly(v){if(!v)return new Date().toISOString().slice(0,10);const d=new Date(v);return Number.isNaN(d.getTime())?String(v).slice(0,10):d.toISOString().slice(0,10)}
function now(){return new Date().toISOString()}
function uuid(){return crypto.randomUUID()}
function requirePos(v,label){if(!(n(v)>0))throw err(label+' must be greater than 0.',400)}
function cleanRow(row){const o={};for(const [k,v] of Object.entries(row||{})){if(BOOL_COLS.has(k))o[k]=truth(v)?1:0;else if(NUM_COLS.has(k))o[k]=n(v);else if(/(?:_AT|_DATE|TIMESTAMP|LOCKED_UNTIL|LAST_LOGIN)$/.test(k)&&v)o[k]=iso(v);else o[k]=v??''}return o}
function publicUser(u){return{userId:String(u?.USER_ID||''),name:String(u?.NAME||''),role:String(u?.ROLE||'EMPLOYEE'),admin:truth(u?.ADMIN),active:truth(u?.ACTIVE),permissions:{raw:truth(u?.PERM_RAW),dye:truth(u?.PERM_DYE),production:truth(u?.PERM_PRODUCTION),stitching:truth(u?.PERM_STITCHING),qc:truth(u?.PERM_QC),reports:truth(u?.PERM_REPORTS)}}}
function kolkataStamp(){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',year:'2-digit',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const m=Object.fromEntries(parts.map(p=>[p.type,p.value]));return m.year+m.month+m.day}
async function digestHex(text){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function safeEq(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}

let schemaReadyPromise=null;
async function ensureSchema(env){
  if(!env?.DB)return;
  if(!schemaReadyPromise)schemaReadyPromise=(async()=>{
    await env.DB.exec(D1_SCHEMA);
    try{
      await env.DB.batch([
        env.DB.prepare("DELETE FROM request_log WHERE created_at < datetime('now','-7 day')"),
        env.DB.prepare("DELETE FROM resource_locks WHERE ACQUIRED_AT < datetime('now','-10 minute')"),
        env.DB.prepare("DELETE FROM app_errors WHERE TIMESTAMP < datetime('now','-90 day')")
      ])
    }catch{}
  })().catch(e=>{schemaReadyPromise=null;throw e});
  await schemaReadyPromise
}
function intQty(v,label='Quantity',allowZero=true){
  const x=Number(v);
  if(!Number.isFinite(x)||!Number.isInteger(x)||(allowZero?x<0:x<=0))throw err(label+' must be a whole number'+(allowZero?' 0 or greater.':' greater than 0.'),400);
  return x
}
const LEGACY_SIZE_COL={M:'M',L:'L',XL:'XL','2XL':'2XL','3XL':'3XL',OTHER:'OTHER'};
const STATUS_RULES={
  production:{'PLANNED':['CUT COMPLETE','CANCELLED'],'CUT COMPLETE':['CANCELLED']},
  stitching:{'PENDING FROM VENDOR':['PARTIAL RECEIVED','RECEIVED COMPLETE','CANCELLED'],'PARTIAL RECEIVED':['PARTIAL RECEIVED','RECEIVED COMPLETE','CANCELLED'],'RECEIVED COMPLETE':['CANCELLED']},
  qc:{'QC COMPLETE':['REWORK PARTIAL','REWORK CLOSED','CANCELLED'],'REWORK PARTIAL':['REWORK PARTIAL','REWORK CLOSED','CANCELLED'],'REWORK CLOSED':['CANCELLED']},
  handover:{'PARTIAL':['PARTIAL','RECEIVED','CANCELLED'],'RECEIVED':['CANCELLED']},
  rework:{'AT REWORK':['PARTIAL REWORK RETURN','REWORK CLOSED','CANCELLED'],'PARTIAL REWORK RETURN':['PARTIAL REWORK RETURN','REWORK CLOSED']}
};
function assertTransition(domain,from,to){
  const f=String(from||''),t=String(to||'');if(!f||f===t||t==='CANCELLED')return true;
  const allowed=STATUS_RULES[domain]?.[f];if(allowed&&!allowed.includes(t))throw err('Invalid '+domain+' status transition: '+f+' → '+t,409);return true
}

async function actionPerms(db,userId){
  const rs=await rows(db,'SELECT * FROM user_action_permissions WHERE USER_ID=?',String(userId||'').toUpperCase()),o={};
  for(const r of rs)o[String(r.MODULE||'')]={
    view:truth(r.CAN_VIEW),create:truth(r.CAN_CREATE),edit:truth(r.CAN_EDIT),
    cancel:truth(r.CAN_CANCEL),export:truth(r.CAN_EXPORT),audit:truth(r.CAN_AUDIT)
  };
  return o
}
async function requireAction(db,user,module,action){
  if(user.admin)return true;
  if(module&&!user.permissions?.[module])throw err('Permission denied.',403);
  const r=await row(db,'SELECT * FROM user_action_permissions WHERE USER_ID=? AND MODULE=?',String(user.userId).toUpperCase(),String(module));
  if(!r)return true;
  const col={view:'CAN_VIEW',create:'CAN_CREATE',edit:'CAN_EDIT',cancel:'CAN_CANCEL',export:'CAN_EXPORT',audit:'CAN_AUDIT'}[action];
  if(col&&!truth(r[col]))throw err('You do not have '+action+' permission for this module.',403);
  return true
}
async function acquireLock(db,key,requestId=''){
  const cutoff=new Date(Date.now()-30000).toISOString();
  await db.prepare('DELETE FROM resource_locks WHERE ACQUIRED_AT<?').bind(cutoff).run();
  const r=await db.prepare('INSERT OR IGNORE INTO resource_locks(RESOURCE_KEY,REQUEST_ID,ACQUIRED_AT) VALUES(?,?,?)').bind(String(key),String(requestId||''),now()).run();
  if((r.meta?.changes||0)<1)throw err('Another user is updating this stock right now. Please retry in a moment.',409)
}
async function releaseLock(db,key){try{await db.prepare('DELETE FROM resource_locks WHERE RESOURCE_KEY=?').bind(String(key)).run()}catch{}}
async function logError(db,userId,module,e,context={}){
  try{await db.prepare('INSERT INTO app_errors(ERROR_ID,TIMESTAMP,USER_ID,MODULE,MESSAGE,STACK,CONTEXT_JSON) VALUES(?,?,?,?,?,?,?)')
    .bind(uuid(),now(),String(userId||''),String(module||''),String(e?.message||e||''),String(e?.stack||''),JSON.stringify(context||{})).run()}catch{}
}

export function hasD1(env){return !!env?.DB}
export async function d1Ready(env){
  if(!hasD1(env))return false;
  try{const r=await env.DB.prepare("SELECT value FROM system_meta WHERE key='migration_complete'").first();return String(r?.value||'')==='1'}catch{return false}
}
export async function d1Status(env){
  if(!hasD1(env))return{bound:false,ready:false};
  let meta={};try{const r=await env.DB.prepare("SELECT key,value FROM system_meta").all();for(const x of r.results||[])meta[x.key]=x.value}catch{}
  return{bound:true,ready:String(meta.migration_complete||'')==='1',meta};
}

async function batchChunks(db,stmts,size=75){for(let i=0;i<stmts.length;i+=size)await db.batch(stmts.slice(i,i+size))}
async function setMeta(db,key,value){await db.prepare("INSERT INTO system_meta(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(key,String(value??''),now()).run()}
function quoteCol(c){return '"'+String(c).replace(/"/g,'""')+'"'}
function normalizeCell(header,v){if(v===null||v===undefined)return null;if(BOOL_COLS.has(header))return truth(v)?1:0;if(NUM_COLS.has(header))return n(v);if(/(?:_AT|_DATE|TIMESTAMP|LOCKED_UNTIL|LAST_LOGIN)$/.test(header)&&v)return iso(v);return typeof v==='object'?JSON.stringify(v):String(v)}
function scanSequence(value,seq){const s=String(value||'');const m=s.match(/^([A-Z]+)-(?:\d{6}-)?(\d{4,})$/);if(m)seq[m[1]]=Math.max(seq[m[1]]||0,Number(m[2])||0)}

export async function migrateSnapshotToD1(env,snapshot){
  if(!hasD1(env))throw err('D1 binding DB is missing.',500);
  const db=env.DB;await db.exec(D1_SCHEMA);
  const business=[...Object.values(TABLE_MAP),'request_log','sequences'];
  await db.exec(business.map(t=>'DELETE FROM '+t).join(';'));
  const counts={},seq={};
  for(const [sheet,payload] of Object.entries(snapshot?.tables||{})){
    const table=TABLE_MAP[sheet];if(!table)continue;
    const headers=(payload.headers||[]).filter(Boolean),rows=payload.rows||[];
    counts[sheet]=rows.length;if(!headers.length||!rows.length)continue;
    const sql=`INSERT INTO ${table} (${headers.map(quoteCol).join(',')}) VALUES (${headers.map(()=>'?').join(',')})`;
    const stmts=[];
    for(const row of rows){
      const vals=headers.map((h,i)=>normalizeCell(h,row[i]));
      for(const v of vals)scanSequence(v,seq);
      stmts.push(db.prepare(sql).bind(...vals));
    }
    await batchChunks(db,stmts);
  }
  for(const [prefix,value] of Object.entries(seq))await db.prepare("INSERT INTO sequences(prefix,value) VALUES(?,?) ON CONFLICT(prefix) DO UPDATE SET value=MAX(value,excluded.value)").bind(prefix,value).run();
  await setMeta(db,'pin_salt',snapshot?.pinSalt||'');
  await setMeta(db,'source_spreadsheet_id',snapshot?.spreadsheetId||'');
  await setMeta(db,'migrated_at',snapshot?.exportedAt||now());
  await setMeta(db,'source_counts',JSON.stringify(counts));
  await setMeta(db,'migration_loaded','1');
  await setMeta(db,'migration_complete','0');
  return{ok:true,counts,sequences:seq,migratedAt:snapshot?.exportedAt||now(),activated:false};
}


export async function reconcileD1(env){
  if(!hasD1(env))throw err('D1 binding DB is missing.',500);
  const db=env.DB;await db.exec(D1_SCHEMA);const meta=(await d1Status(env)).meta||{},source=JSON.parse(meta.source_counts||'{}'),counts={};
  for(const [sheet,table] of Object.entries(TABLE_MAP)){const r=await row(db,`SELECT COUNT(*) c FROM ${table}`);counts[sheet]=n(r?.c)}
  const checks={};
  for(const k of Object.keys(TABLE_MAP))checks[k]={source:n(source[k]),d1:n(counts[k]),match:n(source[k])===n(counts[k])};
  const raw=await row(db,`SELECT COALESCE(SUM(INWARD_MTR),0) total,COALESCE(SUM(CASE WHEN COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' THEN INWARD_MTR ELSE 0 END),0) active FROM raw_inward`);
  const dye=await row(db,'SELECT COALESCE(SUM(ISSUE_MTR),0) issued FROM dye_jobs');
  const receipt=await row(db,'SELECT COALESCE(SUM(RECEIVED_MTR),0) received,COALESCE(SUM(USABLE_MTR),0) usable,COALESCE(SUM(DEFECT_MTR),0) defect FROM dye_receipts');
  return{loaded:String(meta.migration_loaded||'')==='1',active:String(meta.migration_complete||'')==='1',checks,allCountsMatch:Object.values(checks).every(x=>x.match),totals:{rawTotal:n(raw?.total),rawActive:n(raw?.active),dyeIssued:n(dye?.issued),dyeReceived:n(receipt?.received),dyeUsable:n(receipt?.usable),dyeDefect:n(receipt?.defect)},meta};
}
export async function activateD1(env){
  const rec=await reconcileD1(env);if(!rec.loaded)throw err('D1 migration data has not been loaded.',409);if(!rec.allCountsMatch)throw err('D1 row-count reconciliation failed. Activation blocked.',409);
  await setMeta(env.DB,'migration_complete','1');await setMeta(env.DB,'activated_at',now());return await reconcileD1(env)
}
export async function deactivateD1(env){if(!hasD1(env))throw err('D1 binding DB is missing.',500);await setMeta(env.DB,'migration_complete','0');await setMeta(env.DB,'deactivated_at',now());return await reconcileD1(env)}

async function row(db,sql,...args){return db.prepare(sql).bind(...args).first()}
async function rows(db,sql,...args){return (await db.prepare(sql).bind(...args).all()).results||[]}
async function userRow(db,id){return row(db,'SELECT * FROM users WHERE USER_ID=?',String(id||'').trim().toUpperCase())}
async function actor(db,id,perm=null,adminOnly=false){
  const u=await userRow(db,id);if(!u||!truth(u.ACTIVE))throw err('User not active.',401);
  const p=publicUser(u);if(adminOnly&&!p.admin)throw err('Admin permission required.',403);if(perm&&!p.admin&&!p.permissions[perm])throw err('Permission denied.',403);return p
}
async function pinSalt(db){const r=await row(db,"SELECT value FROM system_meta WHERE key='pin_salt'");return String(r?.value||'')}
async function hashPin(db,id,pin){return digestHex(String(id).toUpperCase()+'|'+String(pin)+'|'+await pinSalt(db))}

export async function loginD1(env,{userId,pin}){
  await ensureSchema(env);const db=env.DB,id=String(userId||'').trim().toUpperCase();if(!id||!pin)throw err('Employee ID and PIN required.',400);
  const u=await userRow(db,id);if(!u||!truth(u.ACTIVE))throw err('Invalid Employee ID or PIN.',401);
  if(u.LOCKED_UNTIL&&new Date(u.LOCKED_UNTIL).getTime()>Date.now())throw err('Too many failed attempts. Try again later.',429);
  const ok=safeEq(await hashPin(db,id,pin),u.PIN_HASH);
  if(!ok){let attempts=n(u.FAILED_ATTEMPTS)+1,locked='';if(attempts>=5){locked=new Date(Date.now()+10*60*1000).toISOString();attempts=0}await db.prepare('UPDATE users SET FAILED_ATTEMPTS=?,LOCKED_UNTIL=?,UPDATED_AT=? WHERE USER_ID=?').bind(attempts,locked,now(),id).run();throw err(locked?'Login locked for 10 minutes.':'Invalid Employee ID or PIN.',locked?429:401)}
  await db.prepare('UPDATE users SET FAILED_ATTEMPTS=0,LOCKED_UNTIL=?,LAST_LOGIN=?,UPDATED_AT=? WHERE USER_ID=?').bind('',now(),now(),id).run();
  const pu=publicUser(await userRow(db,id));pu.actions=await actionPerms(db,id);return{user:pu,kpis:await kpisD1(db)}
}

async function nextSeq(db,prefix){
  const r=await db.batch([
    db.prepare('INSERT OR IGNORE INTO sequences(prefix,value) VALUES(?,0)').bind(prefix),
    db.prepare('UPDATE sequences SET value=value+1 WHERE prefix=?').bind(prefix),
    db.prepare('SELECT value FROM sequences WHERE prefix=?').bind(prefix)
  ]);
  return n(r[2]?.results?.[0]?.value)
}
async function nextId(db,prefix){const x=await nextSeq(db,prefix);return prefix+'-'+kolkataStamp()+'-'+String(x).padStart(4,'0')}
async function nextMasterId(db,prefix){const x=await nextSeq(db,prefix);return prefix+'-'+String(x).padStart(4,'0')}
async function audit(db,u,action,module,id,oldV='',newV=''){const m=u?.auditMeta||{};await db.prepare('INSERT INTO audit_log(AUDIT_ID,TIMESTAMP,USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID,OLD_VALUE_JSON,NEW_VALUE_JSON,DEVICE_INFO,IP_HASH) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),now(),u.userId,u.name,action,module,id,String(oldV||''),String(newV||''),String(m.device||'').slice(0,300),String(m.ipHash||'').slice(0,100)).run()}


export async function getUiPreferenceD1(env,actorUserId,page){
  const db=env.DB;await actor(db,actorUserId,null,false);
  const key='UIPREF:'+String(actorUserId||'').toUpperCase()+':'+String(page||'');
  const r=await row(db,'SELECT VALUE FROM settings WHERE KEY=?',key);
  if(!r?.VALUE)return{page,prefs:{}};
  try{return{page,prefs:JSON.parse(r.VALUE)}}catch{return{page,prefs:{}}}
}
export async function saveUiPreferenceD1(env,actorUserId,page,prefs){
  const db=env.DB;await actor(db,actorUserId,null,false);
  const key='UIPREF:'+String(actorUserId||'').toUpperCase()+':'+String(page||''),t=now(),value=JSON.stringify(prefs||{});
  await db.prepare('INSERT INTO settings(KEY,VALUE,UPDATED_AT) VALUES(?,?,?) ON CONFLICT(KEY) DO UPDATE SET VALUE=excluded.VALUE,UPDATED_AT=excluded.UPDATED_AT').bind(key,value,t).run();
  return{page,prefs:prefs||{}}
}
export async function listUsersD1(env,actorUserId){
  await ensureSchema(env);const db=env.DB;await actor(db,actorUserId,null,true);
  const us=await rows(db,'SELECT * FROM users ORDER BY NAME,USER_ID'),items=[];
  for(const u of us){const p=publicUser(u);p.actions=await actionPerms(db,u.USER_ID);items.push(p)}
  return{items}
}
export async function saveUserD1(env,p){
  const db=env.DB,a=await actor(db,p.actorUserId,null,true);a.auditMeta=p.auditMeta||{};const id=String(p.userId||'').trim().toUpperCase(),name=String(p.name||'').trim(),pin=String(p.pin||''),role=String(p.role||'EMPLOYEE').toUpperCase();
  if(!id||!name)throw err('User ID and name required.',400);if(pin&&!/^\d{4,8}$/.test(pin))throw err('PIN must be 4–8 digits.',400);
  const old=await userRow(db,id);if(!old&&!pin)throw err('PIN required for new user.',400);
  const t=now(),hash=pin?await hashPin(db,id,pin):old.PIN_HASH;
  await db.prepare(`INSERT INTO users(USER_ID,NAME,PIN_HASH,ROLE,PERM_RAW,PERM_DYE,PERM_PRODUCTION,PERM_STITCHING,PERM_QC,PERM_REPORTS,ADMIN,ACTIVE,FAILED_ATTEMPTS,LOCKED_UNTIL,LAST_LOGIN,CREATED_AT,UPDATED_AT)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(USER_ID) DO UPDATE SET NAME=excluded.NAME,PIN_HASH=excluded.PIN_HASH,ROLE=excluded.ROLE,PERM_RAW=excluded.PERM_RAW,PERM_DYE=excluded.PERM_DYE,PERM_PRODUCTION=excluded.PERM_PRODUCTION,PERM_STITCHING=excluded.PERM_STITCHING,PERM_QC=excluded.PERM_QC,PERM_REPORTS=excluded.PERM_REPORTS,ADMIN=excluded.ADMIN,ACTIVE=excluded.ACTIVE,UPDATED_AT=excluded.UPDATED_AT`)
  .bind(id,name,hash,role,truth(p.perm_raw)?1:0,truth(p.perm_dye)?1:0,truth(p.perm_production)?1:0,truth(p.perm_stitching)?1:0,truth(p.perm_qc)?1:0,truth(p.perm_reports)?1:0,truth(p.admin)?1:0,p.active===false?0:1,n(old?.FAILED_ATTEMPTS),old?.LOCKED_UNTIL||'',old?.LAST_LOGIN||'',old?.CREATED_AT||t,t).run();
  if(p.actions&&typeof p.actions==='object'){
    const stmts=[];
    for(const [module,x] of Object.entries(p.actions)){
      if(!['raw','dye','production','stitching','qc','reports'].includes(module))continue;
      stmts.push(db.prepare(`INSERT INTO user_action_permissions(USER_ID,MODULE,CAN_VIEW,CAN_CREATE,CAN_EDIT,CAN_CANCEL,CAN_EXPORT,CAN_AUDIT)
        VALUES(?,?,?,?,?,?,?,?)
        ON CONFLICT(USER_ID,MODULE) DO UPDATE SET CAN_VIEW=excluded.CAN_VIEW,CAN_CREATE=excluded.CAN_CREATE,CAN_EDIT=excluded.CAN_EDIT,CAN_CANCEL=excluded.CAN_CANCEL,CAN_EXPORT=excluded.CAN_EXPORT,CAN_AUDIT=excluded.CAN_AUDIT`)
        .bind(id,module,truth(x.view)?1:0,truth(x.create)?1:0,truth(x.edit)?1:0,truth(x.cancel)?1:0,truth(x.export)?1:0,truth(x.audit)?1:0))
    }
    if(stmts.length)await db.batch(stmts)
  }
  const saved=await userRow(db,id),pu=publicUser(saved);pu.actions=await actionPerms(db,id);
  await audit(db,a,'SAVE_USER','USERS',id,old?JSON.stringify(publicUser(old)):'',JSON.stringify(pu));return{user:pu}
}

async function vendorName(db,id){return (await row(db,'SELECT VENDOR_NAME FROM vendors WHERE VENDOR_ID=?',id))?.VENDOR_NAME||id||''}
async function fabricName(db,id){return (await row(db,'SELECT FABRIC_NAME FROM fabrics WHERE FABRIC_ID=?',id))?.FABRIC_NAME||id||''}
async function colorName(db,id){return (await row(db,'SELECT COLOR_NAME FROM colors WHERE COLOR_ID=?',id))?.COLOR_NAME||id||''}
async function styleName(db,id){return (await row(db,'SELECT STYLE_NAME FROM styles WHERE STYLE_ID=?',id))?.STYLE_NAME||id||''}

async function rawBalance(db,roll){
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT SUM(INWARD_MTR) FROM raw_inward WHERE ROLL_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'),0)-COALESCE((SELECT SUM(ISSUE_MTR) FROM dye_jobs WHERE ROLL_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'),0)) AS bal`,roll,roll);return n(r?.bal)
}
async function dyeBalance(db,batch){
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT SUM(USABLE_MTR) FROM dye_receipts WHERE DYE_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'),0)-COALESCE((SELECT SUM(ALLOCATED_MTR) FROM production_batches WHERE DYE_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'),0)) AS bal`,batch,batch);return n(r?.bal)
}
async function cutSizeBalance(db,pb,size){
  const map={M:['M_CUT','M_ISSUED'],L:['L_CUT','L_ISSUED'],XL:['XL_CUT','XL_ISSUED'],'2XL':['2XL_CUT','2XL_ISSUED'],'3XL':['3XL_CUT','3XL_ISSUED'],OTHER:['OTHER_CUT','OTHER_ISSUED']},p=map[String(size||'').toUpperCase()];if(!p)return 0;
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT "${p[0]}" FROM production_batches WHERE PRODUCTION_BATCH_ID=?),0)-COALESCE((SELECT SUM("${p[1]}") FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'),0)) AS bal`,pb,pb);return n(r?.bal)
}
async function cutBalance(db,pb){
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT CASE WHEN TOTAL_CUT>0 THEN TOTAL_CUT ELSE M_CUT+L_CUT+XL_CUT+"2XL_CUT"+"3XL_CUT"+OTHER_CUT END FROM production_batches WHERE PRODUCTION_BATCH_ID=?),0)-COALESCE((SELECT SUM(TOTAL_ISSUED) FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'),0)) AS bal`,pb,pb);return n(r?.bal)
}
async function qcSizePending(db,challan,size){
  const col={M:'M_RECEIVED',L:'L_RECEIVED',XL:'XL_RECEIVED','2XL':'2XL_RECEIVED','3XL':'3XL_RECEIVED',OTHER:'OTHER_RECEIVED'}[String(size||'').toUpperCase()];if(!col)return 0;
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT "${col}" FROM stitching_jobs WHERE CHALLAN_ID=?),0)-COALESCE((SELECT SUM(QC_QTY) FROM qc_events WHERE CHALLAN_ID=? AND UPPER(SIZE)=?),0)) AS bal`,challan,challan,String(size).toUpperCase());return n(r?.bal)
}

async function sizeMasterRow(db,key){
  const k=String(key||'').trim();
  if(!k)return null;
  return row(db,'SELECT * FROM sizes WHERE SIZE_ID=? OR UPPER(SIZE_NAME)=UPPER(?) ORDER BY CASE WHEN SIZE_ID=? THEN 0 ELSE 1 END LIMIT 1',k,k,k)
}
async function activeSizeRows(db){return rows(db,'SELECT * FROM sizes WHERE ACTIVE=1 ORDER BY SORT_ORDER,SIZE_NAME')}
function legacySizeName(s){const x=String(s||'').toUpperCase();return LEGACY_SIZE_COL[x]||null}
function legacyCol(prefix,sizeName){
  const s=legacySizeName(sizeName);return s?s+'_'+prefix:null
}
async function cutLinesForPb(db,pb){
  const lines=await rows(db,`SELECT l.SIZE_ID,s.SIZE_NAME,s.SORT_ORDER,l.QTY
    FROM production_cut_lines l LEFT JOIN sizes s ON s.SIZE_ID=l.SIZE_ID
    WHERE l.PRODUCTION_BATCH_ID=? ORDER BY COALESCE(s.SORT_ORDER,9999),COALESCE(s.SIZE_NAME,l.SIZE_ID)`,pb);
  if(lines.length)return lines.map(x=>({...x,SIZE_NAME:x.SIZE_NAME||x.SIZE_ID,QTY:intQty(x.QTY,'Cut quantity')}));
  const p=await row(db,'SELECT * FROM production_batches WHERE PRODUCTION_BATCH_ID=?',pb);if(!p)return[];
  const sizes=await activeSizeRows(db),out=[];
  for(const s of sizes){const col=legacyCol('CUT',s.SIZE_NAME);if(col&&n(p[col])>0)out.push({SIZE_ID:s.SIZE_ID,SIZE_NAME:s.SIZE_NAME,SORT_ORDER:s.SORT_ORDER,QTY:Math.round(n(p[col]))})}
  const known=new Set(out.map(x=>String(x.SIZE_NAME).toUpperCase()));
  for(const nm of ['M','L','XL','2XL','3XL','OTHER'])if(!known.has(nm)){const col=nm+'_CUT';if(n(p[col])>0)out.push({SIZE_ID:nm,SIZE_NAME:nm,SORT_ORDER:9999,QTY:Math.round(n(p[col]))})}
  return out
}
async function issueLinesForChallan(db,challan){
  const lines=await rows(db,`SELECT l.SIZE_ID,s.SIZE_NAME,s.SORT_ORDER,l.QTY
    FROM stitching_issue_lines l LEFT JOIN sizes s ON s.SIZE_ID=l.SIZE_ID
    WHERE l.CHALLAN_ID=? ORDER BY COALESCE(s.SORT_ORDER,9999),COALESCE(s.SIZE_NAME,l.SIZE_ID)`,challan);
  if(lines.length)return lines.map(x=>({...x,SIZE_NAME:x.SIZE_NAME||x.SIZE_ID,QTY:Math.round(n(x.QTY))}));
  const st=await row(db,'SELECT * FROM stitching_jobs WHERE CHALLAN_ID=?',challan);if(!st)return[];
  const sizes=await activeSizeRows(db),out=[];
  for(const s of sizes){const col=legacyCol('ISSUED',s.SIZE_NAME);if(col&&n(st[col])>0)out.push({SIZE_ID:s.SIZE_ID,SIZE_NAME:s.SIZE_NAME,SORT_ORDER:s.SORT_ORDER,QTY:Math.round(n(st[col]))})}
  const known=new Set(out.map(x=>String(x.SIZE_NAME).toUpperCase()));
  for(const nm of ['M','L','XL','2XL','3XL','OTHER'])if(!known.has(nm)){const col=nm+'_ISSUED';if(n(st[col])>0)out.push({SIZE_ID:nm,SIZE_NAME:nm,SORT_ORDER:9999,QTY:Math.round(n(st[col]))})}
  return out
}
async function receivedLinesForChallan(db,challan){
  const lines=await rows(db,`SELECT l.SIZE_ID,COALESCE(s.SIZE_NAME,l.SIZE_ID) SIZE_NAME,COALESCE(s.SORT_ORDER,9999) SORT_ORDER,SUM(l.QTY) QTY
    FROM stitching_receipt_lines l
    JOIN stitching_receipts r ON r.RECEIPT_ID=l.RECEIPT_ID AND COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%'
    LEFT JOIN sizes s ON s.SIZE_ID=l.SIZE_ID
    WHERE l.CHALLAN_ID=? GROUP BY l.SIZE_ID,s.SIZE_NAME,s.SORT_ORDER
    ORDER BY COALESCE(s.SORT_ORDER,9999),COALESCE(s.SIZE_NAME,l.SIZE_ID)`,challan);
  if(lines.length)return lines.map(x=>({...x,QTY:Math.round(n(x.QTY))}));
  const st=await row(db,'SELECT * FROM stitching_jobs WHERE CHALLAN_ID=?',challan);if(!st)return[];
  const sizes=await activeSizeRows(db),out=[];
  for(const s of sizes){const col=legacyCol('RECEIVED',s.SIZE_NAME);if(col&&n(st[col])>0)out.push({SIZE_ID:s.SIZE_ID,SIZE_NAME:s.SIZE_NAME,SORT_ORDER:s.SORT_ORDER,QTY:Math.round(n(st[col]))})}
  const known=new Set(out.map(x=>String(x.SIZE_NAME).toUpperCase()));
  for(const nm of ['M','L','XL','2XL','3XL','OTHER'])if(!known.has(nm)){const col=nm+'_RECEIVED';if(n(st[col])>0)out.push({SIZE_ID:nm,SIZE_NAME:nm,SORT_ORDER:9999,QTY:Math.round(n(st[col]))})}
  return out
}
async function qcInitialQtyBySize(db,challan,sizeId,sizeName=''){
  const r=await row(db,`SELECT COALESCE(SUM(QC_QTY),0) q FROM qc_events
    WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'
      AND COALESCE(REWORK_CHALLAN_ID,'')=''
      AND (SIZE=? OR UPPER(SIZE)=UPPER(?))`,challan,String(sizeId),String(sizeName||sizeId));
  return Math.round(n(r?.q))
}
async function qcPendingLines(db,challan){
  const rec=await receivedLinesForChallan(db,challan),out=[];
  for(const x of rec){const q=await qcInitialQtyBySize(db,challan,x.SIZE_ID,x.SIZE_NAME),pending=Math.max(0,x.QTY-q);if(pending>0)out.push({...x,QC_QTY:q,PENDING_QTY:pending})}
  return out
}
async function cutBalanceLines(db,pb){
  const cuts=await cutLinesForPb(db,pb),challans=await rows(db,"SELECT CHALLAN_ID FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",pb),issued={};
  for(const ch of challans){for(const x of await issueLinesForChallan(db,ch.CHALLAN_ID))issued[x.SIZE_ID]=(issued[x.SIZE_ID]||0)+x.QTY}
  return cuts.map(x=>({...x,ISSUED_QTY:issued[x.SIZE_ID]||0,BALANCE_QTY:Math.max(0,x.QTY-(issued[x.SIZE_ID]||0))}))
}
async function stitchingPendingLines(db,challan){
  const issued=await issueLinesForChallan(db,challan),rec=Object.fromEntries((await receivedLinesForChallan(db,challan)).map(x=>[x.SIZE_ID,x.QTY]));
  return issued.map(x=>({...x,RECEIVED_QTY:rec[x.SIZE_ID]||0,PENDING_QTY:Math.max(0,x.QTY-(rec[x.SIZE_ID]||0))}))
}

async function dyeBatchSummary(db,batch){
  const r=await row(db,`WITH j AS (SELECT DYE_BATCH_ID,MAX(DYE_PLAN_ID) DYE_PLAN_ID,MAX(ISSUE_DATE) ISSUE_DATE,MAX(DYE_VENDOR_ID) DYE_VENDOR_ID,MAX(FABRIC_ID) FABRIC_ID,MAX(COLOR_ID) COLOR_ID,SUM(ISSUE_MTR) ISSUE_MTR,COUNT(*) ROLL_COUNT FROM dye_jobs WHERE DYE_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'),
  d AS (SELECT COALESCE(SUM(RECEIVED_MTR),0) RECEIVED_MTR,COALESCE(SUM(DEFECT_MTR),0) DEFECT_MTR,COALESCE(SUM(USABLE_MTR),0) USABLE_MTR,MAX(FINAL_RECEIPT) CLOSED FROM dye_receipts WHERE DYE_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%')
  SELECT j.*,d.RECEIVED_MTR,d.DEFECT_MTR,d.USABLE_MTR,d.CLOSED FROM j CROSS JOIN d`,batch,batch);
  if(!r?.DYE_BATCH_ID)return null;const variance=truth(r.CLOSED)?n(r.RECEIVED_MTR)-n(r.ISSUE_MTR):0;return{...r,VARIANCE_MTR:variance,PENDING_MTR:truth(r.CLOSED)?0:Math.max(0,n(r.ISSUE_MTR)-n(r.RECEIVED_MTR)),CLOSED:truth(r.CLOSED),STATUS:truth(r.CLOSED)?(variance>0.0001?'RECEIVED EXCESS':variance<-0.0001?'RECEIVED SHORT':'RECEIVED EXACT'):(n(r.RECEIVED_MTR)>0?'PARTIAL RECEIVED':'AT DYE VENDOR')}
}
async function dyePlanSummary(db,plan){
  const bs=await rows(db,"SELECT DISTINCT DYE_BATCH_ID FROM dye_jobs WHERE DYE_PLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",plan),sums=[];for(const b of bs){const s=await dyeBatchSummary(db,b.DYE_BATCH_ID);if(s)sums.push(s)}
  const issued=sums.reduce((s,x)=>s+n(x.ISSUE_MTR),0),received=sums.reduce((s,x)=>s+n(x.RECEIVED_MTR),0),usable=sums.reduce((s,x)=>s+n(x.USABLE_MTR),0),defect=sums.reduce((s,x)=>s+n(x.DEFECT_MTR),0),closed=sums.filter(x=>x.CLOSED).length;
  return{DYE_PLAN_ID:plan,ISSUE_MTR:issued,RECEIVED_MTR:received,USABLE_MTR:usable,DEFECT_MTR:defect,VARIANCE_MTR:received-issued,BATCH_COUNT:sums.length,CLOSED_BATCHES:closed,ALL_CLOSED:!!sums.length&&closed===sums.length}
}

async function viewRaw(db){return rows(db,`
  SELECT r.*,COALESCE(v.VENDOR_NAME,r.SUPPLIER_ID) SUPPLIER,COALESCE(f.FABRIC_NAME,r.FABRIC_ID) FABRIC,
         COALESCE(d.ISSUED_MTR,0) ISSUED_MTR,
         MAX(0,r.INWARD_MTR-COALESCE(d.ISSUED_MTR,0)) BALANCE_MTR,
         CASE
           WHEN COALESCE(r.STATUS,'') LIKE 'CANCELLED%' THEN 'CANCELLED'
           WHEN COALESCE(d.ISSUED_MTR,0)<=0.0001 THEN 'AVAILABLE'
           WHEN r.INWARD_MTR-COALESCE(d.ISSUED_MTR,0)<=0.0001 THEN 'FULLY ISSUED'
           ELSE 'PARTIAL'
         END STATUS
  FROM raw_inward r
  LEFT JOIN vendors v ON v.VENDOR_ID=r.SUPPLIER_ID
  LEFT JOIN fabrics f ON f.FABRIC_ID=r.FABRIC_ID
  LEFT JOIN (SELECT ROLL_ID,SUM(ISSUE_MTR) ISSUED_MTR FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY ROLL_ID)d ON d.ROLL_ID=r.ROLL_ID
  WHERE COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%'
  ORDER BY r.CREATED_AT DESC,r.ROLL_ID DESC`)}
async function viewDye(db){
  return rows(db,`
    WITH j AS (
      SELECT DYE_PLAN_ID,DYE_BATCH_ID,MAX(ISSUE_DATE) ISSUE_DATE,MAX(DYE_VENDOR_ID) DYE_VENDOR_ID,
             MAX(FABRIC_ID) FABRIC_ID,MAX(COLOR_ID) COLOR_ID,SUM(ISSUE_MTR) ISSUE_MTR,COUNT(*) ROLL_COUNT
      FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY DYE_BATCH_ID
    ),
    r AS (
      SELECT DYE_BATCH_ID,COALESCE(SUM(RECEIVED_MTR),0) RECEIVED_MTR,
             COALESCE(SUM(DEFECT_MTR),0) DEFECT_MTR,COALESCE(SUM(USABLE_MTR),0) USABLE_MTR,
             MAX(FINAL_RECEIPT) CLOSED
      FROM dye_receipts WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY DYE_BATCH_ID
    ),
    b AS (
      SELECT j.*,COALESCE(r.RECEIVED_MTR,0) RECEIVED_MTR,COALESCE(r.DEFECT_MTR,0) DEFECT_MTR,
             COALESCE(r.USABLE_MTR,0) USABLE_MTR,COALESCE(r.CLOSED,0) CLOSED,
             CASE WHEN COALESCE(r.CLOSED,0)=1 THEN COALESCE(r.RECEIVED_MTR,0)-j.ISSUE_MTR ELSE 0 END VARIANCE_MTR,
             CASE WHEN COALESCE(r.CLOSED,0)=1 THEN 0 ELSE MAX(0,j.ISSUE_MTR-COALESCE(r.RECEIVED_MTR,0)) END PENDING_MTR
      FROM j LEFT JOIN r ON r.DYE_BATCH_ID=j.DYE_BATCH_ID
    ),
    x AS (
      SELECT b.*,
             SUM(ISSUE_MTR) OVER(PARTITION BY DYE_PLAN_ID) PLAN_ISSUE_MTR,
             SUM(RECEIVED_MTR) OVER(PARTITION BY DYE_PLAN_ID) PLAN_RECEIVED_MTR
      FROM b
    )
    SELECT x.*,
           (PLAN_RECEIVED_MTR-PLAN_ISSUE_MTR) PLAN_VARIANCE_MTR,
           e.EXPECTED_DATE,
           CASE WHEN e.EXPECTED_DATE<>'' AND CLOSED=0 AND date(e.EXPECTED_DATE)<date('now') THEN CAST(julianday('now')-julianday(e.EXPECTED_DATE) AS INTEGER) ELSE 0 END OVERDUE_DAYS,
           COALESCE(v.VENDOR_NAME,x.DYE_VENDOR_ID) DYE_VENDOR,
           COALESCE(f.FABRIC_NAME,x.FABRIC_ID) FABRIC,
           COALESCE(c.COLOR_NAME,x.COLOR_ID) COLOR,
           CASE
             WHEN CLOSED=1 AND VARIANCE_MTR>0.0001 THEN 'RECEIVED EXCESS'
             WHEN CLOSED=1 AND VARIANCE_MTR<-0.0001 THEN 'RECEIVED SHORT'
             WHEN CLOSED=1 THEN 'RECEIVED EXACT'
             WHEN RECEIVED_MTR>0 THEN 'PARTIAL RECEIVED'
             ELSE 'AT DYE VENDOR'
           END STATUS
    FROM x
    LEFT JOIN vendors v ON v.VENDOR_ID=x.DYE_VENDOR_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=x.FABRIC_ID
    LEFT JOIN colors c ON c.COLOR_ID=x.COLOR_ID
    LEFT JOIN record_expectations e ON e.MODULE='DYE' AND e.RECORD_ID=x.DYE_BATCH_ID
    ORDER BY ISSUE_DATE DESC,DYE_BATCH_ID DESC
  `)
}
async function viewProd(db){
  return rows(db,`
    WITH cl AS (SELECT PRODUCTION_BATCH_ID,SUM(QTY) CUT_QTY FROM production_cut_lines GROUP BY PRODUCTION_BATCH_ID),
    il AS (SELECT CHALLAN_ID,SUM(QTY) QTY FROM stitching_issue_lines GROUP BY CHALLAN_ID),
    ib AS (
      SELECT s.PRODUCTION_BATCH_ID,SUM(CASE WHEN il.CHALLAN_ID IS NOT NULL THEN il.QTY ELSE s.TOTAL_ISSUED END) ISSUED_QTY
      FROM stitching_jobs s LEFT JOIN il ON il.CHALLAN_ID=s.CHALLAN_ID
      WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY s.PRODUCTION_BATCH_ID
    )
    SELECT p.*,COALESCE(s.STYLE_NAME,p.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,p.COLOR_ID) COLOR,
      COALESCE(ca.CONSUMED_MTR,p.CONSUMED_MTR,0) ACTUAL_CONSUMED_MTR,
      COALESCE(ca.WASTE_MTR,p.CUTTING_WASTE_MTR,0) ACTUAL_WASTE_MTR,
      COALESCE(ca.DEFECT_MTR,p.DEFECT_MTR,0) ACTUAL_DEFECT_MTR,
      COALESCE(ca.UNUSED_RETURN_MTR,0) UNUSED_RETURN_MTR,
      CASE WHEN cl.PRODUCTION_BATCH_ID IS NOT NULL THEN cl.CUT_QTY ELSE p.TOTAL_CUT END ACTUAL_CUT_QTY,
      MAX(0,(CASE WHEN cl.PRODUCTION_BATCH_ID IS NOT NULL THEN cl.CUT_QTY ELSE p.TOTAL_CUT END)-COALESCE(ib.ISSUED_QTY,0)) CUT_BALANCE
    FROM production_batches p
    LEFT JOIN styles s ON s.STYLE_ID=p.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=p.COLOR_ID
    LEFT JOIN production_cut_actuals ca ON ca.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID AND COALESCE(ca.STATUS,'') NOT LIKE 'CANCELLED%'
    LEFT JOIN cl ON cl.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID
    LEFT JOIN ib ON ib.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID
    WHERE COALESCE(p.STATUS,'') NOT LIKE 'CANCELLED%'
    ORDER BY p.CREATED_AT DESC`)
}
async function viewStitch(db){
  return rows(db,`
    WITH il AS (SELECT CHALLAN_ID,SUM(QTY) ISSUE_QTY FROM stitching_issue_lines GROUP BY CHALLAN_ID),
    rl AS (
      SELECT l.CHALLAN_ID,SUM(l.QTY) RECEIVED_QTY,COUNT(DISTINCT l.RECEIPT_ID) RECEIPT_COUNT
      FROM stitching_receipt_lines l
      JOIN stitching_receipts r ON r.RECEIPT_ID=l.RECEIPT_ID AND COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%'
      GROUP BY l.CHALLAN_ID
    )
    SELECT s.*,COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) STITCHING_VENDOR,
      COALESCE(st.STYLE_NAME,s.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,s.COLOR_ID) COLOR,
      e.EXPECTED_DATE,
      CASE WHEN e.EXPECTED_DATE<>'' AND MAX(0,(CASE WHEN il.CHALLAN_ID IS NOT NULL THEN il.ISSUE_QTY ELSE s.TOTAL_ISSUED END)-(CASE WHEN rl.CHALLAN_ID IS NOT NULL THEN rl.RECEIVED_QTY ELSE s.TOTAL_RECEIVED END))>0 AND date(e.EXPECTED_DATE)<date('now') THEN CAST(julianday('now')-julianday(e.EXPECTED_DATE) AS INTEGER) ELSE 0 END OVERDUE_DAYS,
      CASE WHEN il.CHALLAN_ID IS NOT NULL THEN il.ISSUE_QTY ELSE s.TOTAL_ISSUED END ACTUAL_ISSUED,
      CASE WHEN rl.CHALLAN_ID IS NOT NULL THEN rl.RECEIVED_QTY ELSE s.TOTAL_RECEIVED END ACTUAL_RECEIVED,
      MAX(0,(CASE WHEN il.CHALLAN_ID IS NOT NULL THEN il.ISSUE_QTY ELSE s.TOTAL_ISSUED END)-
            (CASE WHEN rl.CHALLAN_ID IS NOT NULL THEN rl.RECEIVED_QTY ELSE s.TOTAL_RECEIVED END)) PENDING_QTY,
      COALESCE(rl.RECEIPT_COUNT,0) RECEIPT_COUNT
    FROM stitching_jobs s
    LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID
    LEFT JOIN styles st ON st.STYLE_ID=s.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=s.COLOR_ID
    LEFT JOIN il ON il.CHALLAN_ID=s.CHALLAN_ID
    LEFT JOIN rl ON rl.CHALLAN_ID=s.CHALLAN_ID
    LEFT JOIN record_expectations e ON e.MODULE='STITCHING' AND e.RECORD_ID=s.CHALLAN_ID
    WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%'
    ORDER BY s.CREATED_AT DESC`)
}
async function viewQc(db){
  return rows(db,`
    SELECT q.*,COALESCE(sz.SIZE_NAME,q.SIZE) SIZE_NAME,
      COALESCE(v.VENDOR_NAME,q.VENDOR_ID) VENDOR,
      COALESCE(st.STYLE_NAME,q.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,q.COLOR_ID) COLOR
    FROM qc_events q
    LEFT JOIN sizes sz ON sz.SIZE_ID=q.SIZE
    LEFT JOIN vendors v ON v.VENDOR_ID=q.VENDOR_ID
    LEFT JOIN styles st ON st.STYLE_ID=q.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=q.COLOR_ID
    WHERE COALESCE(q.STATUS,'') NOT LIKE 'CANCELLED%'
    ORDER BY q.CREATED_AT DESC`)
}
async function viewHandover(db){
  return rows(db,`
    WITH wr AS (
      SELECT HANDOVER_ID,SUM(RECEIVED_QTY) EXTRA_RECEIVED,COUNT(*) RECEIPT_COUNT
      FROM warehouse_receipts WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY HANDOVER_ID
    )
    SELECT h.*,COALESCE(st.STYLE_NAME,h.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,h.COLOR_ID) COLOR,
      COALESCE(sz.SIZE_NAME,h.SIZE) SIZE_NAME,
      h.WAREHOUSE_RECEIVED_QTY+COALESCE(wr.EXTRA_RECEIVED,0) TOTAL_WAREHOUSE_RECEIVED,
      MAX(0,h.ACCEPTED_QTY-h.WAREHOUSE_RECEIVED_QTY-COALESCE(wr.EXTRA_RECEIVED,0)) PENDING_QTY,
      COALESCE(wr.RECEIPT_COUNT,0) ADDITIONAL_RECEIPTS
    FROM warehouse_handover h
    LEFT JOIN styles st ON st.STYLE_ID=h.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=h.COLOR_ID
    LEFT JOIN sizes sz ON sz.SIZE_ID=h.SIZE
    LEFT JOIN wr ON wr.HANDOVER_ID=h.HANDOVER_ID
    WHERE COALESCE(h.STATUS,'') NOT LIKE 'CANCELLED%'
    ORDER BY h.CREATED_AT DESC`)
}

async function warehouseReady(db){
  return rows(db,`
    WITH q AS (
      SELECT PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE,SUM(FINAL_ACCEPTED_QTY) ACCEPTED_QTY
      FROM qc_events WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'
      GROUP BY PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE
    ),
    h AS (
      SELECT PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE,SUM(ACCEPTED_QTY) HANDED_QTY
      FROM warehouse_handover WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'
      GROUP BY PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE
    )
    SELECT q.*,COALESCE(h.HANDED_QTY,0) HANDED_QTY,
      MAX(0,q.ACCEPTED_QTY-COALESCE(h.HANDED_QTY,0)) PENDING_QTY
    FROM q LEFT JOIN h USING(PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE)
    WHERE q.ACCEPTED_QTY-COALESCE(h.HANDED_QTY,0)>0`)
}
async function kpisD1(db){
  const raw=await row(db,`SELECT MAX(0,
    (SELECT COALESCE(SUM(INWARD_MTR),0) FROM raw_inward WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%')-
    (SELECT COALESCE(SUM(ISSUE_MTR),0) FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%')) v`);
  const atDye=await row(db,`SELECT MAX(0,
    (SELECT COALESCE(SUM(ISSUE_MTR),0) FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%')-
    (SELECT COALESCE(SUM(RECEIVED_MTR),0) FROM dye_receipts WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%')) v`);
  const dyed=await row(db,`SELECT MAX(0,
    (SELECT COALESCE(SUM(USABLE_MTR),0) FROM dye_receipts WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%')-
    (SELECT COALESCE(SUM(ALLOCATED_MTR),0) FROM production_batches WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%')) v`);
  const cut=await row(db,`WITH c AS (
      SELECT p.PRODUCTION_BATCH_ID,CASE WHEN EXISTS(SELECT 1 FROM production_cut_lines l WHERE l.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID)
      THEN (SELECT COALESCE(SUM(QTY),0) FROM production_cut_lines l WHERE l.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID) ELSE p.TOTAL_CUT END q
      FROM production_batches p WHERE COALESCE(p.STATUS,'') NOT LIKE 'CANCELLED%'),
    i AS (
      SELECT s.PRODUCTION_BATCH_ID,SUM(CASE WHEN EXISTS(SELECT 1 FROM stitching_issue_lines l WHERE l.CHALLAN_ID=s.CHALLAN_ID)
      THEN (SELECT COALESCE(SUM(QTY),0) FROM stitching_issue_lines l WHERE l.CHALLAN_ID=s.CHALLAN_ID) ELSE s.TOTAL_ISSUED END) q
      FROM stitching_jobs s WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY s.PRODUCTION_BATCH_ID)
    SELECT MAX(0,COALESCE((SELECT SUM(q) FROM c),0)-COALESCE((SELECT SUM(q) FROM i),0)) v`);
  const stitch=await row(db,`WITH i AS (
      SELECT s.CHALLAN_ID,CASE WHEN EXISTS(SELECT 1 FROM stitching_issue_lines l WHERE l.CHALLAN_ID=s.CHALLAN_ID)
      THEN (SELECT COALESCE(SUM(QTY),0) FROM stitching_issue_lines l WHERE l.CHALLAN_ID=s.CHALLAN_ID) ELSE s.TOTAL_ISSUED END q
      FROM stitching_jobs s WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%'),
    r AS (
      SELECT s.CHALLAN_ID,CASE WHEN EXISTS(SELECT 1 FROM stitching_receipt_lines l JOIN stitching_receipts h ON h.RECEIPT_ID=l.RECEIPT_ID WHERE l.CHALLAN_ID=s.CHALLAN_ID AND COALESCE(h.STATUS,'') NOT LIKE 'CANCELLED%')
      THEN (SELECT COALESCE(SUM(l.QTY),0) FROM stitching_receipt_lines l JOIN stitching_receipts h ON h.RECEIPT_ID=l.RECEIPT_ID WHERE l.CHALLAN_ID=s.CHALLAN_ID AND COALESCE(h.STATUS,'') NOT LIKE 'CANCELLED%') ELSE s.TOTAL_RECEIVED END q
      FROM stitching_jobs s WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%')
    SELECT MAX(0,COALESCE((SELECT SUM(q) FROM i),0)-COALESCE((SELECT SUM(q) FROM r),0)) v`);
  const wh=await row(db,`WITH q AS (
      SELECT COALESCE(SUM(FINAL_ACCEPTED_QTY),0) q FROM qc_events WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'),
    h AS (
      SELECT COALESCE(SUM(ACCEPTED_QTY),0) q FROM warehouse_handover WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%')
    SELECT MAX(0,(SELECT q FROM q)-(SELECT q FROM h)) v`);
  return{rawAvailable:n(raw?.v),atDye:n(atDye?.v),dyedAvailable:n(dyed?.v),cutPending:n(cut?.v),atStitching:n(stitch?.v),readyWarehouse:n(wh?.v)}
}


async function operationsAnalytics(db){
  const dyeVendors=await rows(db,`
    WITH batches AS (
      SELECT DYE_BATCH_ID,MAX(DYE_VENDOR_ID) DYE_VENDOR_ID,SUM(ISSUE_MTR) ISSUE_MTR,MIN(ISSUE_DATE) ISSUE_DATE
      FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY DYE_BATCH_ID
    ),
    rec AS (
      SELECT DYE_BATCH_ID,SUM(RECEIVED_MTR) RECEIVED_MTR,SUM(DEFECT_MTR) DEFECT_MTR
      FROM dye_receipts WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY DYE_BATCH_ID
    ),
    j AS (
      SELECT b.DYE_VENDOR_ID,COUNT(*) BATCHES,SUM(b.ISSUE_MTR) ISSUED_MTR,MIN(b.ISSUE_DATE) OLDEST_ISSUE,
             SUM(COALESCE(r.RECEIVED_MTR,0)) RECEIVED_MTR,SUM(COALESCE(r.DEFECT_MTR,0)) DEFECT_MTR
      FROM batches b LEFT JOIN rec r ON r.DYE_BATCH_ID=b.DYE_BATCH_ID GROUP BY b.DYE_VENDOR_ID
    )
    SELECT COALESCE(v.VENDOR_NAME,j.DYE_VENDOR_ID) VENDOR,j.BATCHES,j.ISSUED_MTR,j.RECEIVED_MTR,j.DEFECT_MTR,
      MAX(0,j.ISSUED_MTR-j.RECEIVED_MTR) PENDING_MTR,
      CAST(julianday('now')-julianday(j.OLDEST_ISSUE) AS INTEGER) OLDEST_AGE_DAYS
    FROM j LEFT JOIN vendors v ON v.VENDOR_ID=j.DYE_VENDOR_ID
    ORDER BY PENDING_MTR DESC`);
  const stitchVendors=await rows(db,`
    SELECT COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) VENDOR,COUNT(*) CHALLANS,SUM(s.TOTAL_ISSUED) ISSUED_QTY,
      SUM(s.TOTAL_RECEIVED) RECEIVED_QTY,SUM(MAX(0,s.PENDING_QTY)) PENDING_QTY,
      MAX(CASE WHEN s.PENDING_QTY>0 THEN CAST(julianday('now')-julianday(s.ISSUE_DATE) AS INTEGER) ELSE 0 END) OLDEST_AGE_DAYS
    FROM stitching_jobs s LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID
    WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY s.STITCHING_VENDOR_ID ORDER BY PENDING_QTY DESC`);
  const quality=await row(db,`
    SELECT COALESCE(SUM(QC_QTY),0) QC_QTY,COALESCE(SUM(PASS_QTY),0) PASS_QTY,COALESCE(SUM(REWORK_QTY),0) REWORK_QTY,
      COALESCE(SUM(REJECT_QTY),0) REJECT_QTY,COALESCE(SUM(FINAL_ACCEPTED_QTY),0) FINAL_ACCEPTED_QTY
    FROM qc_events WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'`);
  const dyeQuality=await row(db,`SELECT COALESCE(SUM(RECEIVED_MTR),0) RECEIVED_MTR,COALESCE(SUM(DEFECT_MTR),0) DEFECT_MTR
    FROM dye_receipts WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'`);
  const exceptions=[];
  for(const x of await rows(db,`
    SELECT 'DYE' TYPE,j.DYE_BATCH_ID RECORD_ID,COALESCE(v.VENDOR_NAME,j.DYE_VENDOR_ID) OWNER,
      CAST(julianday('now')-julianday(MAX(j.ISSUE_DATE)) AS INTEGER) AGE_DAYS,e.EXPECTED_DATE,
      CASE WHEN e.EXPECTED_DATE<>'' AND date(e.EXPECTED_DATE)<date('now') THEN CAST(julianday('now')-julianday(e.EXPECTED_DATE) AS INTEGER) ELSE 0 END OVERDUE_DAYS,
      MAX(0,SUM(j.ISSUE_MTR)-COALESCE((SELECT SUM(r.RECEIVED_MTR) FROM dye_receipts r WHERE r.DYE_BATCH_ID=j.DYE_BATCH_ID AND COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%'),0)) PENDING,
      CASE WHEN e.EXPECTED_DATE<>'' AND date(e.EXPECTED_DATE)<date('now') THEN 'Dye return overdue' ELSE 'Dye batch pending' END MESSAGE
    FROM dye_jobs j LEFT JOIN vendors v ON v.VENDOR_ID=j.DYE_VENDOR_ID LEFT JOIN record_expectations e ON e.MODULE='DYE' AND e.RECORD_ID=j.DYE_BATCH_ID
    WHERE COALESCE(j.STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY j.DYE_BATCH_ID,e.EXPECTED_DATE
    HAVING PENDING>0 AND (OVERDUE_DAYS>0 OR (COALESCE(e.EXPECTED_DATE,'')='' AND AGE_DAYS>=3)) ORDER BY OVERDUE_DAYS DESC,AGE_DAYS DESC LIMIT 50`))exceptions.push(x);
  for(const x of await rows(db,`
    SELECT 'STITCHING' TYPE,s.CHALLAN_ID RECORD_ID,COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) OWNER,
      CAST(julianday('now')-julianday(s.ISSUE_DATE) AS INTEGER) AGE_DAYS,e.EXPECTED_DATE,
      CASE WHEN e.EXPECTED_DATE<>'' AND date(e.EXPECTED_DATE)<date('now') THEN CAST(julianday('now')-julianday(e.EXPECTED_DATE) AS INTEGER) ELSE 0 END OVERDUE_DAYS,
      s.PENDING_QTY PENDING,CASE WHEN e.EXPECTED_DATE<>'' AND date(e.EXPECTED_DATE)<date('now') THEN 'Stitching return overdue' ELSE 'Stitching return pending' END MESSAGE
    FROM stitching_jobs s LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID LEFT JOIN record_expectations e ON e.MODULE='STITCHING' AND e.RECORD_ID=s.CHALLAN_ID
    WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%' AND s.PENDING_QTY>0 AND (CASE WHEN e.EXPECTED_DATE<>'' THEN date(e.EXPECTED_DATE)<date('now') ELSE CAST(julianday('now')-julianday(s.ISSUE_DATE) AS INTEGER)>=3 END)
    ORDER BY OVERDUE_DAYS DESC,AGE_DAYS DESC LIMIT 50`))exceptions.push(x);
  for(const x of await rows(db,`
    SELECT 'REWORK' TYPE,r.REWORK_ID RECORD_ID,COALESCE(v.VENDOR_NAME,r.VENDOR_ID) OWNER,CAST(julianday('now')-julianday(r.ISSUE_DATE) AS INTEGER) AGE_DAYS,e.EXPECTED_DATE,
      CASE WHEN e.EXPECTED_DATE<>'' AND date(e.EXPECTED_DATE)<date('now') THEN CAST(julianday('now')-julianday(e.EXPECTED_DATE) AS INTEGER) ELSE 0 END OVERDUE_DAYS,
      MAX(0,r.ISSUE_QTY-r.RETURNED_QTY) PENDING,CASE WHEN e.EXPECTED_DATE<>'' AND date(e.EXPECTED_DATE)<date('now') THEN 'Rework return overdue' ELSE 'Rework pending' END MESSAGE
    FROM rework_jobs r LEFT JOIN vendors v ON v.VENDOR_ID=r.VENDOR_ID LEFT JOIN record_expectations e ON e.MODULE='REWORK' AND e.RECORD_ID=r.REWORK_ID
    WHERE COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%' AND r.ISSUE_QTY>r.RETURNED_QTY AND (CASE WHEN e.EXPECTED_DATE<>'' THEN date(e.EXPECTED_DATE)<date('now') ELSE CAST(julianday('now')-julianday(r.ISSUE_DATE) AS INTEGER)>=3 END)
    ORDER BY OVERDUE_DAYS DESC,AGE_DAYS DESC LIMIT 50`))exceptions.push(x);
  return{
    dyeVendors,stitchVendors,quality,dyeQuality,
    exceptionCount:exceptions.length,
    exceptions:exceptions.sort((a,b)=>Number(b.AGE_DAYS||0)-Number(a.AGE_DAYS||0)).slice(0,100),
    rates:{
      dyeDefectPct:n(dyeQuality?.RECEIVED_MTR)>0?n(dyeQuality.DEFECT_MTR)/n(dyeQuality.RECEIVED_MTR)*100:0,
      qcRejectPct:n(quality?.QC_QTY)>0?n(quality.REJECT_QTY)/n(quality.QC_QTY)*100:0,
      qcReworkPct:n(quality?.QC_QTY)>0?n(quality.REWORK_QTY)/n(quality.QC_QTY)*100:0,
      qcPassPct:n(quality?.QC_QTY)>0?n(quality.FINAL_ACCEPTED_QTY)/n(quality.QC_QTY)*100:0
    }
  }
}
async function masterData(db){
  const [vendors,fabrics,colors,styles,sizes,defects]=await Promise.all([
    rows(db,`SELECT v.*,
      ((SELECT COUNT(*) FROM raw_inward r WHERE r.SUPPLIER_ID=v.VENDOR_ID)+(SELECT COUNT(*) FROM dye_jobs d WHERE d.DYE_VENDOR_ID=v.VENDOR_ID)+(SELECT COUNT(*) FROM stitching_jobs s WHERE s.STITCHING_VENDOR_ID=v.VENDOR_ID)+(SELECT COUNT(*) FROM qc_events q WHERE q.VENDOR_ID=v.VENDOR_ID)+(SELECT COUNT(*) FROM rework_jobs rw WHERE rw.VENDOR_ID=v.VENDOR_ID)) DEPENDENCY_COUNT
      FROM vendors v`),
    rows(db,`SELECT f.*,
      ((SELECT COUNT(*) FROM raw_inward r WHERE r.FABRIC_ID=f.FABRIC_ID)+(SELECT COUNT(*) FROM dye_jobs d WHERE d.FABRIC_ID=f.FABRIC_ID)+(SELECT COUNT(*) FROM production_batches p WHERE p.FABRIC_ID=f.FABRIC_ID)+(SELECT COUNT(*) FROM styles s WHERE s.DEFAULT_FABRIC_ID=f.FABRIC_ID)) DEPENDENCY_COUNT
      FROM fabrics f`),
    rows(db,`SELECT c.*,
      ((SELECT COUNT(*) FROM dye_jobs d WHERE d.COLOR_ID=c.COLOR_ID)+(SELECT COUNT(*) FROM production_batches p WHERE p.COLOR_ID=c.COLOR_ID)+(SELECT COUNT(*) FROM stitching_jobs s WHERE s.COLOR_ID=c.COLOR_ID)+(SELECT COUNT(*) FROM qc_events q WHERE q.COLOR_ID=c.COLOR_ID)+(SELECT COUNT(*) FROM warehouse_handover h WHERE h.COLOR_ID=c.COLOR_ID)) DEPENDENCY_COUNT
      FROM colors c`),
    rows(db,`SELECT s.*,
      ((SELECT COUNT(*) FROM production_batches p WHERE p.STYLE_ID=s.STYLE_ID)+(SELECT COUNT(*) FROM stitching_jobs j WHERE j.STYLE_ID=s.STYLE_ID)+(SELECT COUNT(*) FROM qc_events q WHERE q.STYLE_ID=s.STYLE_ID)+(SELECT COUNT(*) FROM warehouse_handover h WHERE h.STYLE_ID=s.STYLE_ID)) DEPENDENCY_COUNT
      FROM styles s`),
    rows(db,`SELECT s.*,
      ((SELECT COUNT(*) FROM production_cut_lines p WHERE p.SIZE_ID=s.SIZE_ID)+(SELECT COUNT(*) FROM stitching_issue_lines i WHERE i.SIZE_ID=s.SIZE_ID)+(SELECT COUNT(*) FROM stitching_receipt_lines r WHERE r.SIZE_ID=s.SIZE_ID)+(SELECT COUNT(*) FROM qc_events q WHERE q.SIZE=s.SIZE_ID)+(SELECT COUNT(*) FROM rework_jobs rw WHERE rw.SIZE_ID=s.SIZE_ID)+(SELECT COUNT(*) FROM warehouse_handover h WHERE h.SIZE=s.SIZE_ID)) DEPENDENCY_COUNT
      FROM sizes s ORDER BY SORT_ORDER,SIZE_NAME`),
    rows(db,`SELECT d.*,(SELECT COUNT(*) FROM qc_events q WHERE q.DEFECT_REASON=d.DEFECT_NAME) DEPENDENCY_COUNT FROM defect_reasons d`)
  ]);
  return{vendors,fabrics,colors,styles,sizes,defects}
}
async function lookupData(db){
  const m=await masterData(db),
        vendors=m.vendors.filter(x=>truth(x.ACTIVE)),
        fabrics=m.fabrics.filter(x=>truth(x.ACTIVE)),
        colors=m.colors.filter(x=>truth(x.ACTIVE)),
        styles=m.styles.filter(x=>truth(x.ACTIVE)),
        sizes=m.sizes.filter(x=>truth(x.ACTIVE)),
        defects=m.defects.filter(x=>truth(x.ACTIVE));

  const rawRolls=await rows(db,`
    SELECT r.*,COALESCE(f.FABRIC_NAME,r.FABRIC_ID) FABRIC_NAME,
           COALESCE(v.VENDOR_NAME,r.SUPPLIER_ID) SUPPLIER_NAME,
           MAX(0,r.INWARD_MTR-COALESCE(d.issued,0)) BALANCE_MTR
    FROM raw_inward r
    LEFT JOIN (SELECT ROLL_ID,SUM(ISSUE_MTR) issued FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY ROLL_ID)d ON d.ROLL_ID=r.ROLL_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=r.FABRIC_ID
    LEFT JOIN vendors v ON v.VENDOR_ID=r.SUPPLIER_ID
    WHERE COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%'
      AND r.INWARD_MTR-COALESCE(d.issued,0)>0.0001
    ORDER BY r.INWARD_DATE,r.CREATED_AT,r.ROLL_ID`);

  const group={};
  for(const r of rawRolls){
    const k=String(r.FABRIC_ID),x=group[k]||(group[k]={FABRIC_ID:k,FABRIC_NAME:r.FABRIC_NAME,AVAILABLE_MTR:0,ROLL_COUNT:0});
    x.AVAILABLE_MTR+=n(r.BALANCE_MTR);x.ROLL_COUNT++;
  }

  const allDyeBatches=await rows(db,`
    WITH j AS (
      SELECT DYE_PLAN_ID,DYE_BATCH_ID,MAX(ISSUE_DATE) ISSUE_DATE,MAX(DYE_VENDOR_ID) DYE_VENDOR_ID,
             MAX(FABRIC_ID) FABRIC_ID,MAX(COLOR_ID) COLOR_ID,SUM(ISSUE_MTR) ISSUE_MTR,COUNT(*) ROLL_COUNT
      FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY DYE_BATCH_ID
    ),
    r AS (
      SELECT DYE_BATCH_ID,SUM(RECEIVED_MTR) RECEIVED_MTR,SUM(DEFECT_MTR) DEFECT_MTR,
             SUM(USABLE_MTR) USABLE_MTR,MAX(FINAL_RECEIPT) CLOSED
      FROM dye_receipts WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY DYE_BATCH_ID
    ),
    a AS (SELECT DYE_BATCH_ID,SUM(ALLOCATED_MTR) ALLOCATED_MTR FROM production_batches WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY DYE_BATCH_ID)
    SELECT j.*,COALESCE(r.RECEIVED_MTR,0) RECEIVED_MTR,COALESCE(r.DEFECT_MTR,0) DEFECT_MTR,
           COALESCE(r.USABLE_MTR,0) USABLE_MTR,COALESCE(r.CLOSED,0) CLOSED,
           MAX(0,COALESCE(r.USABLE_MTR,0)-COALESCE(a.ALLOCATED_MTR,0)) BALANCE_MTR,
           CASE WHEN COALESCE(r.CLOSED,0)=1 THEN 0 ELSE MAX(0,j.ISSUE_MTR-COALESCE(r.RECEIVED_MTR,0)) END PENDING_MTR,
           CASE WHEN COALESCE(r.CLOSED,0)=1 THEN COALESCE(r.RECEIVED_MTR,0)-j.ISSUE_MTR ELSE 0 END VARIANCE_MTR,
           COALESCE(f.FABRIC_NAME,j.FABRIC_ID) FABRIC_NAME,
           COALESCE(c.COLOR_NAME,j.COLOR_ID) COLOR_NAME,
           COALESCE(v.VENDOR_NAME,j.DYE_VENDOR_ID) DYE_VENDOR_NAME
    FROM j
    LEFT JOIN r ON r.DYE_BATCH_ID=j.DYE_BATCH_ID
    LEFT JOIN a ON a.DYE_BATCH_ID=j.DYE_BATCH_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=j.FABRIC_ID
    LEFT JOIN colors c ON c.COLOR_ID=j.COLOR_ID
    LEFT JOIN vendors v ON v.VENDOR_ID=j.DYE_VENDOR_ID`);

  const productionBatches=await rows(db,`
    WITH cut_new AS (
      SELECT PRODUCTION_BATCH_ID,SUM(QTY) QTY FROM production_cut_lines GROUP BY PRODUCTION_BATCH_ID
    ),
    issue_new AS (
      SELECT l.CHALLAN_ID,SUM(l.QTY) QTY FROM stitching_issue_lines l GROUP BY l.CHALLAN_ID
    ),
    issue_by_pb AS (
      SELECT s.PRODUCTION_BATCH_ID,
             SUM(CASE WHEN n.CHALLAN_ID IS NOT NULL THEN n.QTY ELSE s.TOTAL_ISSUED END) ISSUED_QTY
      FROM stitching_jobs s LEFT JOIN issue_new n ON n.CHALLAN_ID=s.CHALLAN_ID
      WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%'
      GROUP BY s.PRODUCTION_BATCH_ID
    )
    SELECT p.*,COALESCE(st.STYLE_NAME,p.STYLE_ID) STYLE_NAME,COALESCE(co.COLOR_NAME,p.COLOR_ID) COLOR_NAME,
      CASE WHEN cn.PRODUCTION_BATCH_ID IS NOT NULL THEN cn.QTY
           ELSE CASE WHEN p.TOTAL_CUT>0 THEN p.TOTAL_CUT ELSE p.M_CUT+p.L_CUT+p.XL_CUT+p."2XL_CUT"+p."3XL_CUT"+p.OTHER_CUT END END CUT_TOTAL,
      MAX(0,(CASE WHEN cn.PRODUCTION_BATCH_ID IS NOT NULL THEN cn.QTY
                  ELSE CASE WHEN p.TOTAL_CUT>0 THEN p.TOTAL_CUT ELSE p.M_CUT+p.L_CUT+p.XL_CUT+p."2XL_CUT"+p."3XL_CUT"+p.OTHER_CUT END END)-COALESCE(si.ISSUED_QTY,0)) CUT_BALANCE
    FROM production_batches p
    LEFT JOIN cut_new cn ON cn.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID
    LEFT JOIN issue_by_pb si ON si.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID
    LEFT JOIN styles st ON st.STYLE_ID=p.STYLE_ID
    LEFT JOIN colors co ON co.COLOR_ID=p.COLOR_ID
    WHERE COALESCE(p.STATUS,'') NOT LIKE 'CANCELLED%'
      AND MAX(0,(CASE WHEN cn.PRODUCTION_BATCH_ID IS NOT NULL THEN cn.QTY
                      ELSE CASE WHEN p.TOTAL_CUT>0 THEN p.TOTAL_CUT ELSE p.M_CUT+p.L_CUT+p.XL_CUT+p."2XL_CUT"+p."3XL_CUT"+p.OTHER_CUT END END)-COALESCE(si.ISSUED_QTY,0))>0
    ORDER BY p.PLAN_DATE,p.PRODUCTION_BATCH_ID`);

  const stitchingChallans=await rows(db,`
    WITH rec_new AS (
      SELECT l.CHALLAN_ID,SUM(l.QTY) QTY
      FROM stitching_receipt_lines l
      JOIN stitching_receipts r ON r.RECEIPT_ID=l.RECEIPT_ID AND COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%'
      GROUP BY l.CHALLAN_ID
    ),
    q AS (
      SELECT CHALLAN_ID,SUM(QC_QTY) QC_QTY
      FROM qc_events
      WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' AND COALESCE(REWORK_CHALLAN_ID,'')=''
      GROUP BY CHALLAN_ID
    )
    SELECT s.*,COALESCE(st.STYLE_NAME,s.STYLE_ID) STYLE_NAME,COALESCE(co.COLOR_NAME,s.COLOR_ID) COLOR_NAME,
      COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) VENDOR_NAME,
      CASE WHEN rn.CHALLAN_ID IS NOT NULL THEN rn.QTY ELSE s.TOTAL_RECEIVED END ACTUAL_RECEIVED,
      MAX(0,(CASE WHEN rn.CHALLAN_ID IS NOT NULL THEN rn.QTY ELSE s.TOTAL_RECEIVED END)-COALESCE(q.QC_QTY,0)) QC_PENDING
    FROM stitching_jobs s
    LEFT JOIN rec_new rn ON rn.CHALLAN_ID=s.CHALLAN_ID
    LEFT JOIN q ON q.CHALLAN_ID=s.CHALLAN_ID
    LEFT JOIN styles st ON st.STYLE_ID=s.STYLE_ID
    LEFT JOIN colors co ON co.COLOR_ID=s.COLOR_ID
    LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID
    WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%'
      AND MAX(0,(CASE WHEN rn.CHALLAN_ID IS NOT NULL THEN rn.QTY ELSE s.TOTAL_RECEIVED END)-COALESCE(q.QC_QTY,0))>0
    ORDER BY s.ISSUE_DATE,s.CHALLAN_ID`);

  const wr=await warehouseReady(db);
  const styleMap=Object.fromEntries(styles.map(x=>[x.STYLE_ID,x.STYLE_NAME]));
  const colorMap=Object.fromEntries(colors.map(x=>[x.COLOR_ID,x.COLOR_NAME]));
  for(const x of wr){x.STYLE_NAME=styleMap[x.STYLE_ID]||x.STYLE_ID;x.COLOR_NAME=colorMap[x.COLOR_ID]||x.COLOR_ID}

  return{
    vendors,fabrics,colors,styles,sizes,defects,rawRolls,
    rawFabricGroups:Object.values(group).sort((a,b)=>String(a.FABRIC_NAME).localeCompare(String(b.FABRIC_NAME))),
    dyeBatches:allDyeBatches.filter(x=>n(x.BALANCE_MTR)>0.0001),
    dyePendingReceipt:allDyeBatches.filter(x=>!truth(x.CLOSED)),
    productionBatches,stitchingChallans,warehouseReady:wr
  }
}

function uniq(a){return [...new Set((a||[]).filter(Boolean).map(String))]}
function qs(a){return a.map(()=>'?').join(',')}
async function traceRecord(db,type,id){
  type=String(type||'').toLowerCase();id=String(id||'');
  if(!type||!id)throw err('Trail type and record id are required.',400);

  let rollIds=[],dyeBatchIds=[],prodIds=[],challanIds=[],qcIds=[],handoverIds=[];

  if(type==='raw')rollIds=[id];
  else if(type==='dye')dyeBatchIds=[id];
  else if(type==='production')prodIds=[id];
  else if(type==='stitching')challanIds=[id];
  else if(type==='qc')qcIds=[id];
  else if(type==='handover')handoverIds=[id];
  else throw err('Unknown trail type.',400);

  if(qcIds.length){
    const a=await rows(db,`SELECT * FROM qc_events WHERE QC_ID IN (${qs(qcIds)})`,...qcIds);
    challanIds=uniq([...challanIds,...a.map(x=>x.CHALLAN_ID)]);
    prodIds=uniq([...prodIds,...a.map(x=>x.PRODUCTION_BATCH_ID)]);
  }
  if(handoverIds.length){
    const a=await rows(db,`SELECT * FROM warehouse_handover WHERE HANDOVER_ID IN (${qs(handoverIds)})`,...handoverIds);
    prodIds=uniq([...prodIds,...a.map(x=>x.PRODUCTION_BATCH_ID)]);
  }
  if(challanIds.length){
    const a=await rows(db,`SELECT * FROM stitching_jobs WHERE CHALLAN_ID IN (${qs(challanIds)})`,...challanIds);
    prodIds=uniq([...prodIds,...a.map(x=>x.PRODUCTION_BATCH_ID)]);
  }
  if(prodIds.length){
    const a=await rows(db,`SELECT * FROM production_batches WHERE PRODUCTION_BATCH_ID IN (${qs(prodIds)})`,...prodIds);
    dyeBatchIds=uniq([...dyeBatchIds,...a.map(x=>x.DYE_BATCH_ID)]);
  }
  if(dyeBatchIds.length){
    const a=await rows(db,`SELECT * FROM dye_jobs WHERE DYE_BATCH_ID IN (${qs(dyeBatchIds)})`,...dyeBatchIds);
    rollIds=uniq([...rollIds,...a.map(x=>x.ROLL_ID)]);
  }
  if(rollIds.length&&!dyeBatchIds.length){
    const a=await rows(db,`SELECT * FROM dye_jobs WHERE ROLL_ID IN (${qs(rollIds)})`,...rollIds);
    dyeBatchIds=uniq(a.map(x=>x.DYE_BATCH_ID));
  }
  if(dyeBatchIds.length&&!prodIds.length){
    const a=await rows(db,`SELECT * FROM production_batches WHERE DYE_BATCH_ID IN (${qs(dyeBatchIds)})`,...dyeBatchIds);
    prodIds=uniq(a.map(x=>x.PRODUCTION_BATCH_ID));
  }
  if(prodIds.length&&!challanIds.length){
    const a=await rows(db,`SELECT * FROM stitching_jobs WHERE PRODUCTION_BATCH_ID IN (${qs(prodIds)})`,...prodIds);
    challanIds=uniq(a.map(x=>x.CHALLAN_ID));
  }

  const raw=rollIds.length?await rows(db,`
    SELECT r.ROLL_ID,r.INWARD_ID,r.INWARD_DATE,r.VENDOR_ROLL_NO,r.INWARD_MTR,r.INVOICE_CHALLAN,r.LOT_REF,
           COALESCE(v.VENDOR_NAME,r.SUPPLIER_ID) SUPPLIER,COALESCE(f.FABRIC_NAME,r.FABRIC_ID) FABRIC
    FROM raw_inward r
    LEFT JOIN vendors v ON v.VENDOR_ID=r.SUPPLIER_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=r.FABRIC_ID
    WHERE r.ROLL_ID IN (${qs(rollIds)}) ORDER BY r.INWARD_DATE,r.ROLL_ID`,...rollIds):[];

  const dyeJobs=dyeBatchIds.length?await rows(db,`
    SELECT d.DYE_PLAN_ID,d.DYE_BATCH_ID,d.ISSUE_DATE,d.ROLL_ID,d.VENDOR_ROLL_NO,d.ISSUE_MTR,
           COALESCE(v.VENDOR_NAME,d.DYE_VENDOR_ID) DYE_VENDOR,
           COALESCE(f.FABRIC_NAME,d.FABRIC_ID) FABRIC,COALESCE(c.COLOR_NAME,d.COLOR_ID) COLOR
    FROM dye_jobs d
    LEFT JOIN vendors v ON v.VENDOR_ID=d.DYE_VENDOR_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=d.FABRIC_ID
    LEFT JOIN colors c ON c.COLOR_ID=d.COLOR_ID
    WHERE d.DYE_BATCH_ID IN (${qs(dyeBatchIds)})
    ORDER BY d.ISSUE_DATE,d.DYE_BATCH_ID,d.ROLL_ID`,...dyeBatchIds):[];

  const dyeReceipts=dyeBatchIds.length?await rows(db,`
    SELECT * FROM dye_receipts WHERE DYE_BATCH_ID IN (${qs(dyeBatchIds)}) ORDER BY RECEIPT_DATE,RECEIPT_ID`,...dyeBatchIds):[];

  const production=prodIds.length?await rows(db,`
    SELECT p.*,COALESCE(s.STYLE_NAME,p.STYLE_ID) STYLE,COALESCE(f.FABRIC_NAME,p.FABRIC_ID) FABRIC,
           COALESCE(c.COLOR_NAME,p.COLOR_ID) COLOR
    FROM production_batches p
    LEFT JOIN styles s ON s.STYLE_ID=p.STYLE_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=p.FABRIC_ID
    LEFT JOIN colors c ON c.COLOR_ID=p.COLOR_ID
    WHERE p.PRODUCTION_BATCH_ID IN (${qs(prodIds)}) ORDER BY p.PLAN_DATE,p.PRODUCTION_BATCH_ID`,...prodIds):[];

  if(prodIds.length){
    const st=await rows(db,`SELECT CHALLAN_ID FROM stitching_jobs WHERE PRODUCTION_BATCH_ID IN (${qs(prodIds)})`,...prodIds);
    challanIds=uniq([...challanIds,...st.map(x=>x.CHALLAN_ID)]);
  }

  const stitching=challanIds.length?await rows(db,`
    SELECT s.*,COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) STITCHING_VENDOR,
           COALESCE(st.STYLE_NAME,s.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,s.COLOR_ID) COLOR
    FROM stitching_jobs s
    LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID
    LEFT JOIN styles st ON st.STYLE_ID=s.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=s.COLOR_ID
    WHERE s.CHALLAN_ID IN (${qs(challanIds)}) ORDER BY s.ISSUE_DATE,s.CHALLAN_ID`,...challanIds):[];

  const qc=(prodIds.length||challanIds.length||qcIds.length)?await rows(db,`
    SELECT q.*,COALESCE(v.VENDOR_NAME,q.VENDOR_ID) VENDOR,COALESCE(st.STYLE_NAME,q.STYLE_ID) STYLE,
           COALESCE(c.COLOR_NAME,q.COLOR_ID) COLOR
    FROM qc_events q
    LEFT JOIN vendors v ON v.VENDOR_ID=q.VENDOR_ID
    LEFT JOIN styles st ON st.STYLE_ID=q.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=q.COLOR_ID
    WHERE ${[
      prodIds.length?`q.PRODUCTION_BATCH_ID IN (${qs(prodIds)})`:null,
      challanIds.length?`q.CHALLAN_ID IN (${qs(challanIds)})`:null,
      qcIds.length?`q.QC_ID IN (${qs(qcIds)})`:null
    ].filter(Boolean).join(' OR ')}
    ORDER BY q.QC_DATE,q.QC_ID`,
    ...prodIds,...challanIds,...qcIds):[];

  const hand=prodIds.length?await rows(db,`
    SELECT h.*,COALESCE(st.STYLE_NAME,h.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,h.COLOR_ID) COLOR
    FROM warehouse_handover h
    LEFT JOIN styles st ON st.STYLE_ID=h.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=h.COLOR_ID
    WHERE h.PRODUCTION_BATCH_ID IN (${qs(prodIds)})
    ORDER BY h.HANDOVER_DATE,h.HANDOVER_ID`,...prodIds):[];

  const planIds=uniq(dyeJobs.map(x=>x.DYE_PLAN_ID));
  return{
    seed:{type,id},
    ids:{rollIds,dyePlanIds:planIds,dyeBatchIds,productionBatchIds:prodIds,challanIds},
    stages:[
      {key:'raw',label:'Raw Fabric',items:raw},
      {key:'dye',label:'Dye Issue / Plan',items:dyeJobs},
      {key:'dye_receipt',label:'Dye Receipt',items:dyeReceipts},
      {key:'production',label:'Production / Cutting',items:production},
      {key:'stitching',label:'Stitching',items:stitching},
      {key:'qc',label:'QC / Rework',items:qc},
      {key:'handover',label:'Warehouse Handover',items:hand}
    ]
  }
}
export async function getDataD1(env,{module,actorUserId,id='',type='',limit=100,offset=0,search='',user='',action='',dateFrom='',dateTo=''}){
  await ensureSchema(env);const db=env.DB,m=String(module||'dashboard'),trailPerm=m==='trail'?({raw:'raw',dye:'dye',production:'production',stitching:'stitching',qc:'qc',handover:'qc'}[String(type||'').toLowerCase()]||null):null,perm=trailPerm||({raw:'raw',dye:'dye',dye_detail:'dye',production:'production',production_detail:'production',stitching:'stitching',stitching_detail:'stitching',qc:'qc',qc_detail:'qc',handover:'qc',handover_detail:'qc',reports:'reports'}[m]||null),a=await actor(db,actorUserId,perm,false);if(perm&&m!=='trail')await requireAction(db,a,perm,'view');
  if(m==='dashboard'){a.actions=await actionPerms(db,a.userId);const canReports=a.admin||((a.permissions?.reports)&&a.actions?.reports?.view!==false),analytics=canReports?await operationsAnalytics(db):null;return{user:a,kpis:await kpisD1(db),alerts:analytics?{exceptionCount:analytics.exceptionCount,rates:analytics.rates,exceptions:analytics.exceptions.slice(0,8)}:{exceptionCount:0,rates:{},exceptions:[]}}};if(m==='trail'){await requireAction(db,a,trailPerm,'view');return{trail:await traceRecord(db,type,id)}};if(m==='dye_detail')return{detail:await getDyeBatchDetail(db,String(id||''))};if(m==='production_detail')return{detail:await getProductionDetail(db,String(id||''))};if(m==='stitching_detail')return{detail:await getStitchingDetail(db,String(id||''))};if(m==='qc_detail')return{detail:await getQcDetail(db,String(id||''))};if(m==='handover_detail')return{detail:await getHandoverDetail(db,String(id||''))};if(m==='lookups')return{lookups:await lookupData(db)};if(m==='raw')return{items:await viewRaw(db)};if(m==='dye')return{items:await viewDye(db)};if(m==='production')return{items:await viewProd(db)};if(m==='stitching')return{items:await viewStitch(db)};if(m==='qc')return{items:await viewQc(db)};if(m==='handover')return{items:await viewHandover(db)};if(m==='reports')return{items:[],kpis:await kpisD1(db),analytics:await operationsAnalytics(db)};if(m==='audit'){
    await requireAction(db,a,'reports','audit');
    const lim=Math.min(250,Math.max(10,Number(limit)||100)),off=Math.max(0,Number(offset)||0),w=[],b=[];
    if(search){w.push('(RECORD_ID LIKE ? OR MODULE LIKE ? OR ACTION LIKE ? OR USER_NAME LIKE ?)');const q='%'+String(search).slice(0,80)+'%';b.push(q,q,q,q)}
    if(user){w.push('(USER_ID=? OR USER_NAME=?)');b.push(user,user)}
    if(action){w.push('ACTION=?');b.push(action)}
    if(dateFrom){w.push('substr(TIMESTAMP,1,10)>=?');b.push(dateFrom)}
    if(dateTo){w.push('substr(TIMESTAMP,1,10)<=?');b.push(dateTo)}
    const where=w.length?' WHERE '+w.join(' AND '):'',total=n((await row(db,'SELECT COUNT(*) c FROM audit_log'+where,...b))?.c);
    return{items:await rows(db,'SELECT AUDIT_ID,TIMESTAMP,USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID,OLD_VALUE_JSON,NEW_VALUE_JSON,DEVICE_INFO,IP_HASH FROM audit_log'+where+' ORDER BY TIMESTAMP DESC LIMIT ? OFFSET ?',...b,lim,off),total,limit:lim,offset:off}
  };if(m==='errors'){
    await requireAction(db,a,'reports','audit');
    const lim=Math.min(250,Math.max(10,Number(limit)||100)),off=Math.max(0,Number(offset)||0),w=[],b=[];
    if(search){w.push('(MESSAGE LIKE ? OR MODULE LIKE ? OR USER_ID LIKE ?)');const q='%'+String(search).slice(0,80)+'%';b.push(q,q,q)}
    if(user){w.push('USER_ID=?');b.push(user)}
    if(dateFrom){w.push('substr(TIMESTAMP,1,10)>=?');b.push(dateFrom)}
    if(dateTo){w.push('substr(TIMESTAMP,1,10)<=?');b.push(dateTo)}
    const where=w.length?' WHERE '+w.join(' AND '):'',total=n((await row(db,'SELECT COUNT(*) c FROM app_errors'+where,...b))?.c);
    const items=await rows(db,'SELECT ERROR_ID,TIMESTAMP,USER_ID,MODULE,MESSAGE,CONTEXT_JSON FROM app_errors'+where+' ORDER BY TIMESTAMP DESC LIMIT ? OFFSET ?',...b,lim,off);
    return{items,total,limit:lim,offset:off,groups:await rows(db,`SELECT MODULE,MESSAGE,COUNT(*) OCCURRENCES,MAX(TIMESTAMP) LAST_SEEN FROM app_errors ${where} GROUP BY MODULE,MESSAGE ORDER BY OCCURRENCES DESC,LAST_SEEN DESC LIMIT 50`,...b)}
  };if(m==='masters'){await actor(db,actorUserId,null,true);return{masters:await masterData(db)}}throw err('Unknown module.',404)
}

async function saveMaster(db,r,a){
  const entity=String(r.entity||'').toLowerCase(),cfg={vendor:{table:'vendors',key:'VENDOR_ID',prefix:'VEN',fields:['VENDOR_ID','VENDOR_NAME','FABRIC_SUPPLIER','DYE_VENDOR','STITCHING_VENDOR','CUTTING_VENDOR','PHONE','GST_REF','ADDRESS','ACTIVE','CREATED_AT','UPDATED_AT']},fabric:{table:'fabrics',key:'FABRIC_ID',prefix:'FAB',fields:['FABRIC_ID','FABRIC_NAME','FABRIC_CODE','UOM','ACTIVE','NOTES','CREATED_AT','UPDATED_AT']},color:{table:'colors',key:'COLOR_ID',prefix:'CLR',fields:['COLOR_ID','COLOR_NAME','COLOR_CODE','ACTIVE','CREATED_AT','UPDATED_AT']},style:{table:'styles',key:'STYLE_ID',prefix:'STY',fields:['STYLE_ID','STYLE_NAME','CATEGORY','STYLE_CODE','DEFAULT_FABRIC_ID','ACTIVE','NOTES','CREATED_AT','UPDATED_AT']},size:{table:'sizes',key:'SIZE_ID',prefix:'SIZ',fields:['SIZE_ID','SIZE_NAME','SORT_ORDER','ACTIVE','CREATED_AT','UPDATED_AT']},defect:{table:'defect_reasons',key:'DEFECT_ID',prefix:'DEF',fields:['DEFECT_ID','DEFECT_NAME','STAGE','CATEGORY','ACTIVE','NOTES','CREATED_AT','UPDATED_AT']}}[entity];if(!cfg)throw err('Unknown master type.',400);
  const dupRules={
    vendor:[['VENDOR_NAME','Vendor name']],
    fabric:[['FABRIC_NAME','Fabric name'],['FABRIC_CODE','Fabric code']],
    color:[['COLOR_NAME','Color name'],['COLOR_CODE','Color code']],
    style:[['STYLE_NAME','Style name'],['STYLE_CODE','Style code']],
    size:[['SIZE_NAME','Size name']],
    defect:[['DEFECT_NAME','Defect reason']]
  }[entity]||[];

  const id=String(r[cfg.key]||'').trim()||await nextMasterId(db,cfg.prefix),old=await row(db,`SELECT * FROM ${cfg.table} WHERE "${cfg.key}"=?`,id),t=now(),obj=cleanRow({...r,[cfg.key]:id,ACTIVE:r.ACTIVE===false||String(r.ACTIVE).toLowerCase()==='false'?0:1,CREATED_AT:old?.CREATED_AT||t,UPDATED_AT:t});
  for(const [field,label] of dupRules){
    const value=String(obj[field]||'').trim();if(!value)continue;
    const dupe=await row(db,`SELECT "${cfg.key}" id FROM ${cfg.table} WHERE UPPER(TRIM(COALESCE("${field}",'')))=UPPER(TRIM(?)) AND "${cfg.key}"<>? LIMIT 1`,value,id);
    if(dupe)throw err(label+' already exists.',409)
  }
  const vals=cfg.fields.map(k=>obj[k]??''),updates=cfg.fields.filter(k=>k!==cfg.key).map(k=>`"${k}"=excluded."${k}"`).join(',');
  await db.prepare(`INSERT INTO ${cfg.table}(${cfg.fields.map(quoteCol).join(',')}) VALUES(${cfg.fields.map(()=>'?').join(',')}) ON CONFLICT("${cfg.key}") DO UPDATE SET ${updates}`).bind(...vals).run();
  await audit(db,a,old?'UPDATE_MASTER':'CREATE_MASTER',entity.toUpperCase(),id,old?JSON.stringify(old):'',JSON.stringify(obj));return obj
}
async function rawFingerprint(db,supplier,invoice,lot,dateVal,items){
  const rs=await rows(db,`SELECT * FROM raw_inward WHERE SUPPLIER_ID=? AND COALESCE(INVOICE_CHALLAN,'')=? AND COALESCE(LOT_REF,'')=? AND substr(INWARD_DATE,1,10)=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' ORDER BY INWARD_ID,ROLL_ID`,supplier,invoice,lot,dateOnly(dateVal));
  const groups={};for(const r of rs)(groups[r.INWARD_ID]||(groups[r.INWARD_ID]=[])).push(r);
  const target=items.map(x=>[String(x.FABRIC_ID||''),String(x.VENDOR_ROLL_NO||''),n(x.INWARD_MTR).toFixed(3)].join('|')).sort().join('~');
  for(const [id,g] of Object.entries(groups)){const fp=g.map(x=>[String(x.FABRIC_ID||''),String(x.VENDOR_ROLL_NO||''),n(x.INWARD_MTR).toFixed(3)].join('|')).sort().join('~');if(fp===target)return{INWARD_ID:id,ROLL_COUNT:g.length,TOTAL_MTR:g.reduce((s,x)=>s+n(x.INWARD_MTR),0),ROLL_IDS:g.map(x=>x.ROLL_ID),DUPLICATE_PREVENTED:true}}
  return null
}
async function saveRawBulk(db,r,a,req=''){
  const supplier=String(r.SUPPLIER_ID||''),invoice=String(r.INVOICE_CHALLAN||''),lot=String(r.LOT_REF||''),items=Array.isArray(r.items)?r.items:[],d=dateOnly(r.INWARD_DATE),notes=String(r.NOTES||'');if(!supplier)throw err('Supplier is required.',400);if(!items.length)throw err('Add at least one fabric roll.',400);for(let i=0;i<items.length;i++){if(!items[i].FABRIC_ID)throw err('Fabric is required on roll '+(i+1)+'.',400);requirePos(items[i].INWARD_MTR,'Roll '+(i+1)+' meter')}
  const dupe=await rawFingerprint(db,supplier,invoice,lot,d,items);if(dupe)return dupe;const inward=await nextId(db,'INW'),t=now(),rolls=[],stmts=[];
  for(const x of items){const roll=await nextId(db,'RF');rolls.push(roll);stmts.push(db.prepare('INSERT INTO raw_inward(ROW_ID,INWARD_ID,ROLL_ID,INWARD_DATE,SUPPLIER_ID,VENDOR_ROLL_NO,FABRIC_ID,INWARD_MTR,INVOICE_CHALLAN,LOT_REF,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),inward,roll,d,supplier,String(x.VENDOR_ROLL_NO||''),String(x.FABRIC_ID||''),n(x.INWARD_MTR),invoice,lot,'AVAILABLE',String(x.NOTES||notes),a.userId,t,a.userId,t))}
  const result={INWARD_ID:inward,ROLL_COUNT:items.length,TOTAL_MTR:items.reduce((s,x)=>s+n(x.INWARD_MTR),0),ROLL_IDS:rolls};stmts.push(auditStmt(db,a,'CREATE_BULK','RAW',inward,'',JSON.stringify(result)));await db.batch(stmts);return result
}


async function editRaw(db,r,a,req=''){
  const roll=String(r.ROLL_ID||''),old=await row(db,'SELECT * FROM raw_inward WHERE ROLL_ID=?',roll);
  if(!old)throw err('Raw roll not found.',404);
  const issued=n((await row(db,'SELECT COALESCE(SUM(ISSUE_MTR),0) q FROM dye_jobs WHERE ROLL_ID=?',roll))?.q);
  const newQty=n(r.INWARD_MTR??old.INWARD_MTR);requirePos(newQty,'Inward meter');
  if(newQty+0.0001<issued)throw err('Inward meter cannot be less than already-issued '+issued+' m.',409);
  const newFabric=String(r.FABRIC_ID??old.FABRIC_ID);
  if(issued>0.0001&&newFabric!==String(old.FABRIC_ID))throw err('Fabric type cannot be changed after this roll has been issued to dye.',409);
  const supplier=String(r.SUPPLIER_ID??old.SUPPLIER_ID);
  if(!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1 AND FABRIC_SUPPLIER=1',supplier))throw err('Select a valid active Fabric Supplier.',400);
  if(!await row(db,'SELECT 1 ok FROM fabrics WHERE FABRIC_ID=? AND ACTIVE=1',newFabric))throw err('Select a valid active fabric.',400);
  await acquireLock(db,'raw:'+roll,req);
  try{
    const t=now(),after={...old,INWARD_DATE:dateOnly(r.INWARD_DATE||old.INWARD_DATE),SUPPLIER_ID:supplier,VENDOR_ROLL_NO:String(r.VENDOR_ROLL_NO??old.VENDOR_ROLL_NO),FABRIC_ID:newFabric,INWARD_MTR:newQty,INVOICE_CHALLAN:String(r.INVOICE_CHALLAN??old.INVOICE_CHALLAN),LOT_REF:String(r.LOT_REF??old.LOT_REF),NOTES:String(r.NOTES??old.NOTES),UPDATED_BY:a.userId,UPDATED_AT:t};
    await db.batch([
      db.prepare(`UPDATE raw_inward SET INWARD_DATE=?,SUPPLIER_ID=?,VENDOR_ROLL_NO=?,FABRIC_ID=?,INWARD_MTR=?,INVOICE_CHALLAN=?,LOT_REF=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE ROLL_ID=?`)
        .bind(after.INWARD_DATE,supplier,after.VENDOR_ROLL_NO,newFabric,newQty,after.INVOICE_CHALLAN,after.LOT_REF,after.NOTES,a.userId,t,roll),
      auditStmt(db,a,'EDIT_RAW','RAW',roll,JSON.stringify(old),JSON.stringify(after))
    ]);return after
  }finally{await releaseLock(db,'raw:'+roll)}
}
async function cancelRaw(db,r,a){
  const roll=String(r.ROLL_ID||''),old=await row(db,'SELECT * FROM raw_inward WHERE ROLL_ID=?',roll);if(!old)throw err('Raw roll not found.',404);
  const issued=n((await row(db,'SELECT COALESCE(SUM(ISSUE_MTR),0) q FROM dye_jobs WHERE ROLL_ID=?',roll))?.q);
  if(issued>0.0001)throw err('This roll has already been issued to dye. Cancel/reverse downstream dye issue first.',409);
  const t=now(),reason=String(r.REASON||'Mistaken entry');
  await db.batch([
    db.prepare("UPDATE raw_inward SET STATUS=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE ROLL_ID=?").bind('CANCELLED',String(old.NOTES||'')+(old.NOTES?' | ':'')+'Cancelled: '+reason,a.userId,t,roll),
    auditStmt(db,a,'CANCEL_RAW','RAW',roll,JSON.stringify(old),JSON.stringify({cancelled:true,reason}))
  ]);return{ROLL_ID:roll,cancelled:true}
}
async function cancelProduction(db,r,a){
  const id=String(r.PRODUCTION_BATCH_ID||''),old=await row(db,'SELECT * FROM production_batches WHERE PRODUCTION_BATCH_ID=?',id);if(!old)throw err('Production batch not found.',404);
  const downstream=n((await row(db,"SELECT COUNT(*) c FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  if(downstream)throw err('Production batch already has active stitching challans. Reverse/cancel them first.',409);
  const reason=String(r.REASON||'Mistaken entry'),t=now();
  await db.batch([
    db.prepare("UPDATE production_batches SET STATUS='CANCELLED',NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE PRODUCTION_BATCH_ID=?").bind(String(old.NOTES||'')+(old.NOTES?' | ':'')+'Cancelled: '+reason,a.userId,t,id),
    db.prepare("UPDATE production_cut_actuals SET STATUS='CANCELLED',UPDATED_BY=?,UPDATED_AT=? WHERE PRODUCTION_BATCH_ID=?").bind(a.userId,t,id),
    auditStmt(db,a,'CANCEL_PRODUCTION','PRODUCTION',id,JSON.stringify(old),JSON.stringify({cancelled:true,reason}))
  ]);return{PRODUCTION_BATCH_ID:id,cancelled:true}
}
async function cancelStitching(db,r,a){
  const id=String(r.CHALLAN_ID||''),old=await row(db,'SELECT * FROM stitching_jobs WHERE CHALLAN_ID=?',id);if(!old)throw err('Stitching challan not found.',404);
  const qc=n((await row(db,"SELECT COUNT(*) c FROM qc_events WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  const rec=n((await row(db,"SELECT COUNT(*) c FROM stitching_receipts WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  if(qc||rec)throw err('This challan has active receipts/QC. Reverse/cancel downstream records first.',409);
  const reason=String(r.REASON||'Mistaken entry'),t=now();
  await db.batch([
    db.prepare("UPDATE stitching_jobs SET STATUS='CANCELLED',NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE CHALLAN_ID=?").bind(String(old.NOTES||'')+(old.NOTES?' | ':'')+'Cancelled: '+reason,a.userId,t,id),
    auditStmt(db,a,'CANCEL_STITCHING','STITCHING',id,JSON.stringify(old),JSON.stringify({cancelled:true,reason}))
  ]);return{CHALLAN_ID:id,cancelled:true}
}
async function cancelQc(db,r,a){
  const id=String(r.QC_ID||''),old=await row(db,'SELECT * FROM qc_events WHERE QC_ID=?',id);if(!old)throw err('QC entry not found.',404);
  const rework=n((await row(db,"SELECT COUNT(*) c FROM rework_jobs WHERE QC_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  const downstream=n((await row(db,"SELECT COUNT(*) c FROM warehouse_handover WHERE PRODUCTION_BATCH_ID=? AND STYLE_ID=? AND COLOR_ID=? AND SIZE=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",old.PRODUCTION_BATCH_ID,old.STYLE_ID,old.COLOR_ID,old.SIZE))?.c);
  if(rework||downstream)throw err('This QC result has active rework/warehouse downstream. Reverse/cancel downstream first.',409);
  const reason=String(r.REASON||'Mistaken entry'),t=now();
  await db.batch([
    db.prepare("UPDATE qc_events SET STATUS='CANCELLED',NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE QC_ID=?").bind(String(old.NOTES||'')+(old.NOTES?' | ':'')+'Cancelled: '+reason,a.userId,t,id),
    auditStmt(db,a,'CANCEL_QC','QC',id,JSON.stringify(old),JSON.stringify({cancelled:true,reason}))
  ]);return{QC_ID:id,cancelled:true}
}
async function cancelHandover(db,r,a){
  const id=String(r.HANDOVER_ID||''),old=await row(db,'SELECT * FROM warehouse_handover WHERE HANDOVER_ID=?',id);if(!old)throw err('Handover entry not found.',404);
  const receipts=n((await row(db,"SELECT COUNT(*) c FROM warehouse_receipts WHERE HANDOVER_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  if(receipts)throw err('This handover has warehouse receipt entries. Cancel those receipts first.',409);
  const reason=String(r.REASON||'Mistaken entry'),t=now();
  await db.batch([
    db.prepare("UPDATE warehouse_handover SET STATUS='CANCELLED',NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE HANDOVER_ID=?").bind(String(old.NOTES||'')+(old.NOTES?' | ':'')+'Cancelled: '+reason,a.userId,t,id),
    auditStmt(db,a,'CANCEL_HANDOVER','HANDOVER',id,JSON.stringify(old),JSON.stringify({cancelled:true,reason}))
  ]);return{HANDOVER_ID:id,cancelled:true}
}
async function saveDyeSingle(db,r,a,req=''){
  const roll=String(r.ROLL_ID||''),issue=n(r.ISSUE_MTR);requirePos(issue,'Issue meter');
  const rr=await row(db,"SELECT * FROM raw_inward WHERE ROLL_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",roll);if(!rr)throw err('Raw roll not found.',400);
  const bal=await rawBalance(db,roll);if(issue>bal+0.0001)throw err('Issue meter exceeds raw roll balance.',409);
  await acquireLock(db,'raw:'+roll,req);
  try{
    const fresh=await rawBalance(db,roll);if(issue>fresh+0.0001)throw err('Raw roll balance changed. Refresh and retry.',409);
    const id=await nextId(db,'DB'),t=now();
    await db.batch([
      db.prepare('INSERT INTO dye_jobs(ROW_ID,DYE_BATCH_ID,ISSUE_DATE,DYE_VENDOR_ID,ROLL_ID,VENDOR_ROLL_NO,FABRIC_ID,COLOR_ID,ISSUE_MTR,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT,DYE_PLAN_ID) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uuid(),id,dateOnly(r.ISSUE_DATE),String(r.DYE_VENDOR_ID||''),roll,String(rr.VENDOR_ROLL_NO||''),String(rr.FABRIC_ID||''),String(r.COLOR_ID||''),issue,'AT DYE VENDOR',String(r.NOTES||''),a.userId,t,a.userId,t,''),
      auditStmt(db,a,'CREATE','DYE',id,'',JSON.stringify(r))
    ]);return{DYE_BATCH_ID:id}
  }finally{await releaseLock(db,'raw:'+roll)}
}
async function saveDyeBulk(db,r,a,req=''){
  const vendor=String(r.DYE_VENDOR_ID||''),color=String(r.COLOR_ID||''),items=Array.isArray(r.items)?r.items:[],d=dateOnly(r.ISSUE_DATE),notes=String(r.NOTES||'');
  if(!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1 AND DYE_VENDOR=1',vendor))throw err('Selected vendor is not an active Dye Vendor.',400);
  if(!await row(db,'SELECT 1 ok FROM colors WHERE COLOR_ID=? AND ACTIVE=1',color))throw err('Selected color is not active.',400);
  if(!items.length)throw err('Add at least one raw fabric roll.',400);
  const seen=new Set(),fabrics=new Set(),resolved=[];
  for(let i=0;i<items.length;i++){const x=items[i],roll=String(x.ROLL_ID||''),qty=n(x.ISSUE_MTR);if(!roll)throw err('Roll is required on line '+(i+1)+'.',400);if(seen.has(roll))throw err('Same roll cannot be selected twice in one dye batch.',409);seen.add(roll);requirePos(qty,'Issue meter on line '+(i+1));const rr=await row(db,"SELECT * FROM raw_inward WHERE ROLL_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",roll);if(!rr)throw err('Roll '+roll+' is not available.',409);const bal=await rawBalance(db,roll);if(qty>bal+0.0001)throw err('Issue meter exceeds available balance for roll '+(rr.VENDOR_ROLL_NO||roll)+'. Available: '+bal,409);fabrics.add(String(rr.FABRIC_ID||''));resolved.push({x,rr})}
  if(fabrics.size!==1)throw err('One dye batch can contain rolls of only one fabric type. Create separate dye batches for different fabrics.',409);
  const fabric=[...fabrics][0];await acquireLock(db,'fabric:'+fabric,req);
  try{
    for(const {x,rr} of resolved){const fresh=await rawBalance(db,rr.ROLL_ID);if(n(x.ISSUE_MTR)>fresh+0.0001)throw err('Raw balance changed for roll '+(rr.VENDOR_ROLL_NO||rr.ROLL_ID)+'. Refresh and retry.',409)}
      const batch=await nextId(db,'DB'),t=now(),stmts=resolved.map(({x,rr})=>db.prepare('INSERT INTO dye_jobs(ROW_ID,DYE_BATCH_ID,ISSUE_DATE,DYE_VENDOR_ID,ROLL_ID,VENDOR_ROLL_NO,FABRIC_ID,COLOR_ID,ISSUE_MTR,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT,DYE_PLAN_ID) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),batch,d,vendor,String(x.ROLL_ID),String(rr.VENDOR_ROLL_NO||''),fabric,color,n(x.ISSUE_MTR),'AT DYE VENDOR',String(x.NOTES||notes),a.userId,t,a.userId,t,''));
    const result={DYE_BATCH_ID:batch,ROLL_COUNT:stmts.length,TOTAL_MTR:items.reduce((s,x)=>s+n(x.ISSUE_MTR),0),FABRIC_ID:fabric};stmts.push(auditStmt(db,a,'CREATE_BULK','DYE',batch,'',JSON.stringify(result)));await db.batch(stmts);return result
  }finally{await releaseLock(db,'fabric:'+fabric)}
}

async function saveDyePlan(db,r,a,req=''){
  const fabric=String(r.FABRIC_ID||''),items=Array.isArray(r.items)?r.items:[],d=dateOnly(r.ISSUE_DATE),notes=String(r.NOTES||'');if(!fabric)throw err('Fabric is required.',400);const fr=await row(db,'SELECT * FROM fabrics WHERE FABRIC_ID=? AND ACTIVE=1',fabric);if(!fr)throw err('Selected fabric is not active.',400);if(!items.length)throw err('Add at least one dye color.',400);
  const seen=new Set();let need=0;for(let i=0;i<items.length;i++){const x=items[i],c=String(x.COLOR_ID||''),v=String(x.DYE_VENDOR_ID||'');if(!c)throw err('Color is required on line '+(i+1)+'.',400);if(seen.has(c))throw err('Same color cannot appear twice in one dye plan.',409);seen.add(c);if(!await row(db,'SELECT 1 ok FROM colors WHERE COLOR_ID=? AND ACTIVE=1',c))throw err('Color on line '+(i+1)+' is not active.',400);if(!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1 AND DYE_VENDOR=1',v))throw err('Select a valid active Dye Vendor on line '+(i+1)+'.',400);requirePos(x.ISSUE_MTR,'Issue meter on line '+(i+1));need+=n(x.ISSUE_MTR)}
  await acquireLock(db,'fabric:'+fabric,req);
  try{
    const src=await rows(db,`SELECT r.*,MAX(0,r.INWARD_MTR-COALESCE(d.issued,0)) BALANCE_MTR FROM raw_inward r LEFT JOIN(SELECT ROLL_ID,SUM(ISSUE_MTR) issued FROM dye_jobs WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY ROLL_ID)d ON d.ROLL_ID=r.ROLL_ID WHERE r.FABRIC_ID=? AND COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%' AND r.INWARD_MTR-COALESCE(d.issued,0)>0.0001 ORDER BY r.INWARD_DATE,r.CREATED_AT,r.ROLL_ID`,fabric);const available=src.reduce((s,x)=>s+n(x.BALANCE_MTR),0);if(need>available+0.0001)throw err('Dye plan total '+need+' m exceeds available '+available+' m for '+await fabricName(db,fabric)+'.',409);
    const plan=await nextId(db,'DP'),t=now(),stmts=[],batches=[];let cursor=0;for(const item of items){const batch=await nextId(db,'DB'),qty=n(item.ISSUE_MTR),vendor=String(item.DYE_VENDOR_ID),color=String(item.COLOR_ID);let left=qty,lines=0;while(left>0.0001){while(cursor<src.length&&n(src[cursor].BALANCE_MTR)<=0.0001)cursor++;if(cursor>=src.length)throw err('Unexpected allocation shortage while creating dye plan.',500);const rr=src[cursor],take=Math.min(left,n(rr.BALANCE_MTR));stmts.push(db.prepare('INSERT INTO dye_jobs(ROW_ID,DYE_BATCH_ID,ISSUE_DATE,DYE_VENDOR_ID,ROLL_ID,VENDOR_ROLL_NO,FABRIC_ID,COLOR_ID,ISSUE_MTR,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT,DYE_PLAN_ID) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),batch,d,vendor,rr.ROLL_ID,rr.VENDOR_ROLL_NO||'',fabric,color,take,'AT DYE VENDOR',String(item.NOTES||notes),a.userId,t,a.userId,t,plan));rr.BALANCE_MTR=n(rr.BALANCE_MTR)-take;left-=take;lines++}const expected=item.EXPECTED_DATE||r.EXPECTED_DATE||'';if(expected)stmts.push(expectationStmt(db,'DYE',batch,expected,a.userId,'Dye expected return'));batches.push({DYE_BATCH_ID:batch,COLOR_ID:color,DYE_VENDOR_ID:vendor,ISSUE_MTR:qty,ROLL_LINES:lines,EXPECTED_DATE:expected})}
    const result={DYE_PLAN_ID:plan,FABRIC_ID:fabric,TOTAL_MTR:need,BATCH_COUNT:batches.length,BATCHES:batches};stmts.push(auditStmt(db,a,'CREATE_DYE_PLAN','DYE',plan,'',JSON.stringify(result)));await db.batch(stmts);return result
  }finally{await releaseLock(db,'fabric:'+fabric)}
}
async function saveDyeReceive(db,r,a){
  const batch=String(r.DYE_BATCH_ID||''),received=n(r.RECEIVED_MTR),defect=n(r.DEFECT_MTR),final=truth(r.FINAL_RECEIPT),s=await dyeBatchSummary(db,batch);if(!s)throw err('Invalid dye batch.',400);if(s.CLOSED)throw err('This dye batch is already closed.',409);requirePos(received,'Received meter');if(defect<0||defect>received)throw err('Defect meter must be between 0 and received meter.',409);
  const usable=received-defect,cumulative=n(s.RECEIVED_MTR)+received,variance=final?cumulative-n(s.ISSUE_MTR):0,status=final?(variance>0.0001?'CLOSED EXCESS':variance<-0.0001?'CLOSED SHORT':'CLOSED EXACT'):'PARTIAL',id=await nextId(db,'DR'),t=now();
  await db.prepare('INSERT INTO dye_receipts(RECEIPT_ID,DYE_BATCH_ID,RECEIPT_DATE,RECEIVED_MTR,DEFECT_MTR,USABLE_MTR,VARIANCE_MTR,FINAL_RECEIPT,STATUS,DEFECT_REASON,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,batch,dateOnly(r.RECEIPT_DATE),received,defect,usable,variance,final?1:0,status,String(r.DEFECT_REASON||''),String(r.NOTES||''),a.userId,t,a.userId,t).run();
  const after=await dyeBatchSummary(db,batch),plan=after?.DYE_PLAN_ID?await dyePlanSummary(db,after.DYE_PLAN_ID):null;await audit(db,a,'DYE_RECEIVE','DYE',batch,'',JSON.stringify({receiptId:id,received,defect,usable,finalReceipt:final,batchVariance:after?.VARIANCE_MTR||0,planVariance:plan?.VARIANCE_MTR||0}));return{RECEIPT_ID:id,DYE_BATCH_ID:batch,RECEIVED_MTR:received,DEFECT_MTR:defect,USABLE_MTR:usable,FINAL_RECEIPT:final,BATCH:after,PLAN:plan}
}

async function dyeDownstreamCount(db,batch){
  const r=await row(db,"SELECT COUNT(*) c FROM production_batches WHERE DYE_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",batch);
  return n(r?.c);
}
async function getDyeBatchDetail(db,batch){
  const head=await row(db,`
    SELECT j.DYE_BATCH_ID,j.DYE_PLAN_ID,MAX(j.ISSUE_DATE) ISSUE_DATE,MAX(j.DYE_VENDOR_ID) DYE_VENDOR_ID,
           MAX(j.FABRIC_ID) FABRIC_ID,MAX(j.COLOR_ID) COLOR_ID,SUM(j.ISSUE_MTR) ISSUE_MTR,
           MAX(j.NOTES) NOTES
    FROM dye_jobs j WHERE j.DYE_BATCH_ID=? AND COALESCE(j.STATUS,'') NOT LIKE 'CANCELLED%' GROUP BY j.DYE_BATCH_ID,j.DYE_PLAN_ID`,batch);
  if(!head)throw err('Dye batch not found.',404);
  const lines=await rows(db,`
    SELECT j.ROW_ID,j.ROLL_ID,j.VENDOR_ROLL_NO,j.ISSUE_MTR,
           MAX(0,r.INWARD_MTR-COALESCE(x.other_issued,0)) MAX_AVAILABLE_MTR
    FROM dye_jobs j
    JOIN raw_inward r ON r.ROLL_ID=j.ROLL_ID
    LEFT JOIN (
      SELECT ROLL_ID,SUM(ISSUE_MTR) other_issued FROM dye_jobs WHERE DYE_BATCH_ID<>? GROUP BY ROLL_ID
    ) x ON x.ROLL_ID=j.ROLL_ID
    WHERE j.DYE_BATCH_ID=? AND COALESCE(j.STATUS,'') NOT LIKE 'CANCELLED%' ORDER BY j.ROW_ID`,batch,batch);
  const receipts=await rows(db,"SELECT * FROM dye_receipts WHERE DYE_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' ORDER BY CREATED_AT,RECEIPT_ID",batch);
  return{...head,EXPECTED_DATE:await expectedDate(db,'DYE',batch),lines,receipts,downstreamCount:await dyeDownstreamCount(db,batch)}
}
async function editDyeBatch(db,r,a){
  const batch=String(r.DYE_BATCH_ID||'');if(!batch)throw err('Dye batch is required.',400);
  if(await dyeDownstreamCount(db,batch)>0)throw err('This dye batch is already used in Production. Direct issue edit is blocked. Use a correction/reversal workflow.',409);
  const old=await getDyeBatchDetail(db,batch);
  if(old.receipts.length)throw err('This batch already has dye receipts. Correct/cancel the receipt first, then edit the issue.',409);

  const vendor=String(r.DYE_VENDOR_ID||old.DYE_VENDOR_ID),color=String(r.COLOR_ID||old.COLOR_ID),
        issueDate=dateOnly(r.ISSUE_DATE||old.ISSUE_DATE),notes=String(r.NOTES??old.NOTES??''),
        items=Array.isArray(r.items)?r.items:[];
  if(!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1 AND DYE_VENDOR=1',vendor))throw err('Select a valid active Dye Vendor.',400);
  if(!await row(db,'SELECT 1 ok FROM colors WHERE COLOR_ID=? AND ACTIVE=1',color))throw err('Select a valid active color.',400);
  if(!items.length)throw err('At least one source roll is required.',400);

  const seen=new Set(),resolved=[];
  for(let i=0;i<items.length;i++){
    const roll=String(items[i].ROLL_ID||''),qty=n(items[i].ISSUE_MTR);
    if(!roll)throw err('Roll is required on line '+(i+1)+'.',400);
    if(seen.has(roll))throw err('Same roll cannot be selected twice.',409);seen.add(roll);
    requirePos(qty,'Issue meter on line '+(i+1));
    const rr=await row(db,'SELECT * FROM raw_inward WHERE ROLL_ID=?',roll);if(!rr)throw err('Raw roll '+roll+' not found.',404);
    if(String(rr.FABRIC_ID)!==String(old.FABRIC_ID))throw err('All rolls must be of the same original batch fabric.',409);
    const other=await row(db,"SELECT COALESCE(SUM(ISSUE_MTR),0) q FROM dye_jobs WHERE ROLL_ID=? AND DYE_BATCH_ID<>? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",roll,batch);
    const max=n(rr.INWARD_MTR)-n(other?.q);
    if(qty>max+0.0001)throw err('Issue exceeds available meter for roll '+(rr.VENDOR_ROLL_NO||roll)+'. Available: '+max,409);
    resolved.push({rr,qty});
  }

  const t=now();
  await db.prepare('DELETE FROM dye_jobs WHERE DYE_BATCH_ID=?').bind(batch).run();
  const stmts=resolved.map(({rr,qty})=>db.prepare(
    'INSERT INTO dye_jobs(ROW_ID,DYE_BATCH_ID,ISSUE_DATE,DYE_VENDOR_ID,ROLL_ID,VENDOR_ROLL_NO,FABRIC_ID,COLOR_ID,ISSUE_MTR,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT,DYE_PLAN_ID) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(uuid(),batch,issueDate,vendor,rr.ROLL_ID,rr.VENDOR_ROLL_NO||'',old.FABRIC_ID,color,qty,'AT DYE VENDOR',notes,a.userId,t,a.userId,t,old.DYE_PLAN_ID));
  if(r.EXPECTED_DATE!==undefined)stmts.push(expectationStmt(db,'DYE',batch,r.EXPECTED_DATE,a.userId,'Dye expected return'));
  await db.batch(stmts);
  const after=await getDyeBatchDetail(db,batch);
  await audit(db,a,'EDIT_DYE_BATCH','DYE',batch,JSON.stringify(old),JSON.stringify(after));
  return after
}
async function editDyeReceipt(db,r,a){
  const receiptId=String(r.RECEIPT_ID||''),receipt=await row(db,'SELECT * FROM dye_receipts WHERE RECEIPT_ID=?',receiptId);
  if(!receipt)throw err('Dye receipt not found.',404);
  if(await dyeDownstreamCount(db,receipt.DYE_BATCH_ID)>0)throw err('This dye batch is already used in Production. Direct receipt edit is blocked. Use a correction/reversal workflow.',409);

  const received=n(r.RECEIVED_MTR),defect=n(r.DEFECT_MTR),final=truth(r.FINAL_RECEIPT);
  requirePos(received,'Received meter');if(defect<0||defect>received)throw err('Defect meter must be between 0 and received meter.',409);
  const usable=received-defect,t=now();
  const other=await row(db,"SELECT COALESCE(SUM(RECEIVED_MTR),0) received FROM dye_receipts WHERE DYE_BATCH_ID=? AND RECEIPT_ID<>? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",receipt.DYE_BATCH_ID,receiptId);
  const issued=await row(db,"SELECT COALESCE(SUM(ISSUE_MTR),0) issued FROM dye_jobs WHERE DYE_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",receipt.DYE_BATCH_ID);
  const cumulative=n(other?.received)+received,variance=final?cumulative-n(issued?.issued):0;
  const status=final?(variance>0.0001?'CLOSED EXCESS':variance<-0.0001?'CLOSED SHORT':'CLOSED EXACT'):'PARTIAL';
  await db.prepare(`UPDATE dye_receipts SET RECEIPT_DATE=?,RECEIVED_MTR=?,DEFECT_MTR=?,USABLE_MTR=?,VARIANCE_MTR=?,FINAL_RECEIPT=?,STATUS=?,DEFECT_REASON=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE RECEIPT_ID=?`)
    .bind(dateOnly(r.RECEIPT_DATE||receipt.RECEIPT_DATE),received,defect,usable,variance,final?1:0,status,String(r.DEFECT_REASON||''),String(r.NOTES||''),a.userId,t,receiptId).run();
  const after=await row(db,'SELECT * FROM dye_receipts WHERE RECEIPT_ID=?',receiptId);
  await audit(db,a,'EDIT_DYE_RECEIPT','DYE',receiptId,JSON.stringify(receipt),JSON.stringify(after));
  return after
}
async function cancelDyeBatch(db,r,a){
  const batch=String(r.DYE_BATCH_ID||'');if(!batch)throw err('Dye batch is required.',400);
  if(await dyeDownstreamCount(db,batch)>0)throw err('This dye batch is already used in Production and cannot be cancelled directly.',409);
  const old=await getDyeBatchDetail(db,batch),reason=String(r.REASON||'Mistaken entry'),t=now();
  await db.batch([
    db.prepare("UPDATE dye_jobs SET STATUS='CANCELLED',NOTES=COALESCE(NOTES,'')||?,UPDATED_BY=?,UPDATED_AT=? WHERE DYE_BATCH_ID=?").bind(' | Cancelled: '+reason,a.userId,t,batch),
    db.prepare("UPDATE dye_receipts SET STATUS='CANCELLED',NOTES=COALESCE(NOTES,'')||?,UPDATED_BY=?,UPDATED_AT=? WHERE DYE_BATCH_ID=?").bind(' | Cancelled: '+reason,a.userId,t,batch),
    auditStmt(db,a,'CANCEL_DYE_BATCH','DYE',batch,JSON.stringify(old),JSON.stringify({cancelled:true,reason}))
  ]);
  return{DYE_BATCH_ID:batch,cancelled:true}
}

function auditStmt(db,u,action,module,id,oldV='',newV=''){
  return db.prepare('INSERT INTO audit_log(AUDIT_ID,TIMESTAMP,USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID,OLD_VALUE_JSON,NEW_VALUE_JSON,DEVICE_INFO,IP_HASH) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .bind(uuid(),now(),u.userId,u.name,action,module,id,String(oldV||''),String(newV||''),String(u?.auditMeta?.device||'').slice(0,300),String(u?.auditMeta?.ipHash||'').slice(0,100))
}
function expectationStmt(db,module,id,date,userId,note=''){
  return db.prepare(`INSERT INTO record_expectations(MODULE,RECORD_ID,EXPECTED_DATE,NOTE,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?)
    ON CONFLICT(MODULE,RECORD_ID) DO UPDATE SET EXPECTED_DATE=excluded.EXPECTED_DATE,NOTE=excluded.NOTE,UPDATED_BY=excluded.UPDATED_BY,UPDATED_AT=excluded.UPDATED_AT`)
    .bind(String(module||'').toUpperCase(),String(id||''),date?dateOnly(date):'',String(note||''),String(userId||''),now())
}
async function expectedDate(db,module,id){
  const r=await row(db,'SELECT EXPECTED_DATE FROM record_expectations WHERE MODULE=? AND RECORD_ID=?',String(module||'').toUpperCase(),String(id||''));
  return String(r?.EXPECTED_DATE||'')
}
async function getProductionDetail(db,id){
  const p=await row(db,`SELECT p.*,COALESCE(s.STYLE_NAME,p.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,p.COLOR_ID) COLOR
    FROM production_batches p LEFT JOIN styles s ON s.STYLE_ID=p.STYLE_ID LEFT JOIN colors c ON c.COLOR_ID=p.COLOR_ID
    WHERE p.PRODUCTION_BATCH_ID=?`,id);
  if(!p)throw err('Production batch not found.',404);
  const cut=await row(db,"SELECT * FROM production_cut_actuals WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);
  const lines=await cutLinesForPb(db,id),balances=await cutBalanceLines(db,id);
  const downstream=n((await row(db,"SELECT COUNT(*) c FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  return{...p,cut,cutLines:lines,sizeBalances:balances,downstreamCount:downstream}
}
async function getStitchingDetail(db,id){
  const s=await row(db,`SELECT x.*,COALESCE(v.VENDOR_NAME,x.STITCHING_VENDOR_ID) STITCHING_VENDOR,
    COALESCE(st.STYLE_NAME,x.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,x.COLOR_ID) COLOR
    FROM stitching_jobs x LEFT JOIN vendors v ON v.VENDOR_ID=x.STITCHING_VENDOR_ID
    LEFT JOIN styles st ON st.STYLE_ID=x.STYLE_ID LEFT JOIN colors c ON c.COLOR_ID=x.COLOR_ID WHERE x.CHALLAN_ID=?`,id);
  if(!s)throw err('Stitching challan not found.',404);
  const issueLines=await issueLinesForChallan(db,id),receivedLines=await receivedLinesForChallan(db,id),pendingLines=await stitchingPendingLines(db,id),qcPending=await qcPendingLines(db,id),sizeBalances=await cutBalanceLines(db,s.PRODUCTION_BATCH_ID);
  const receipts=await rows(db,"SELECT * FROM stitching_receipts WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' ORDER BY RECEIPT_DATE,RECEIPT_ID",id);
  const qcCount=n((await row(db,"SELECT COUNT(*) c FROM qc_events WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  return{...s,EXPECTED_DATE:await expectedDate(db,'STITCHING',id),issueLines,receivedLines,pendingLines,qcPendingLines:qcPending,sizeBalances,receipts,qcCount}
}
async function getQcDetail(db,id){
  const q=await row(db,'SELECT * FROM qc_events WHERE QC_ID=?',id);if(!q)throw err('QC entry not found.',404);
  const reworks=await rows(db,`SELECT r.*,e.EXPECTED_DATE,CASE WHEN e.EXPECTED_DATE<>'' AND r.ISSUE_QTY>r.RETURNED_QTY AND date(e.EXPECTED_DATE)<date('now') THEN CAST(julianday('now')-julianday(e.EXPECTED_DATE) AS INTEGER) ELSE 0 END OVERDUE_DAYS FROM rework_jobs r LEFT JOIN record_expectations e ON e.MODULE='REWORK' AND e.RECORD_ID=r.REWORK_ID WHERE r.QC_ID=? AND COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%' ORDER BY r.ISSUE_DATE,r.REWORK_ID`,id);
  const wh=n((await row(db,"SELECT COUNT(*) c FROM warehouse_handover WHERE PRODUCTION_BATCH_ID=? AND STYLE_ID=? AND COLOR_ID=? AND SIZE=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",q.PRODUCTION_BATCH_ID,q.STYLE_ID,q.COLOR_ID,q.SIZE))?.c);
  return{...q,reworks,warehouseDownstreamCount:wh}
}
async function getHandoverDetail(db,id){
  const h=await row(db,'SELECT * FROM warehouse_handover WHERE HANDOVER_ID=?',id);if(!h)throw err('Handover not found.',404);
  const receipts=await rows(db,"SELECT * FROM warehouse_receipts WHERE HANDOVER_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' ORDER BY RECEIPT_DATE,RECEIPT_ID",id);
  const extra=receipts.reduce((s,x)=>s+intQty(x.RECEIVED_QTY,'Received quantity'),0);
  return{...h,receipts,TOTAL_RECEIVED:intQty(h.WAREHOUSE_RECEIVED_QTY||0,'Received quantity')+extra,PENDING_QTY:Math.max(0,intQty(h.ACCEPTED_QTY,'Accepted quantity')-intQty(h.WAREHOUSE_RECEIVED_QTY||0,'Received quantity')-extra)}
}
async function saveProduction(db,r,a,req=''){
  const dyeBatch=String(r.DYE_BATCH_ID||''),styleId=String(r.STYLE_ID||''),planned=intQty(r.PLANNED_QTY,'Planned garment quantity'),allocated=n(r.ALLOCATED_MTR);
  if(!dyeBatch)throw err('Select a dye batch.',400);
  if(!styleId)throw err('Select a style.',400);
  requirePos(allocated,'Allocated meter');
  const style=await row(db,'SELECT * FROM styles WHERE STYLE_ID=? AND ACTIVE=1',styleId);if(!style)throw err('Select a valid active style.',400);
  const source=await row(db,"SELECT FABRIC_ID,COLOR_ID FROM dye_jobs WHERE DYE_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%' LIMIT 1",dyeBatch);if(!source)throw err('Selected dye batch was not found.',404);
  if(style.DEFAULT_FABRIC_ID&&String(style.DEFAULT_FABRIC_ID)!==String(source.FABRIC_ID))throw err('Selected style is mapped to a different fabric.',409);
  await acquireLock(db,'dye:'+dyeBatch,req);
  try{
    const available=await dyeBalance(db,dyeBatch);if(allocated>available+.0001)throw err('Allocated meter exceeds dyed usable balance. Available: '+available.toFixed(2)+' m.',409);
    const id=await nextId(db,'PB'),t=now(),planDate=dateOnly(r.PLAN_DATE),notes=String(r.NOTES||'');
    await db.batch([
      db.prepare('INSERT INTO production_batches(ROW_ID,PRODUCTION_BATCH_ID,PLAN_DATE,DYE_BATCH_ID,STYLE_ID,FABRIC_ID,COLOR_ID,PLANNED_QTY,ALLOCATED_MTR,CUT_DATE,CONSUMED_MTR,CUTTING_WASTE_MTR,DEFECT_MTR,M_CUT,L_CUT,XL_CUT,"2XL_CUT","3XL_CUT",OTHER_CUT,TOTAL_CUT,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uuid(),id,planDate,dyeBatch,styleId,source.FABRIC_ID,source.COLOR_ID,planned,allocated,'',0,0,0,0,0,0,0,0,0,0,'PLANNED',notes,a.userId,t,a.userId,t),
      auditStmt(db,a,'CREATE','PRODUCTION',id,'',JSON.stringify({PLAN_DATE:planDate,DYE_BATCH_ID:dyeBatch,STYLE_ID:styleId,FABRIC_ID:source.FABRIC_ID,COLOR_ID:source.COLOR_ID,PLANNED_QTY:planned,ALLOCATED_MTR:allocated,NOTES:notes}))
    ]);
    return{PRODUCTION_BATCH_ID:id}
  }finally{await releaseLock(db,'dye:'+dyeBatch)}
}
async function saveCuttingActual(db,r,a,req=''){
  const pb=String(r.PRODUCTION_BATCH_ID||''),p=await row(db,"SELECT * FROM production_batches WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",pb);
  if(!p)throw err('Invalid production batch.',400);
  const items=Array.isArray(r.items)?r.items:[],seen=new Set(),lines=[],totalCut=items.reduce((s,x)=>{
    const sid=String(x.SIZE_ID||'');if(!sid)throw err('Size is required for each cutting line.',400);
    if(seen.has(sid))throw err('Same size cannot appear twice.',409);seen.add(sid);
    const qty=intQty(x.QTY,'Cut quantity');if(qty>0)lines.push({SIZE_ID:sid,QTY:qty});return s+qty
  },0);
  if(totalCut<=0)throw err('Enter at least one cut piece.',400);
  for(const x of lines)if(!await row(db,'SELECT 1 ok FROM sizes WHERE SIZE_ID=? AND ACTIVE=1',x.SIZE_ID))throw err('Invalid active size '+x.SIZE_ID+'.',400);
  const consumed=n(r.CONSUMED_MTR),waste=n(r.WASTE_MTR),defect=n(r.DEFECT_MTR),unused=n(r.UNUSED_RETURN_MTR);
  if([consumed,waste,defect,unused].some(x=>x<0))throw err('Cutting meter values cannot be negative.',400);
  const accounted=consumed+waste+defect+unused;
  if(Math.abs(accounted-n(p.ALLOCATED_MTR))>0.011)throw err('Cutting meter reconciliation must equal allocated meter. Accounted '+accounted.toFixed(2)+' m vs allocated '+n(p.ALLOCATED_MTR).toFixed(2)+' m.',409);
  const existing=await row(db,'SELECT * FROM production_cut_actuals WHERE PRODUCTION_BATCH_ID=?',pb);
  const downstream=n((await row(db,"SELECT COUNT(*) c FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",pb))?.c);
  if(existing&&downstream)throw err('Cutting cannot be changed after stitching issue exists. Reverse downstream stitching first.',409);
  await acquireLock(db,'production:'+pb,req);
  try{
    const cutId=existing?.CUT_ID||await nextId(db,'CUT'),t=now(),stmts=[
      db.prepare(`INSERT INTO production_cut_actuals(CUT_ID,PRODUCTION_BATCH_ID,CUT_DATE,CONSUMED_MTR,WASTE_MTR,DEFECT_MTR,UNUSED_RETURN_MTR,FINAL_CUT,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(PRODUCTION_BATCH_ID) DO UPDATE SET CUT_DATE=excluded.CUT_DATE,CONSUMED_MTR=excluded.CONSUMED_MTR,WASTE_MTR=excluded.WASTE_MTR,DEFECT_MTR=excluded.DEFECT_MTR,UNUSED_RETURN_MTR=excluded.UNUSED_RETURN_MTR,FINAL_CUT=excluded.FINAL_CUT,STATUS=excluded.STATUS,NOTES=excluded.NOTES,UPDATED_BY=excluded.UPDATED_BY,UPDATED_AT=excluded.UPDATED_AT`)
        .bind(cutId,pb,dateOnly(r.CUT_DATE),consumed,waste,defect,unused,1,'CUT COMPLETE',String(r.NOTES||''),existing?.CREATED_BY||a.userId,existing?.CREATED_AT||t,a.userId,t),
      db.prepare('DELETE FROM production_cut_lines WHERE PRODUCTION_BATCH_ID=?').bind(pb),
      db.prepare('UPDATE production_batches SET CUT_DATE=?,CONSUMED_MTR=?,CUTTING_WASTE_MTR=?,DEFECT_MTR=?,TOTAL_CUT=?,STATUS=?,UPDATED_BY=?,UPDATED_AT=? WHERE PRODUCTION_BATCH_ID=?')
        .bind(dateOnly(r.CUT_DATE),consumed,waste,defect,totalCut,'CUT COMPLETE',a.userId,t,pb)
    ];
    for(const x of lines)stmts.push(db.prepare('INSERT INTO production_cut_lines(LINE_ID,PRODUCTION_BATCH_ID,SIZE_ID,QTY,CREATED_AT,UPDATED_AT) VALUES(?,?,?,?,?,?)').bind(uuid(),pb,x.SIZE_ID,x.QTY,t,t));
    for(const nm of ['M','L','XL','2XL','3XL','OTHER']){
      const size=await row(db,'SELECT SIZE_ID FROM sizes WHERE UPPER(SIZE_NAME)=? LIMIT 1',nm),qty=lines.find(x=>x.SIZE_ID===size?.SIZE_ID)?.QTY||0;
      stmts.push(db.prepare('UPDATE production_batches SET "'+nm+'_CUT"=? WHERE PRODUCTION_BATCH_ID=?').bind(qty,pb))
    }
    stmts.push(auditStmt(db,a,existing?'EDIT_CUTTING':'COMPLETE_CUTTING','PRODUCTION',pb,existing?JSON.stringify(existing):'',JSON.stringify({consumed,waste,defect,unused,totalCut,lines})));
    await db.batch(stmts);return await getProductionDetail(db,pb)
  }finally{await releaseLock(db,'production:'+pb)}
}
async function saveStitching(db,r,a,req=''){
  const pb=String(r.PRODUCTION_BATCH_ID||''),vendor=String(r.STITCHING_VENDOR_ID||'');
  if(!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1 AND STITCHING_VENDOR=1',vendor))throw err('Select a valid active Stitching Vendor.',400);
  const p=await row(db,"SELECT STYLE_ID,COLOR_ID FROM production_batches WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",pb);if(!p)throw err('Invalid production batch.',400);
  let items=Array.isArray(r.items)?r.items:[];
  if(!items.length){
    const sizes=await activeSizeRows(db);items=sizes.map(s=>({SIZE_ID:s.SIZE_ID,QTY:r[(legacySizeName(s.SIZE_NAME)||'')+'_ISSUED']||0}))
  }
  const balances=await cutBalanceLines(db,pb),bal=Object.fromEntries(balances.map(x=>[x.SIZE_ID,x.BALANCE_QTY])),lines=[],seen=new Set();
  for(const x of items){
    const sid=String(x.SIZE_ID||'');if(!sid)continue;if(seen.has(sid))throw err('Same size cannot appear twice.',409);seen.add(sid);
    const qty=intQty(x.QTY,'Issue quantity');if(qty>(bal[sid]||0))throw err('Issue exceeds cut-piece balance for selected size. Available: '+(bal[sid]||0),409);
    if(qty>0)lines.push({SIZE_ID:sid,QTY:qty})
  }
  const total=lines.reduce((s,x)=>s+x.QTY,0);if(total<=0)throw err('Total stitching issue quantity must be greater than 0.',400);
  await acquireLock(db,'production:'+pb,req);
  try{
    const fresh=await cutBalanceLines(db,pb),freshBal=Object.fromEntries(fresh.map(x=>[x.SIZE_ID,x.BALANCE_QTY]));
    for(const x of lines)if(x.QTY>(freshBal[x.SIZE_ID]||0))throw err('Cut stock changed while saving. Refresh and retry.',409);
    const id=await nextId(db,'STC'),t=now(),legacy={M:0,L:0,XL:0,'2XL':0,'3XL':0,OTHER:0};
    for(const x of lines){const sr=await sizeMasterRow(db,x.SIZE_ID),nm=legacySizeName(sr?.SIZE_NAME||x.SIZE_ID);if(nm)legacy[nm]+=x.QTY}
    const stmts=[
      db.prepare('INSERT INTO stitching_jobs(ROW_ID,CHALLAN_ID,ISSUE_DATE,STITCHING_VENDOR_ID,PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,M_ISSUED,L_ISSUED,XL_ISSUED,"2XL_ISSUED","3XL_ISSUED",OTHER_ISSUED,M_RECEIVED,L_RECEIVED,XL_RECEIVED,"2XL_RECEIVED","3XL_RECEIVED",OTHER_RECEIVED,TOTAL_ISSUED,TOTAL_RECEIVED,PENDING_QTY,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(uuid(),id,dateOnly(r.ISSUE_DATE),vendor,pb,p.STYLE_ID,p.COLOR_ID,legacy.M,legacy.L,legacy.XL,legacy['2XL'],legacy['3XL'],legacy.OTHER,0,0,0,0,0,0,total,0,total,'PENDING FROM VENDOR',String(r.NOTES||''),a.userId,t,a.userId,t)
    ];
    for(const x of lines)stmts.push(db.prepare('INSERT INTO stitching_issue_lines(LINE_ID,CHALLAN_ID,SIZE_ID,QTY,CREATED_AT,UPDATED_AT) VALUES(?,?,?,?,?,?)').bind(uuid(),id,x.SIZE_ID,x.QTY,t,t));
    if(r.EXPECTED_DATE)stmts.push(expectationStmt(db,'STITCHING',id,r.EXPECTED_DATE,a.userId,'Vendor expected return'));stmts.push(auditStmt(db,a,'CREATE','STITCHING',id,'',JSON.stringify({pb,vendor,lines,total,expectedDate:String(r.EXPECTED_DATE||'')})));
    await db.batch(stmts);return{CHALLAN_ID:id}
  }finally{await releaseLock(db,'production:'+pb)}
}
async function saveQc(db,r,a,req=''){
  const challan=String(r.CHALLAN_ID||''),sizeKey=String(r.SIZE||''),q=intQty(r.QC_QTY,'QC quantity',false),pass=intQty(r.PASS_QTY,'Pass quantity'),rw=intQty(r.REWORK_QTY,'Rework quantity'),rej=intQty(r.REJECT_QTY,'Reject quantity');
  if(pass+rw+rej!==q)throw err('Pass + Rework + Reject must exactly equal QC Qty.',409);
  const st=await row(db,"SELECT * FROM stitching_jobs WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",challan);if(!st)throw err('Invalid stitching challan.',400);
  const sr=await sizeMasterRow(db,sizeKey),sid=sr?.SIZE_ID||sizeKey,sname=sr?.SIZE_NAME||sizeKey;if(!sid)throw err('Size is required.',400);
  await acquireLock(db,'stitching:'+challan,req);
  try{
    const pending=(await qcPendingLines(db,challan)).find(x=>x.SIZE_ID===sid||String(x.SIZE_NAME).toUpperCase()===String(sname).toUpperCase())?.PENDING_QTY||0;
    if(q>pending)throw err('QC quantity exceeds '+sname+' quantity pending QC. Available: '+pending,409);
    const id=await nextId(db,'QC'),t=now();
    await db.batch([
      db.prepare('INSERT INTO qc_events(QC_ID,QC_DATE,CHALLAN_ID,PRODUCTION_BATCH_ID,VENDOR_ID,STYLE_ID,COLOR_ID,SIZE,QC_QTY,PASS_QTY,REWORK_QTY,REJECT_QTY,SHORT_QTY,DEFECT_REASON,REWORK_CHALLAN_ID,REWORK_RETURNED_QTY,FINAL_ACCEPTED_QTY,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id,dateOnly(r.QC_DATE),challan,st.PRODUCTION_BATCH_ID,st.STITCHING_VENDOR_ID,st.STYLE_ID,st.COLOR_ID,sid,q,pass,rw,rej,0,String(r.DEFECT_REASON||''),'',0,pass,'QC COMPLETE',String(r.NOTES||''),a.userId,t,a.userId,t),
      auditStmt(db,a,'CREATE','QC',id,'',JSON.stringify({challan,size:sid,q,pass,rw,rej}))
    ]);return{QC_ID:id}
  }finally{await releaseLock(db,'stitching:'+challan)}
}
async function saveHandover(db,r,a,req=''){
  const pb=String(r.PRODUCTION_BATCH_ID||''),style=String(r.STYLE_ID||''),color=String(r.COLOR_ID||''),size=String(r.SIZE||''),accepted=intQty(r.ACCEPTED_QTY,'Accepted quantity',false),received=intQty(r.WAREHOUSE_RECEIVED_QTY||0,'Warehouse received quantity');
  if(received>accepted)throw err('Warehouse received quantity cannot exceed handover quantity.',409);
  await acquireLock(db,'warehouse-ready:'+pb+':'+style+':'+color+':'+size,req);
  try{
    const ready=(await warehouseReady(db)).find(x=>String(x.PRODUCTION_BATCH_ID)===pb&&String(x.STYLE_ID)===style&&String(x.COLOR_ID)===color&&String(x.SIZE)===size);
    if(!ready||accepted>intQty(ready.PENDING_QTY,'Available quantity'))throw err('Handover quantity exceeds QC-passed quantity available.',409);
    const pending=accepted-received,id=await nextId(db,'WH'),t=now(),status=pending?'PARTIAL':'RECEIVED';
    await db.batch([
      db.prepare('INSERT INTO warehouse_handover(HANDOVER_ID,HANDOVER_DATE,PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE,ACCEPTED_QTY,WAREHOUSE_RECEIVED_QTY,PENDING_QTY,WAREHOUSE_REF,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id,dateOnly(r.HANDOVER_DATE),pb,style,color,size,accepted,received,pending,String(r.WAREHOUSE_REF||''),status,String(r.NOTES||''),a.userId,t,a.userId,t),
      auditStmt(db,a,'CREATE','HANDOVER',id,'',JSON.stringify({pb,style,color,size,accepted,received,pending}))
    ]);return{HANDOVER_ID:id}
  }finally{await releaseLock(db,'warehouse-ready:'+pb+':'+style+':'+color+':'+size)}
}

async function editProduction(db,r,a,req=''){
  const id=String(r.PRODUCTION_BATCH_ID||''),old=await row(db,"SELECT * FROM production_batches WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);
  if(!old)throw err('Production batch not found.',404);
  const cut=await row(db,"SELECT 1 ok FROM production_cut_actuals WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);
  const stitch=n((await row(db,"SELECT COUNT(*) c FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  const newAlloc=n(r.ALLOCATED_MTR??old.ALLOCATED_MTR),newStyle=String(r.STYLE_ID??old.STYLE_ID),newBatch=String(r.DYE_BATCH_ID??old.DYE_BATCH_ID),newDate=dateOnly(r.PLAN_DATE||old.PLAN_DATE),planned=intQty(r.PLANNED_QTY??old.PLANNED_QTY,'Planned garment quantity');let source={FABRIC_ID:old.FABRIC_ID,COLOR_ID:old.COLOR_ID};
  if(cut||stitch){
    if(Math.abs(newAlloc-n(old.ALLOCATED_MTR))>.0001||newStyle!==String(old.STYLE_ID)||newBatch!==String(old.DYE_BATCH_ID))throw err('Source batch, style and allocated meter are locked after cutting/stitching starts.',409)
  }else{
    requirePos(newAlloc,'Allocated meter');
    const st=await row(db,'SELECT * FROM styles WHERE STYLE_ID=? AND ACTIVE=1',newStyle);if(!st)throw err('Select a valid active style.',400);
    source=await row(db,'SELECT FABRIC_ID,COLOR_ID FROM dye_jobs WHERE DYE_BATCH_ID=? AND COALESCE(STATUS,\'\') NOT LIKE \'CANCELLED%\' LIMIT 1',newBatch);if(!source)throw err('Select a valid dye batch.',400);
    if(st.DEFAULT_FABRIC_ID&&String(st.DEFAULT_FABRIC_ID)!==String(source.FABRIC_ID))throw err('Selected style is mapped to a different fabric.',409);
    const available=await dyeBalance(db,newBatch)+(newBatch===String(old.DYE_BATCH_ID)?n(old.ALLOCATED_MTR):0);
    if(newAlloc>available+.0001)throw err('Allocated meter exceeds dyed usable balance. Available: '+available.toFixed(2),409)
  }
  await acquireLock(db,'production:'+id,req);
  try{
    const t=now();
    await db.batch([
      db.prepare('UPDATE production_batches SET PLAN_DATE=?,DYE_BATCH_ID=?,STYLE_ID=?,FABRIC_ID=?,COLOR_ID=?,PLANNED_QTY=?,ALLOCATED_MTR=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE PRODUCTION_BATCH_ID=?')
        .bind(newDate,newBatch,newStyle,source.FABRIC_ID,source.COLOR_ID,planned,newAlloc,String(r.NOTES??old.NOTES??''),a.userId,t,id),
      auditStmt(db,a,'EDIT_PRODUCTION','PRODUCTION',id,JSON.stringify(old),JSON.stringify({PLAN_DATE:newDate,DYE_BATCH_ID:newBatch,STYLE_ID:newStyle,FABRIC_ID:source.FABRIC_ID,COLOR_ID:source.COLOR_ID,PLANNED_QTY:planned,ALLOCATED_MTR:newAlloc,NOTES:String(r.NOTES??old.NOTES??'')}))
    ]);
    return await getProductionDetail(db,id)
  }finally{await releaseLock(db,'production:'+id)}
}

async function editStitching(db,r,a,req=''){
  const id=String(r.CHALLAN_ID||''),old=await row(db,"SELECT * FROM stitching_jobs WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);
  if(!old)throw err('Stitching challan not found.',404);
  const receipts=n((await row(db,"SELECT COUNT(*) c FROM stitching_receipts WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  const qc=n((await row(db,"SELECT COUNT(*) c FROM qc_events WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  if(receipts||qc)throw err('Issue quantities/vendor are locked after receipt or QC. Reverse downstream first.',409);
  const vendor=String(r.STITCHING_VENDOR_ID??old.STITCHING_VENDOR_ID);
  if(!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1 AND STITCHING_VENDOR=1',vendor))throw err('Select a valid active Stitching Vendor.',400);
  let items=Array.isArray(r.items)?r.items:await issueLinesForChallan(db,id),lines=[],seen=new Set();
  const base=await cutBalanceLines(db,old.PRODUCTION_BATCH_ID),current=await issueLinesForChallan(db,id);
  const available=Object.fromEntries(base.map(x=>[x.SIZE_ID,x.BALANCE_QTY]));
  for(const x of current)available[x.SIZE_ID]=(available[x.SIZE_ID]||0)+x.QTY;
  for(const x of items){
    const sid=String(x.SIZE_ID||'');if(!sid)continue;if(seen.has(sid))throw err('Same size cannot appear twice.',409);seen.add(sid);
    const qty=intQty(x.QTY,'Issue quantity');if(qty>(available[sid]||0))throw err('Issue exceeds available cut stock for size '+sid+'. Available: '+(available[sid]||0),409);
    if(qty>0)lines.push({SIZE_ID:sid,QTY:qty})
  }
  const total=lines.reduce((s,x)=>s+x.QTY,0);if(total<=0)throw err('Total stitching issue must be greater than 0.',400);
  await acquireLock(db,'production:'+old.PRODUCTION_BATCH_ID,req);
  try{
    const t=now(),legacy={M:0,L:0,XL:0,'2XL':0,'3XL':0,OTHER:0};
    for(const x of lines){const sr=await sizeMasterRow(db,x.SIZE_ID),nm=legacySizeName(sr?.SIZE_NAME||x.SIZE_ID);if(nm)legacy[nm]+=x.QTY}
    const stmts=[
      db.prepare('UPDATE stitching_jobs SET ISSUE_DATE=?,STITCHING_VENDOR_ID=?,M_ISSUED=?,L_ISSUED=?,XL_ISSUED=?,"2XL_ISSUED"=?,"3XL_ISSUED"=?,OTHER_ISSUED=?,TOTAL_ISSUED=?,PENDING_QTY=?,STATUS=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE CHALLAN_ID=?')
        .bind(dateOnly(r.ISSUE_DATE||old.ISSUE_DATE),vendor,legacy.M,legacy.L,legacy.XL,legacy['2XL'],legacy['3XL'],legacy.OTHER,total,total,'PENDING FROM VENDOR',String(r.NOTES??old.NOTES??''),a.userId,t,id),
      db.prepare('DELETE FROM stitching_issue_lines WHERE CHALLAN_ID=?').bind(id)
    ];
    for(const x of lines)stmts.push(db.prepare('INSERT INTO stitching_issue_lines(LINE_ID,CHALLAN_ID,SIZE_ID,QTY,CREATED_AT,UPDATED_AT) VALUES(?,?,?,?,?,?)').bind(uuid(),id,x.SIZE_ID,x.QTY,t,t));
    stmts.push(expectationStmt(db,'STITCHING',id,r.EXPECTED_DATE??await expectedDate(db,'STITCHING',id),a.userId,'Vendor expected return'));stmts.push(auditStmt(db,a,'EDIT_STITCHING','STITCHING',id,JSON.stringify(old),JSON.stringify({vendor,total,lines,expectedDate:String(r.EXPECTED_DATE||'')})));
    await db.batch(stmts);return await getStitchingDetail(db,id)
  }finally{await releaseLock(db,'production:'+old.PRODUCTION_BATCH_ID)}
}

async function refreshStitchingHeader(db,challan,a){
  const st=await row(db,'SELECT * FROM stitching_jobs WHERE CHALLAN_ID=?',challan);if(!st)return;
  const received=await receivedLinesForChallan(db,challan),total=received.reduce((s,x)=>s+x.QTY,0),issued=(await issueLinesForChallan(db,challan)).reduce((s,x)=>s+x.QTY,0),pending=Math.max(0,issued-total),legacy={M:0,L:0,XL:0,'2XL':0,'3XL':0,OTHER:0};
  for(const x of received){const nm=legacySizeName(x.SIZE_NAME||x.SIZE_ID);if(nm)legacy[nm]+=x.QTY}
  const nextStatus=pending>0?'PARTIAL RECEIVED':'RECEIVED COMPLETE';assertTransition('stitching',st.STATUS,nextStatus);
  await db.prepare('UPDATE stitching_jobs SET M_RECEIVED=?,L_RECEIVED=?,XL_RECEIVED=?,"2XL_RECEIVED"=?,"3XL_RECEIVED"=?,OTHER_RECEIVED=?,TOTAL_RECEIVED=?,PENDING_QTY=?,STATUS=?,UPDATED_BY=?,UPDATED_AT=? WHERE CHALLAN_ID=?')
    .bind(legacy.M,legacy.L,legacy.XL,legacy['2XL'],legacy['3XL'],legacy.OTHER,total,pending,nextStatus,a.userId,now(),challan).run()
}
async function saveStitchingReceipt(db,r,a,req=''){
  const challan=String(r.CHALLAN_ID||''),st=await row(db,"SELECT * FROM stitching_jobs WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",challan);if(!st)throw err('Invalid stitching challan.',400);
  const pending=await stitchingPendingLines(db,challan),bal=Object.fromEntries(pending.map(x=>[x.SIZE_ID,x.PENDING_QTY])),items=Array.isArray(r.items)?r.items:[],lines=[],seen=new Set();
  for(const x of items){const sid=String(x.SIZE_ID||'');if(!sid)continue;if(seen.has(sid))throw err('Same size cannot appear twice.',409);seen.add(sid);const qty=intQty(x.QTY,'Receipt quantity');if(qty>(bal[sid]||0))throw err('Receipt exceeds pending quantity for selected size. Pending: '+(bal[sid]||0),409);if(qty>0)lines.push({SIZE_ID:sid,QTY:qty})}
  const total=lines.reduce((s,x)=>s+x.QTY,0);if(total<=0)throw err('Enter at least one received piece.',400);
  await acquireLock(db,'stitching:'+challan,req);
  try{
    const fresh=await stitchingPendingLines(db,challan),fb=Object.fromEntries(fresh.map(x=>[x.SIZE_ID,x.PENDING_QTY]));for(const x of lines)if(x.QTY>(fb[x.SIZE_ID]||0))throw err('Pending quantity changed. Refresh and retry.',409);
    const id=await nextId(db,'SR'),t=now(),stmts=[db.prepare('INSERT INTO stitching_receipts(RECEIPT_ID,CHALLAN_ID,RECEIPT_DATE,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,challan,dateOnly(r.RECEIPT_DATE),'RECEIVED',String(r.NOTES||''),a.userId,t,a.userId,t)];
    for(const x of lines)stmts.push(db.prepare('INSERT INTO stitching_receipt_lines(LINE_ID,RECEIPT_ID,CHALLAN_ID,SIZE_ID,QTY,CREATED_AT,UPDATED_AT) VALUES(?,?,?,?,?,?,?)').bind(uuid(),id,challan,x.SIZE_ID,x.QTY,t,t));
    stmts.push(auditStmt(db,a,'STITCHING_RECEIVE','STITCHING',challan,'',JSON.stringify({receiptId:id,lines,total})));
    await db.batch(stmts);await refreshStitchingHeader(db,challan,a);return await getStitchingDetail(db,challan)
  }finally{await releaseLock(db,'stitching:'+challan)}
}
async function cancelStitchingReceipt(db,r,a){
  const id=String(r.RECEIPT_ID||''),rec=await row(db,"SELECT * FROM stitching_receipts WHERE RECEIPT_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);if(!rec)throw err('Stitching receipt not found.',404);
  const qc=n((await row(db,"SELECT COUNT(*) c FROM qc_events WHERE CHALLAN_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",rec.CHALLAN_ID))?.c);if(qc)throw err('Receipt cannot be cancelled after QC exists on this challan. Reverse QC first.',409);
  const reason=String(r.REASON||'Mistaken entry'),t=now();
  await db.batch([
    db.prepare("UPDATE stitching_receipts SET STATUS='CANCELLED',NOTES=COALESCE(NOTES,'')||?,UPDATED_BY=?,UPDATED_AT=? WHERE RECEIPT_ID=?").bind(' | Cancelled: '+reason,a.userId,t,id),
    auditStmt(db,a,'CANCEL_STITCH_RECEIPT','STITCHING',id,JSON.stringify(rec),JSON.stringify({cancelled:true,reason}))
  ]);
  await refreshStitchingHeader(db,rec.CHALLAN_ID,a);return{RECEIPT_ID:id,cancelled:true}
}

async function editQc(db,r,a){
  const id=String(r.QC_ID||''),old=await row(db,"SELECT * FROM qc_events WHERE QC_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);if(!old)throw err('QC entry not found.',404);
  const rw=n((await row(db,"SELECT COUNT(*) c FROM rework_jobs WHERE QC_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c),wh=n((await row(db,"SELECT COUNT(*) c FROM warehouse_handover WHERE PRODUCTION_BATCH_ID=? AND STYLE_ID=? AND COLOR_ID=? AND SIZE=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",old.PRODUCTION_BATCH_ID,old.STYLE_ID,old.COLOR_ID,old.SIZE))?.c);
  if(rw||wh)throw err('QC quantities are locked after rework or warehouse handover starts.',409);
  const q=intQty(r.QC_QTY??old.QC_QTY,'QC quantity',false),pass=intQty(r.PASS_QTY??old.PASS_QTY,'Pass quantity'),rework=intQty(r.REWORK_QTY??old.REWORK_QTY,'Rework quantity'),reject=intQty(r.REJECT_QTY??old.REJECT_QTY,'Reject quantity');
  if(pass+rework+reject!==q)throw err('Pass + Rework + Reject must exactly equal QC Qty.',409);
  const pending=(await qcPendingLines(db,old.CHALLAN_ID)).find(x=>x.SIZE_ID===old.SIZE||String(x.SIZE_NAME).toUpperCase()===String(old.SIZE).toUpperCase())?.PENDING_QTY||0;
  if(q>pending+intQty(old.QC_QTY,'Existing QC qty'))throw err('QC quantity exceeds received quantity available for this size.',409);
  const t=now();await db.batch([
    db.prepare('UPDATE qc_events SET QC_DATE=?,QC_QTY=?,PASS_QTY=?,REWORK_QTY=?,REJECT_QTY=?,FINAL_ACCEPTED_QTY=?,DEFECT_REASON=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE QC_ID=?')
      .bind(dateOnly(r.QC_DATE||old.QC_DATE),q,pass,rework,reject,pass,String(r.DEFECT_REASON??old.DEFECT_REASON??''),String(r.NOTES??old.NOTES??''),a.userId,t,id),
    auditStmt(db,a,'EDIT_QC','QC',id,JSON.stringify(old),JSON.stringify({q,pass,rework,reject}))
  ]);return await getQcDetail(db,id)
}
async function saveReworkIssue(db,r,a,req=''){
  const qcId=String(r.QC_ID||''),q=await row(db,"SELECT * FROM qc_events WHERE QC_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",qcId);if(!q)throw err('QC entry not found.',404);
  const issued=n((await row(db,"SELECT COALESCE(SUM(ISSUE_QTY),0) q FROM rework_jobs WHERE QC_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",qcId))?.q),available=intQty(q.REWORK_QTY,'QC rework qty')-Math.round(issued),qty=intQty(r.ISSUE_QTY,'Rework issue quantity',false);
  if(qty>available)throw err('Rework issue exceeds available rework quantity. Available: '+available,409);
  const vendor=String(r.VENDOR_ID||q.VENDOR_ID||'');if(vendor&&!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1',vendor))throw err('Invalid active rework vendor.',400);
  await acquireLock(db,'qc:'+qcId,req);
  try{
    const id=await nextId(db,'RW'),t=now();
    await db.batch([
      db.prepare('INSERT INTO rework_jobs(REWORK_ID,QC_ID,CHALLAN_ID,PRODUCTION_BATCH_ID,VENDOR_ID,SIZE_ID,ISSUE_DATE,ISSUE_QTY,RETURNED_QTY,PASS_QTY,REJECT_QTY,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id,qcId,q.CHALLAN_ID,q.PRODUCTION_BATCH_ID,vendor,q.SIZE,dateOnly(r.ISSUE_DATE),qty,0,0,0,'AT REWORK',String(r.NOTES||''),a.userId,t,a.userId,t),
      ...(r.EXPECTED_DATE?[expectationStmt(db,'REWORK',id,r.EXPECTED_DATE,a.userId,'Rework expected return')]:[]),
      auditStmt(db,a,'REWORK_ISSUE','QC',id,'',JSON.stringify({qcId,qty,vendor,expectedDate:String(r.EXPECTED_DATE||'')}))
    ]);return{REWORK_ID:id}
  }finally{await releaseLock(db,'qc:'+qcId)}
}
async function refreshQcReworkStatus(db,qcId,a){
  const q=await row(db,'SELECT * FROM qc_events WHERE QC_ID=?',qcId);if(!q)return;
  const s=await row(db,`SELECT COALESCE(SUM(ISSUE_QTY),0) issued,COALESCE(SUM(RETURNED_QTY),0) returned
    FROM rework_jobs WHERE QC_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'`,qcId);
  const issued=intQty(s?.issued||0,'Rework issued'),returned=intQty(s?.returned||0,'Rework returned'),pending=Math.max(0,issued-returned);
  const status=pending>0?(returned>0?'REWORK PARTIAL':'REWORK PENDING'):'QC COMPLETE';
  await db.prepare('UPDATE qc_events SET STATUS=?,UPDATED_BY=?,UPDATED_AT=? WHERE QC_ID=?').bind(status,a.userId,now(),qcId).run()
}
async function saveReworkReceive(db,r,a,req=''){
  const id=String(r.REWORK_ID||''),rw=await row(db,"SELECT * FROM rework_jobs WHERE REWORK_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);if(!rw)throw err('Rework job not found.',404);
  const ret=intQty(r.RETURN_QTY,'Rework return quantity',false),pass=intQty(r.PASS_QTY,'Rework pass quantity'),reject=intQty(r.REJECT_QTY,'Rework reject quantity');if(pass+reject!==ret)throw err('Rework pass + reject must equal returned qty.',409);
  const remaining=intQty(rw.ISSUE_QTY,'Issue quantity')-intQty(rw.RETURNED_QTY,'Returned quantity');if(ret>remaining)throw err('Return exceeds rework pending quantity. Pending: '+remaining,409);
  await acquireLock(db,'qc:'+rw.QC_ID,req);
  try{
    const q=await row(db,'SELECT * FROM qc_events WHERE QC_ID=?',rw.QC_ID);if(!q)throw err('Source QC not found.',409);
    const newReturned=intQty(rw.RETURNED_QTY,'Returned quantity')+ret,newPass=intQty(rw.PASS_QTY,'Pass quantity')+pass,newReject=intQty(rw.REJECT_QTY,'Reject quantity')+reject,status=newReturned>=intQty(rw.ISSUE_QTY,'Issue quantity')?'REWORK CLOSED':'PARTIAL REWORK RETURN',t=now();assertTransition('rework',rw.STATUS,status);
    await db.batch([
      db.prepare('UPDATE rework_jobs SET RETURNED_QTY=?,PASS_QTY=?,REJECT_QTY=?,STATUS=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE REWORK_ID=?').bind(newReturned,newPass,newReject,status,String(r.NOTES??rw.NOTES??''),a.userId,t,id),
      db.prepare('UPDATE qc_events SET REWORK_RETURNED_QTY=COALESCE(REWORK_RETURNED_QTY,0)+?,FINAL_ACCEPTED_QTY=COALESCE(FINAL_ACCEPTED_QTY,0)+?,UPDATED_BY=?,UPDATED_AT=? WHERE QC_ID=?').bind(ret,pass,a.userId,t,rw.QC_ID),
      auditStmt(db,a,'REWORK_RECEIVE','QC',id,JSON.stringify(rw),JSON.stringify({returnQty:ret,pass,reject,status}))
    ]);
    await refreshQcReworkStatus(db,rw.QC_ID,a);
    return await getQcDetail(db,rw.QC_ID)
  }finally{await releaseLock(db,'qc:'+rw.QC_ID)}
}
async function cancelRework(db,r,a){
  const id=String(r.REWORK_ID||''),rw=await row(db,"SELECT * FROM rework_jobs WHERE REWORK_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);if(!rw)throw err('Rework job not found.',404);
  if(intQty(rw.RETURNED_QTY,'Returned quantity')>0)throw err('Rework cannot be cancelled after return is received. Correct downstream QC instead.',409);
  const reason=String(r.REASON||'Mistaken entry'),t=now();
  await db.batch([
    db.prepare("UPDATE rework_jobs SET STATUS='CANCELLED',NOTES=COALESCE(NOTES,'')||?,UPDATED_BY=?,UPDATED_AT=? WHERE REWORK_ID=?").bind(' | Cancelled: '+reason,a.userId,t,id),
    auditStmt(db,a,'CANCEL_REWORK','QC',id,JSON.stringify(rw),JSON.stringify({cancelled:true,reason}))
  ]);
  await refreshQcReworkStatus(db,rw.QC_ID,a);
  return{REWORK_ID:id,cancelled:true}
}

async function editHandover(db,r,a){
  const id=String(r.HANDOVER_ID||''),old=await row(db,"SELECT * FROM warehouse_handover WHERE HANDOVER_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);if(!old)throw err('Handover not found.',404);
  const extra=n((await row(db,"SELECT COUNT(*) c FROM warehouse_receipts WHERE HANDOVER_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id))?.c);
  const accepted=intQty(r.ACCEPTED_QTY??old.ACCEPTED_QTY,'Handover quantity',false),received=intQty(r.WAREHOUSE_RECEIVED_QTY??old.WAREHOUSE_RECEIVED_QTY,'Warehouse received quantity');
  if(received>accepted)throw err('Warehouse received cannot exceed handover qty.',409);
  if(extra&&(accepted!==intQty(old.ACCEPTED_QTY)||received!==intQty(old.WAREHOUSE_RECEIVED_QTY)))throw err('Quantities are locked after additional warehouse receipts. Only date/reference/notes can be edited.',409);
  if(!extra){
    const ready=(await warehouseReady(db)).find(x=>String(x.PRODUCTION_BATCH_ID)===String(old.PRODUCTION_BATCH_ID)&&String(x.STYLE_ID)===String(old.STYLE_ID)&&String(x.COLOR_ID)===String(old.COLOR_ID)&&String(x.SIZE)===String(old.SIZE));
    const max=intQty(old.ACCEPTED_QTY,'Current handover')+intQty(ready?.PENDING_QTY||0,'Available quantity');if(accepted>max)throw err('Handover qty exceeds QC-passed availability.',409)
  }
  const pending=Math.max(0,accepted-received),t=now();await db.batch([
    db.prepare('UPDATE warehouse_handover SET HANDOVER_DATE=?,ACCEPTED_QTY=?,WAREHOUSE_RECEIVED_QTY=?,PENDING_QTY=?,WAREHOUSE_REF=?,STATUS=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE HANDOVER_ID=?')
      .bind(dateOnly(r.HANDOVER_DATE||old.HANDOVER_DATE),accepted,received,pending,String(r.WAREHOUSE_REF??old.WAREHOUSE_REF??''),pending?'PARTIAL':'RECEIVED',String(r.NOTES??old.NOTES??''),a.userId,t,id),
    auditStmt(db,a,'EDIT_HANDOVER','HANDOVER',id,JSON.stringify(old),JSON.stringify({accepted,received,pending}))
  ]);return await getHandoverDetail(db,id)
}
async function saveWarehouseReceipt(db,r,a,req=''){
  const id=String(r.HANDOVER_ID||''),h=await getHandoverDetail(db,id),qty=intQty(r.RECEIVED_QTY,'Warehouse receipt quantity',false);if(qty>intQty(h.PENDING_QTY,'Pending quantity'))throw err('Receipt exceeds pending warehouse quantity. Pending: '+h.PENDING_QTY,409);
  await acquireLock(db,'handover:'+id,req);
  try{
    const fresh=await getHandoverDetail(db,id);if(qty>intQty(fresh.PENDING_QTY,'Pending quantity'))throw err('Warehouse pending quantity changed. Refresh and retry.',409);
    const rid=await nextId(db,'WR'),t=now(),newPending=intQty(fresh.PENDING_QTY)-qty;
    await db.batch([
      db.prepare('INSERT INTO warehouse_receipts(RECEIPT_ID,HANDOVER_ID,RECEIPT_DATE,RECEIVED_QTY,WAREHOUSE_REF,NOTES,STATUS,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(rid,id,dateOnly(r.RECEIPT_DATE),qty,String(r.WAREHOUSE_REF||''),String(r.NOTES||''),'RECEIVED',a.userId,t,a.userId,t),
      db.prepare('UPDATE warehouse_handover SET PENDING_QTY=?,STATUS=?,UPDATED_BY=?,UPDATED_AT=? WHERE HANDOVER_ID=?').bind(newPending,newPending?'PARTIAL':'RECEIVED',a.userId,t,id),
      auditStmt(db,a,'WAREHOUSE_RECEIVE','HANDOVER',id,'',JSON.stringify({receiptId:rid,qty}))
    ]);return await getHandoverDetail(db,id)
  }finally{await releaseLock(db,'handover:'+id)}
}
async function cancelWarehouseReceipt(db,r,a){
  const id=String(r.RECEIPT_ID||''),rec=await row(db,"SELECT * FROM warehouse_receipts WHERE RECEIPT_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",id);if(!rec)throw err('Warehouse receipt not found.',404);
  const reason=String(r.REASON||'Mistaken entry'),t=now();
  await db.batch([
    db.prepare("UPDATE warehouse_receipts SET STATUS='CANCELLED',NOTES=COALESCE(NOTES,'')||?,UPDATED_BY=?,UPDATED_AT=? WHERE RECEIPT_ID=?").bind(' | Cancelled: '+reason,a.userId,t,id),
    auditStmt(db,a,'CANCEL_WAREHOUSE_RECEIPT','HANDOVER',id,JSON.stringify(rec),JSON.stringify({cancelled:true,reason}))
  ]);
  const h=await getHandoverDetail(db,rec.HANDOVER_ID);await db.prepare('UPDATE warehouse_handover SET PENDING_QTY=?,STATUS=?,UPDATED_BY=?,UPDATED_AT=? WHERE HANDOVER_ID=?').bind(h.PENDING_QTY,h.PENDING_QTY?'PARTIAL':'RECEIVED',a.userId,now(),rec.HANDOVER_ID).run();return{RECEIPT_ID:id,cancelled:true}
}

async function reserveRequest(db,id,module){
  if(!id)return{owner:true};
  const ins=await db.prepare("INSERT OR IGNORE INTO request_log(request_id,module,result_json,created_at) VALUES(?,?,?,?)").bind(id,module,'__PENDING__',now()).run();
  if((ins.meta?.changes||0)>0)return{owner:true};
  for(let i=0;i<6;i++){const x=await row(db,'SELECT result_json FROM request_log WHERE request_id=?',id);if(x&&x.result_json!=='__PENDING__')return{owner:false,result:JSON.parse(x.result_json)};await new Promise(r=>setTimeout(r,80))}
  throw err('This transaction is already processing. Please wait.',409)
}
async function completeRequest(db,id,result){if(id)await db.prepare('UPDATE request_log SET result_json=? WHERE request_id=?').bind(JSON.stringify(result),id).run()}
async function failRequest(db,id){if(id)await db.prepare("DELETE FROM request_log WHERE request_id=? AND result_json='__PENDING__'").bind(id).run()}

export async function saveRecordD1(env,p){
  await ensureSchema(env);
  const db=env.DB,m=String(p.module||''),moduleMap={
    raw:'raw',raw_bulk:'raw',raw_edit:'raw',raw_cancel:'raw',
    dye:'dye',dye_bulk:'dye',dye_plan:'dye',dye_receive:'dye',dye_edit_batch:'dye',dye_edit_receipt:'dye',dye_cancel_batch:'dye',
    production:'production',production_edit:'production',cutting_complete:'production',production_cancel:'production',
    stitching:'stitching',stitching_edit:'stitching',stitching_receive:'stitching',stitching_receipt_cancel:'stitching',stitching_cancel:'stitching',
    qc:'qc',qc_edit:'qc',rework_issue:'qc',rework_receive:'qc',rework_cancel:'qc',qc_cancel:'qc',
    handover:'qc',handover_edit:'qc',warehouse_receive:'qc',warehouse_receipt_cancel:'qc',handover_cancel:'qc'
  },perm=moduleMap[m]||null,a=await actor(db,p.actorUserId,perm,false),req=String(p.requestId||'');a.auditMeta=p.auditMeta||{};
  const actionMap={
    raw:'create',raw_bulk:'create',raw_edit:'edit',raw_cancel:'cancel',
    dye:'create',dye_bulk:'create',dye_plan:'create',dye_receive:'create',dye_edit_batch:'edit',dye_edit_receipt:'edit',dye_cancel_batch:'cancel',
    production:'create',production_edit:'edit',cutting_complete:'edit',production_cancel:'cancel',
    stitching:'create',stitching_edit:'edit',stitching_receive:'create',stitching_receipt_cancel:'cancel',stitching_cancel:'cancel',
    qc:'create',qc_edit:'edit',rework_issue:'create',rework_receive:'edit',rework_cancel:'cancel',qc_cancel:'cancel',
    handover:'create',handover_edit:'edit',warehouse_receive:'create',warehouse_receipt_cancel:'cancel',handover_cancel:'cancel'
  };
  if(perm)await requireAction(db,a,perm,actionMap[m]||'create');
  if(m==='master')await actor(db,p.actorUserId,null,true);
  const reservation=await reserveRequest(db,req,m);if(!reservation.owner)return reservation.result;
  try{
    let record;
    if(m==='raw_bulk')record=await saveRawBulk(db,p.record||{},a,req);
    else if(m==='raw_edit')record=await editRaw(db,p.record||{},a,req);
    else if(m==='raw_cancel')record=await cancelRaw(db,p.record||{},a);
    else if(m==='dye')record=await saveDyeSingle(db,p.record||{},a,req);
    else if(m==='dye_bulk')record=await saveDyeBulk(db,p.record||{},a,req);
    else if(m==='dye_plan')record=await saveDyePlan(db,p.record||{},a,req);
    else if(m==='dye_receive')record=await saveDyeReceive(db,p.record||{},a);
    else if(m==='dye_edit_batch')record=await editDyeBatch(db,p.record||{},a);
    else if(m==='dye_edit_receipt')record=await editDyeReceipt(db,p.record||{},a);
    else if(m==='dye_cancel_batch')record=await cancelDyeBatch(db,p.record||{},a);
    else if(m==='production')record=await saveProduction(db,p.record||{},a,req);
    else if(m==='production_edit')record=await editProduction(db,p.record||{},a,req);
    else if(m==='cutting_complete')record=await saveCuttingActual(db,p.record||{},a,req);
    else if(m==='production_cancel')record=await cancelProduction(db,p.record||{},a);
    else if(m==='stitching')record=await saveStitching(db,p.record||{},a,req);
    else if(m==='stitching_edit')record=await editStitching(db,p.record||{},a,req);
    else if(m==='stitching_receive')record=await saveStitchingReceipt(db,p.record||{},a,req);
    else if(m==='stitching_receipt_cancel')record=await cancelStitchingReceipt(db,p.record||{},a);
    else if(m==='stitching_cancel')record=await cancelStitching(db,p.record||{},a);
    else if(m==='qc')record=await saveQc(db,p.record||{},a,req);
    else if(m==='qc_edit')record=await editQc(db,p.record||{},a);
    else if(m==='rework_issue')record=await saveReworkIssue(db,p.record||{},a,req);
    else if(m==='rework_receive')record=await saveReworkReceive(db,p.record||{},a,req);
    else if(m==='rework_cancel')record=await cancelRework(db,p.record||{},a);
    else if(m==='qc_cancel')record=await cancelQc(db,p.record||{},a);
    else if(m==='handover')record=await saveHandover(db,p.record||{},a,req);
    else if(m==='handover_edit')record=await editHandover(db,p.record||{},a);
    else if(m==='warehouse_receive')record=await saveWarehouseReceipt(db,p.record||{},a,req);
    else if(m==='warehouse_receipt_cancel')record=await cancelWarehouseReceipt(db,p.record||{},a);
    else if(m==='handover_cancel')record=await cancelHandover(db,p.record||{},a);
    else if(m==='master')record=await saveMaster(db,p.record||{},a);
    else if(m==='raw')record=await saveRawBulk(db,{...p.record,items:[{FABRIC_ID:p.record?.FABRIC_ID,VENDOR_ROLL_NO:p.record?.VENDOR_ROLL_NO,INWARD_MTR:p.record?.INWARD_MTR,NOTES:p.record?.NOTES}]},a);
    else throw err('This transaction type is not available.',404);
    const result={saved:true,record};await completeRequest(db,req,result);return result
  }catch(e){
    await failRequest(db,req);await logError(db,a?.userId,m,e,{record:p.record||{}});throw e
  }
}
