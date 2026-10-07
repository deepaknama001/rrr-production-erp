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
  const db=env.DB,id=String(userId||'').trim().toUpperCase();if(!id||!pin)throw err('Employee ID and PIN required.',400);
  const u=await userRow(db,id);if(!u||!truth(u.ACTIVE))throw err('Invalid Employee ID or PIN.',401);
  if(u.LOCKED_UNTIL&&new Date(u.LOCKED_UNTIL).getTime()>Date.now())throw err('Too many failed attempts. Try again later.',429);
  const ok=safeEq(await hashPin(db,id,pin),u.PIN_HASH);
  if(!ok){let attempts=n(u.FAILED_ATTEMPTS)+1,locked='';if(attempts>=5){locked=new Date(Date.now()+10*60*1000).toISOString();attempts=0}await db.prepare('UPDATE users SET FAILED_ATTEMPTS=?,LOCKED_UNTIL=?,UPDATED_AT=? WHERE USER_ID=?').bind(attempts,locked,now(),id).run();throw err(locked?'Login locked for 10 minutes.':'Invalid Employee ID or PIN.',locked?429:401)}
  await db.prepare('UPDATE users SET FAILED_ATTEMPTS=0,LOCKED_UNTIL=?,LAST_LOGIN=?,UPDATED_AT=? WHERE USER_ID=?').bind('',now(),now(),id).run();
  return{user:publicUser(u),kpis:await kpisD1(db)}
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
async function audit(db,u,action,module,id,oldV='',newV=''){await db.prepare('INSERT INTO audit_log(AUDIT_ID,TIMESTAMP,USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID,OLD_VALUE_JSON,NEW_VALUE_JSON,DEVICE_INFO,IP_HASH) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),now(),u.userId,u.name,action,module,id,String(oldV||''),String(newV||''),'','').run()}


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
export async function listUsersD1(env,actorUserId){const db=env.DB;await actor(db,actorUserId,null,true);return{items:(await rows(db,'SELECT * FROM users ORDER BY NAME,USER_ID')).map(publicUser)}}
export async function saveUserD1(env,p){
  const db=env.DB,a=await actor(db,p.actorUserId,null,true),id=String(p.userId||'').trim().toUpperCase(),name=String(p.name||'').trim(),pin=String(p.pin||''),role=String(p.role||'EMPLOYEE').toUpperCase();
  if(!id||!name)throw err('User ID and name required.',400);if(pin&&!/^\d{4,8}$/.test(pin))throw err('PIN must be 4–8 digits.',400);
  const old=await userRow(db,id);if(!old&&!pin)throw err('PIN required for new user.',400);
  const t=now(),hash=pin?await hashPin(db,id,pin):old.PIN_HASH;
  await db.prepare(`INSERT INTO users(USER_ID,NAME,PIN_HASH,ROLE,PERM_RAW,PERM_DYE,PERM_PRODUCTION,PERM_STITCHING,PERM_QC,PERM_REPORTS,ADMIN,ACTIVE,FAILED_ATTEMPTS,LOCKED_UNTIL,LAST_LOGIN,CREATED_AT,UPDATED_AT)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(USER_ID) DO UPDATE SET NAME=excluded.NAME,PIN_HASH=excluded.PIN_HASH,ROLE=excluded.ROLE,PERM_RAW=excluded.PERM_RAW,PERM_DYE=excluded.PERM_DYE,PERM_PRODUCTION=excluded.PERM_PRODUCTION,PERM_STITCHING=excluded.PERM_STITCHING,PERM_QC=excluded.PERM_QC,PERM_REPORTS=excluded.PERM_REPORTS,ADMIN=excluded.ADMIN,ACTIVE=excluded.ACTIVE,UPDATED_AT=excluded.UPDATED_AT`)
  .bind(id,name,hash,role,truth(p.perm_raw)?1:0,truth(p.perm_dye)?1:0,truth(p.perm_production)?1:0,truth(p.perm_stitching)?1:0,truth(p.perm_qc)?1:0,truth(p.perm_reports)?1:0,truth(p.admin)?1:0,p.active===false?0:1,n(old?.FAILED_ATTEMPTS),old?.LOCKED_UNTIL||'',old?.LAST_LOGIN||'',old?.CREATED_AT||t,t).run();
  const saved=await userRow(db,id);await audit(db,a,'SAVE_USER','USERS',id,old?JSON.stringify(publicUser(old)):'',JSON.stringify(publicUser(saved)));return{user:publicUser(saved)}
}

async function vendorName(db,id){return (await row(db,'SELECT VENDOR_NAME FROM vendors WHERE VENDOR_ID=?',id))?.VENDOR_NAME||id||''}
async function fabricName(db,id){return (await row(db,'SELECT FABRIC_NAME FROM fabrics WHERE FABRIC_ID=?',id))?.FABRIC_NAME||id||''}
async function colorName(db,id){return (await row(db,'SELECT COLOR_NAME FROM colors WHERE COLOR_ID=?',id))?.COLOR_NAME||id||''}
async function styleName(db,id){return (await row(db,'SELECT STYLE_NAME FROM styles WHERE STYLE_ID=?',id))?.STYLE_NAME||id||''}

async function rawBalance(db,roll){
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT SUM(INWARD_MTR) FROM raw_inward WHERE ROLL_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'),0)-COALESCE((SELECT SUM(ISSUE_MTR) FROM dye_jobs WHERE ROLL_ID=?),0)) AS bal`,roll,roll);return n(r?.bal)
}
async function dyeBalance(db,batch){
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT SUM(USABLE_MTR) FROM dye_receipts WHERE DYE_BATCH_ID=?),0)-COALESCE((SELECT SUM(ALLOCATED_MTR) FROM production_batches WHERE DYE_BATCH_ID=?),0)) AS bal`,batch,batch);return n(r?.bal)
}
async function cutSizeBalance(db,pb,size){
  const map={M:['M_CUT','M_ISSUED'],L:['L_CUT','L_ISSUED'],XL:['XL_CUT','XL_ISSUED'],'2XL':['2XL_CUT','2XL_ISSUED'],'3XL':['3XL_CUT','3XL_ISSUED'],OTHER:['OTHER_CUT','OTHER_ISSUED']},p=map[String(size||'').toUpperCase()];if(!p)return 0;
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT "${p[0]}" FROM production_batches WHERE PRODUCTION_BATCH_ID=?),0)-COALESCE((SELECT SUM("${p[1]}") FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=?),0)) AS bal`,pb,pb);return n(r?.bal)
}
async function cutBalance(db,pb){
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT CASE WHEN TOTAL_CUT>0 THEN TOTAL_CUT ELSE M_CUT+L_CUT+XL_CUT+"2XL_CUT"+"3XL_CUT"+OTHER_CUT END FROM production_batches WHERE PRODUCTION_BATCH_ID=?),0)-COALESCE((SELECT SUM(TOTAL_ISSUED) FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=?),0)) AS bal`,pb,pb);return n(r?.bal)
}
async function qcSizePending(db,challan,size){
  const col={M:'M_RECEIVED',L:'L_RECEIVED',XL:'XL_RECEIVED','2XL':'2XL_RECEIVED','3XL':'3XL_RECEIVED',OTHER:'OTHER_RECEIVED'}[String(size||'').toUpperCase()];if(!col)return 0;
  const r=await row(db,`SELECT MAX(0,COALESCE((SELECT "${col}" FROM stitching_jobs WHERE CHALLAN_ID=?),0)-COALESCE((SELECT SUM(QC_QTY) FROM qc_events WHERE CHALLAN_ID=? AND UPPER(SIZE)=?),0)) AS bal`,challan,challan,String(size).toUpperCase());return n(r?.bal)
}

async function dyeBatchSummary(db,batch){
  const r=await row(db,`WITH j AS (SELECT DYE_BATCH_ID,MAX(DYE_PLAN_ID) DYE_PLAN_ID,MAX(ISSUE_DATE) ISSUE_DATE,MAX(DYE_VENDOR_ID) DYE_VENDOR_ID,MAX(FABRIC_ID) FABRIC_ID,MAX(COLOR_ID) COLOR_ID,SUM(ISSUE_MTR) ISSUE_MTR,COUNT(*) ROLL_COUNT FROM dye_jobs WHERE DYE_BATCH_ID=?),
  d AS (SELECT COALESCE(SUM(RECEIVED_MTR),0) RECEIVED_MTR,COALESCE(SUM(DEFECT_MTR),0) DEFECT_MTR,COALESCE(SUM(USABLE_MTR),0) USABLE_MTR,MAX(FINAL_RECEIPT) CLOSED FROM dye_receipts WHERE DYE_BATCH_ID=?)
  SELECT j.*,d.RECEIVED_MTR,d.DEFECT_MTR,d.USABLE_MTR,d.CLOSED FROM j CROSS JOIN d`,batch,batch);
  if(!r?.DYE_BATCH_ID)return null;const variance=truth(r.CLOSED)?n(r.RECEIVED_MTR)-n(r.ISSUE_MTR):0;return{...r,VARIANCE_MTR:variance,PENDING_MTR:truth(r.CLOSED)?0:Math.max(0,n(r.ISSUE_MTR)-n(r.RECEIVED_MTR)),CLOSED:truth(r.CLOSED),STATUS:truth(r.CLOSED)?(variance>0.0001?'RECEIVED EXCESS':variance<-0.0001?'RECEIVED SHORT':'RECEIVED EXACT'):(n(r.RECEIVED_MTR)>0?'PARTIAL RECEIVED':'AT DYE VENDOR')}
}
async function dyePlanSummary(db,plan){
  const bs=await rows(db,'SELECT DISTINCT DYE_BATCH_ID FROM dye_jobs WHERE DYE_PLAN_ID=?',plan),sums=[];for(const b of bs){const s=await dyeBatchSummary(db,b.DYE_BATCH_ID);if(s)sums.push(s)}
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
  LEFT JOIN (SELECT ROLL_ID,SUM(ISSUE_MTR) ISSUED_MTR FROM dye_jobs GROUP BY ROLL_ID)d ON d.ROLL_ID=r.ROLL_ID
  WHERE COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%'
  ORDER BY r.CREATED_AT DESC,r.ROLL_ID DESC`)}
async function viewDye(db){
  return rows(db,`
    WITH j AS (
      SELECT DYE_PLAN_ID,DYE_BATCH_ID,MAX(ISSUE_DATE) ISSUE_DATE,MAX(DYE_VENDOR_ID) DYE_VENDOR_ID,
             MAX(FABRIC_ID) FABRIC_ID,MAX(COLOR_ID) COLOR_ID,SUM(ISSUE_MTR) ISSUE_MTR,COUNT(*) ROLL_COUNT
      FROM dye_jobs GROUP BY DYE_BATCH_ID
    ),
    r AS (
      SELECT DYE_BATCH_ID,COALESCE(SUM(RECEIVED_MTR),0) RECEIVED_MTR,
             COALESCE(SUM(DEFECT_MTR),0) DEFECT_MTR,COALESCE(SUM(USABLE_MTR),0) USABLE_MTR,
             MAX(FINAL_RECEIPT) CLOSED
      FROM dye_receipts GROUP BY DYE_BATCH_ID
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
    ORDER BY ISSUE_DATE DESC,DYE_BATCH_ID DESC
  `)
}
async function viewProd(db){
  return rows(db,`SELECT p.*,COALESCE(s.STYLE_NAME,p.STYLE_ID) STYLE
                  FROM production_batches p LEFT JOIN styles s ON s.STYLE_ID=p.STYLE_ID
                  ORDER BY p.CREATED_AT DESC`)
}
async function viewStitch(db){
  return rows(db,`SELECT s.*,COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) STITCHING_VENDOR
                  FROM stitching_jobs s LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID
                  ORDER BY s.CREATED_AT DESC`)
}
async function viewQc(db){return rows(db,'SELECT * FROM qc_events ORDER BY CREATED_AT DESC')}
async function viewHandover(db){const a=await rows(db,'SELECT * FROM warehouse_handover ORDER BY CREATED_AT DESC');for(const x of a){x.STYLE=await styleName(db,x.STYLE_ID);x.COLOR=await colorName(db,x.COLOR_ID)}return a}

async function warehouseReady(db){
  return rows(db,`WITH q AS (SELECT PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE,SUM(FINAL_ACCEPTED_QTY) ACCEPTED_QTY FROM qc_events GROUP BY PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE),
  h AS (SELECT PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE,SUM(CASE WHEN WAREHOUSE_RECEIVED_QTY>0 THEN WAREHOUSE_RECEIVED_QTY ELSE ACCEPTED_QTY END) HANDED_QTY FROM warehouse_handover GROUP BY PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE)
  SELECT q.*,COALESCE(h.HANDED_QTY,0) HANDED_QTY,MAX(0,q.ACCEPTED_QTY-COALESCE(h.HANDED_QTY,0)) PENDING_QTY FROM q LEFT JOIN h USING(PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE) WHERE q.ACCEPTED_QTY-COALESCE(h.HANDED_QTY,0)>0`)
}
async function kpisD1(db){
  const r=await row(db,`SELECT
  MAX(0,(SELECT COALESCE(SUM(INWARD_MTR),0) FROM raw_inward WHERE COALESCE(STATUS,'') NOT LIKE 'CANCELLED%')-(SELECT COALESCE(SUM(ISSUE_MTR),0) FROM dye_jobs)) rawAvailable,
  MAX(0,(SELECT COALESCE(SUM(ISSUE_MTR),0) FROM dye_jobs)-(SELECT COALESCE(SUM(RECEIVED_MTR),0) FROM dye_receipts)) atDye,
  MAX(0,(SELECT COALESCE(SUM(USABLE_MTR),0) FROM dye_receipts)-(SELECT COALESCE(SUM(ALLOCATED_MTR),0) FROM production_batches)) dyedAvailable,
  MAX(0,(SELECT COALESCE(SUM(CASE WHEN TOTAL_CUT>0 THEN TOTAL_CUT ELSE M_CUT+L_CUT+XL_CUT+"2XL_CUT"+"3XL_CUT"+OTHER_CUT END),0) FROM production_batches)-(SELECT COALESCE(SUM(TOTAL_ISSUED),0) FROM stitching_jobs)) cutPending,
  MAX(0,(SELECT COALESCE(SUM(TOTAL_ISSUED),0) FROM stitching_jobs)-(SELECT COALESCE(SUM(TOTAL_RECEIVED),0) FROM stitching_jobs)) atStitching,
  MAX(0,(SELECT COALESCE(SUM(FINAL_ACCEPTED_QTY),0) FROM qc_events)-(SELECT COALESCE(SUM(WAREHOUSE_RECEIVED_QTY),0) FROM warehouse_handover)) readyWarehouse`);return r||{}
}

async function masterData(db){const [vendors,fabrics,colors,styles,sizes,defects]=await Promise.all([rows(db,'SELECT * FROM vendors'),rows(db,'SELECT * FROM fabrics'),rows(db,'SELECT * FROM colors'),rows(db,'SELECT * FROM styles'),rows(db,'SELECT * FROM sizes ORDER BY SORT_ORDER,SIZE_NAME'),rows(db,'SELECT * FROM defect_reasons')]);return{vendors,fabrics,colors,styles,sizes,defects}}
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
    LEFT JOIN (SELECT ROLL_ID,SUM(ISSUE_MTR) issued FROM dye_jobs GROUP BY ROLL_ID)d ON d.ROLL_ID=r.ROLL_ID
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
      FROM dye_jobs GROUP BY DYE_BATCH_ID
    ),
    r AS (
      SELECT DYE_BATCH_ID,SUM(RECEIVED_MTR) RECEIVED_MTR,SUM(DEFECT_MTR) DEFECT_MTR,
             SUM(USABLE_MTR) USABLE_MTR,MAX(FINAL_RECEIPT) CLOSED
      FROM dye_receipts GROUP BY DYE_BATCH_ID
    ),
    a AS (SELECT DYE_BATCH_ID,SUM(ALLOCATED_MTR) ALLOCATED_MTR FROM production_batches GROUP BY DYE_BATCH_ID)
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
    WITH si AS (
      SELECT PRODUCTION_BATCH_ID,
        SUM(M_ISSUED) M_ISSUED,SUM(L_ISSUED) L_ISSUED,SUM(XL_ISSUED) XL_ISSUED,
        SUM("2XL_ISSUED") "2XL_ISSUED",SUM("3XL_ISSUED") "3XL_ISSUED",SUM(OTHER_ISSUED) OTHER_ISSUED,
        SUM(TOTAL_ISSUED) TOTAL_ISSUED
      FROM stitching_jobs GROUP BY PRODUCTION_BATCH_ID
    )
    SELECT p.*,COALESCE(st.STYLE_NAME,p.STYLE_ID) STYLE_NAME,COALESCE(co.COLOR_NAME,p.COLOR_ID) COLOR_NAME,
      MAX(0,(CASE WHEN p.TOTAL_CUT>0 THEN p.TOTAL_CUT ELSE p.M_CUT+p.L_CUT+p.XL_CUT+p."2XL_CUT"+p."3XL_CUT"+p.OTHER_CUT END)-COALESCE(si.TOTAL_ISSUED,0)) CUT_BALANCE,
      MAX(0,p.M_CUT-COALESCE(si.M_ISSUED,0)) M_BALANCE,
      MAX(0,p.L_CUT-COALESCE(si.L_ISSUED,0)) L_BALANCE,
      MAX(0,p.XL_CUT-COALESCE(si.XL_ISSUED,0)) XL_BALANCE,
      MAX(0,p."2XL_CUT"-COALESCE(si."2XL_ISSUED",0)) "2XL_BALANCE",
      MAX(0,p."3XL_CUT"-COALESCE(si."3XL_ISSUED",0)) "3XL_BALANCE",
      MAX(0,p.OTHER_CUT-COALESCE(si.OTHER_ISSUED,0)) OTHER_BALANCE
    FROM production_batches p
    LEFT JOIN si ON si.PRODUCTION_BATCH_ID=p.PRODUCTION_BATCH_ID
    LEFT JOIN styles st ON st.STYLE_ID=p.STYLE_ID
    LEFT JOIN colors co ON co.COLOR_ID=p.COLOR_ID
    WHERE MAX(0,(CASE WHEN p.TOTAL_CUT>0 THEN p.TOTAL_CUT ELSE p.M_CUT+p.L_CUT+p.XL_CUT+p."2XL_CUT"+p."3XL_CUT"+p.OTHER_CUT END)-COALESCE(si.TOTAL_ISSUED,0))>0.0001`);

  const stitchingChallans=await rows(db,`
    WITH q AS (
      SELECT CHALLAN_ID,
        SUM(QC_QTY) QC_QTY,
        SUM(CASE WHEN UPPER(SIZE)='M' THEN QC_QTY ELSE 0 END) M_QC,
        SUM(CASE WHEN UPPER(SIZE)='L' THEN QC_QTY ELSE 0 END) L_QC,
        SUM(CASE WHEN UPPER(SIZE)='XL' THEN QC_QTY ELSE 0 END) XL_QC,
        SUM(CASE WHEN UPPER(SIZE)='2XL' THEN QC_QTY ELSE 0 END) "2XL_QC",
        SUM(CASE WHEN UPPER(SIZE)='3XL' THEN QC_QTY ELSE 0 END) "3XL_QC",
        SUM(CASE WHEN UPPER(SIZE)='OTHER' THEN QC_QTY ELSE 0 END) OTHER_QC
      FROM qc_events GROUP BY CHALLAN_ID
    )
    SELECT s.*,COALESCE(st.STYLE_NAME,s.STYLE_ID) STYLE_NAME,COALESCE(co.COLOR_NAME,s.COLOR_ID) COLOR_NAME,
      COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) VENDOR_NAME,
      MAX(0,s.TOTAL_RECEIVED-COALESCE(q.QC_QTY,0)) QC_PENDING,
      MAX(0,s.M_RECEIVED-COALESCE(q.M_QC,0)) M_QC_PENDING,
      MAX(0,s.L_RECEIVED-COALESCE(q.L_QC,0)) L_QC_PENDING,
      MAX(0,s.XL_RECEIVED-COALESCE(q.XL_QC,0)) XL_QC_PENDING,
      MAX(0,s."2XL_RECEIVED"-COALESCE(q."2XL_QC",0)) "2XL_QC_PENDING",
      MAX(0,s."3XL_RECEIVED"-COALESCE(q."3XL_QC",0)) "3XL_QC_PENDING",
      MAX(0,s.OTHER_RECEIVED-COALESCE(q.OTHER_QC,0)) OTHER_QC_PENDING
    FROM stitching_jobs s
    LEFT JOIN q ON q.CHALLAN_ID=s.CHALLAN_ID
    LEFT JOIN styles st ON st.STYLE_ID=s.STYLE_ID
    LEFT JOIN colors co ON co.COLOR_ID=s.COLOR_ID
    LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID
    WHERE MAX(0,s.TOTAL_RECEIVED-COALESCE(q.QC_QTY,0))>0.0001`);

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
export async function getDataD1(env,{module,actorUserId,id='',type=''}){
  const db=env.DB,m=String(module||'dashboard'),trailPerm=m==='trail'?({raw:'raw',dye:'dye',production:'production',stitching:'stitching',qc:'qc',handover:'qc'}[String(type||'').toLowerCase()]||null):null,perm=trailPerm||({raw:'raw',dye:'dye',production:'production',stitching:'stitching',qc:'qc',handover:'qc',reports:'reports'}[m]||null),a=await actor(db,actorUserId,perm,false);
  if(m==='dashboard')return{user:a,kpis:await kpisD1(db)};if(m==='trail')return{trail:await traceRecord(db,type,id)};if(m==='dye_detail')return{detail:await getDyeBatchDetail(db,String(id||''))};if(m==='lookups')return{lookups:await lookupData(db)};if(m==='raw')return{items:await viewRaw(db)};if(m==='dye')return{items:await viewDye(db)};if(m==='production')return{items:await viewProd(db)};if(m==='stitching')return{items:await viewStitch(db)};if(m==='qc')return{items:await viewQc(db)};if(m==='handover')return{items:await viewHandover(db)};if(m==='reports')return{items:[],kpis:await kpisD1(db)};if(m==='audit'){await actor(db,actorUserId,'reports',false);return{items:await rows(db,'SELECT AUDIT_ID,TIMESTAMP,USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID,OLD_VALUE_JSON,NEW_VALUE_JSON FROM audit_log ORDER BY TIMESTAMP DESC LIMIT 2000')}};if(m==='masters'){await actor(db,actorUserId,null,true);return{masters:await masterData(db)}}throw err('Unknown module.',404)
}

async function saveMaster(db,r,a){
  const entity=String(r.entity||'').toLowerCase(),cfg={vendor:{table:'vendors',key:'VENDOR_ID',prefix:'VEN',fields:['VENDOR_ID','VENDOR_NAME','FABRIC_SUPPLIER','DYE_VENDOR','STITCHING_VENDOR','CUTTING_VENDOR','PHONE','GST_REF','ADDRESS','ACTIVE','CREATED_AT','UPDATED_AT']},fabric:{table:'fabrics',key:'FABRIC_ID',prefix:'FAB',fields:['FABRIC_ID','FABRIC_NAME','FABRIC_CODE','UOM','ACTIVE','NOTES','CREATED_AT','UPDATED_AT']},color:{table:'colors',key:'COLOR_ID',prefix:'CLR',fields:['COLOR_ID','COLOR_NAME','COLOR_CODE','ACTIVE','CREATED_AT','UPDATED_AT']},style:{table:'styles',key:'STYLE_ID',prefix:'STY',fields:['STYLE_ID','STYLE_NAME','CATEGORY','STYLE_CODE','DEFAULT_FABRIC_ID','ACTIVE','NOTES','CREATED_AT','UPDATED_AT']},size:{table:'sizes',key:'SIZE_ID',prefix:'SIZ',fields:['SIZE_ID','SIZE_NAME','SORT_ORDER','ACTIVE','CREATED_AT','UPDATED_AT']},defect:{table:'defect_reasons',key:'DEFECT_ID',prefix:'DEF',fields:['DEFECT_ID','DEFECT_NAME','STAGE','CATEGORY','ACTIVE','NOTES','CREATED_AT','UPDATED_AT']}}[entity];if(!cfg)throw err('Unknown master type.',400);
  const id=String(r[cfg.key]||'').trim()||await nextMasterId(db,cfg.prefix),old=await row(db,`SELECT * FROM ${cfg.table} WHERE "${cfg.key}"=?`,id),t=now(),obj=cleanRow({...r,[cfg.key]:id,ACTIVE:r.ACTIVE===false||String(r.ACTIVE).toLowerCase()==='false'?0:1,CREATED_AT:old?.CREATED_AT||t,UPDATED_AT:t});
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
async function saveRawBulk(db,r,a){
  const supplier=String(r.SUPPLIER_ID||''),invoice=String(r.INVOICE_CHALLAN||''),lot=String(r.LOT_REF||''),items=Array.isArray(r.items)?r.items:[],d=dateOnly(r.INWARD_DATE),notes=String(r.NOTES||'');if(!supplier)throw err('Supplier is required.',400);if(!items.length)throw err('Add at least one fabric roll.',400);for(let i=0;i<items.length;i++){if(!items[i].FABRIC_ID)throw err('Fabric is required on roll '+(i+1)+'.',400);requirePos(items[i].INWARD_MTR,'Roll '+(i+1)+' meter')}
  const dupe=await rawFingerprint(db,supplier,invoice,lot,d,items);if(dupe)return dupe;const inward=await nextId(db,'INW'),t=now(),rolls=[],stmts=[];
  for(const x of items){const roll=await nextId(db,'RF');rolls.push(roll);stmts.push(db.prepare('INSERT INTO raw_inward(ROW_ID,INWARD_ID,ROLL_ID,INWARD_DATE,SUPPLIER_ID,VENDOR_ROLL_NO,FABRIC_ID,INWARD_MTR,INVOICE_CHALLAN,LOT_REF,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),inward,roll,d,supplier,String(x.VENDOR_ROLL_NO||''),String(x.FABRIC_ID||''),n(x.INWARD_MTR),invoice,lot,'AVAILABLE',String(x.NOTES||notes),a.userId,t,a.userId,t))}
  await db.batch(stmts);const result={INWARD_ID:inward,ROLL_COUNT:items.length,TOTAL_MTR:items.reduce((s,x)=>s+n(x.INWARD_MTR),0),ROLL_IDS:rolls};await audit(db,a,'CREATE_BULK','RAW',inward,'',JSON.stringify(result));return result
}


async function editRaw(db,r,a){
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
  const t=now();
  await db.prepare(`UPDATE raw_inward SET INWARD_DATE=?,SUPPLIER_ID=?,VENDOR_ROLL_NO=?,FABRIC_ID=?,INWARD_MTR=?,INVOICE_CHALLAN=?,LOT_REF=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE ROLL_ID=?`)
    .bind(dateOnly(r.INWARD_DATE||old.INWARD_DATE),supplier,String(r.VENDOR_ROLL_NO??old.VENDOR_ROLL_NO),newFabric,newQty,String(r.INVOICE_CHALLAN??old.INVOICE_CHALLAN),String(r.LOT_REF??old.LOT_REF),String(r.NOTES??old.NOTES),a.userId,t,roll).run();
  const after=await row(db,'SELECT * FROM raw_inward WHERE ROLL_ID=?',roll);
  await audit(db,a,'EDIT_RAW','RAW',roll,JSON.stringify(old),JSON.stringify(after));return after
}
async function cancelRaw(db,r,a){
  const roll=String(r.ROLL_ID||''),old=await row(db,'SELECT * FROM raw_inward WHERE ROLL_ID=?',roll);if(!old)throw err('Raw roll not found.',404);
  const issued=n((await row(db,'SELECT COALESCE(SUM(ISSUE_MTR),0) q FROM dye_jobs WHERE ROLL_ID=?',roll))?.q);
  if(issued>0.0001)throw err('This roll has already been issued to dye. Cancel/reverse downstream dye issue first.',409);
  const t=now(),reason=String(r.REASON||'Mistaken entry');
  await db.prepare("UPDATE raw_inward SET STATUS=?,NOTES=?,UPDATED_BY=?,UPDATED_AT=? WHERE ROLL_ID=?")
    .bind('CANCELLED',String(old.NOTES||'')+(old.NOTES?' | ':'')+'Cancelled: '+reason,a.userId,t,roll).run();
  await audit(db,a,'CANCEL_RAW','RAW',roll,JSON.stringify(old),JSON.stringify({cancelled:true,reason}));return{ROLL_ID:roll,cancelled:true}
}
async function cancelProduction(db,r,a){
  const id=String(r.PRODUCTION_BATCH_ID||''),old=await row(db,'SELECT * FROM production_batches WHERE PRODUCTION_BATCH_ID=?',id);if(!old)throw err('Production batch not found.',404);
  const downstream=n((await row(db,'SELECT COUNT(*) c FROM stitching_jobs WHERE PRODUCTION_BATCH_ID=?',id))?.c);
  if(downstream)throw err('Production batch already has stitching challans. Reverse/cancel them first.',409);
  await db.prepare('DELETE FROM production_batches WHERE PRODUCTION_BATCH_ID=?').bind(id).run();
  await audit(db,a,'CANCEL_PRODUCTION','PRODUCTION',id,JSON.stringify(old),JSON.stringify({cancelled:true,reason:String(r.REASON||'Mistaken entry')}));return{PRODUCTION_BATCH_ID:id,cancelled:true}
}
async function cancelStitching(db,r,a){
  const id=String(r.CHALLAN_ID||''),old=await row(db,'SELECT * FROM stitching_jobs WHERE CHALLAN_ID=?',id);if(!old)throw err('Stitching challan not found.',404);
  const downstream=n((await row(db,'SELECT COUNT(*) c FROM qc_events WHERE CHALLAN_ID=?',id))?.c);
  if(downstream)throw err('This challan already has QC entries. Reverse/cancel QC first.',409);
  await db.prepare('DELETE FROM stitching_jobs WHERE CHALLAN_ID=?').bind(id).run();
  await audit(db,a,'CANCEL_STITCHING','STITCHING',id,JSON.stringify(old),JSON.stringify({cancelled:true,reason:String(r.REASON||'Mistaken entry')}));return{CHALLAN_ID:id,cancelled:true}
}
async function cancelQc(db,r,a){
  const id=String(r.QC_ID||''),old=await row(db,'SELECT * FROM qc_events WHERE QC_ID=?',id);if(!old)throw err('QC entry not found.',404);
  const downstream=n((await row(db,`SELECT COUNT(*) c FROM warehouse_handover WHERE PRODUCTION_BATCH_ID=? AND STYLE_ID=? AND COLOR_ID=? AND SIZE=?`,old.PRODUCTION_BATCH_ID,old.STYLE_ID,old.COLOR_ID,old.SIZE))?.c);
  if(downstream)throw err('This QC result has downstream warehouse handover. Reverse/cancel handover first.',409);
  await db.prepare('DELETE FROM qc_events WHERE QC_ID=?').bind(id).run();
  await audit(db,a,'CANCEL_QC','QC',id,JSON.stringify(old),JSON.stringify({cancelled:true,reason:String(r.REASON||'Mistaken entry')}));return{QC_ID:id,cancelled:true}
}
async function cancelHandover(db,r,a){
  const id=String(r.HANDOVER_ID||''),old=await row(db,'SELECT * FROM warehouse_handover WHERE HANDOVER_ID=?',id);if(!old)throw err('Handover entry not found.',404);
  await db.prepare('DELETE FROM warehouse_handover WHERE HANDOVER_ID=?').bind(id).run();
  await audit(db,a,'CANCEL_HANDOVER','HANDOVER',id,JSON.stringify(old),JSON.stringify({cancelled:true,reason:String(r.REASON||'Mistaken entry')}));return{HANDOVER_ID:id,cancelled:true}
}
async function saveDyeSingle(db,r,a){
  const roll=String(r.ROLL_ID||''),issue=n(r.ISSUE_MTR);requirePos(issue,'Issue meter');
  const rr=await row(db,"SELECT * FROM raw_inward WHERE ROLL_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",roll);if(!rr)throw err('Raw roll not found.',400);
  const bal=await rawBalance(db,roll);if(issue>bal+0.0001)throw err('Issue meter exceeds raw roll balance.',409);
  const id=await nextId(db,'DB'),t=now();
  await db.prepare('INSERT INTO dye_jobs(ROW_ID,DYE_BATCH_ID,ISSUE_DATE,DYE_VENDOR_ID,ROLL_ID,VENDOR_ROLL_NO,FABRIC_ID,COLOR_ID,ISSUE_MTR,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT,DYE_PLAN_ID) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(uuid(),id,dateOnly(r.ISSUE_DATE),String(r.DYE_VENDOR_ID||''),roll,String(rr.VENDOR_ROLL_NO||''),String(rr.FABRIC_ID||''),String(r.COLOR_ID||''),issue,'AT DYE VENDOR',String(r.NOTES||''),a.userId,t,a.userId,t,'').run();
  await audit(db,a,'CREATE','DYE',id,'',JSON.stringify(r));return{DYE_BATCH_ID:id}
}
async function saveDyeBulk(db,r,a){
  const vendor=String(r.DYE_VENDOR_ID||''),color=String(r.COLOR_ID||''),items=Array.isArray(r.items)?r.items:[],d=dateOnly(r.ISSUE_DATE),notes=String(r.NOTES||'');
  if(!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1 AND DYE_VENDOR=1',vendor))throw err('Selected vendor is not an active Dye Vendor.',400);
  if(!await row(db,'SELECT 1 ok FROM colors WHERE COLOR_ID=? AND ACTIVE=1',color))throw err('Selected color is not active.',400);
  if(!items.length)throw err('Add at least one raw fabric roll.',400);
  const seen=new Set(),fabrics=new Set(),resolved=[];
  for(let i=0;i<items.length;i++){const x=items[i],roll=String(x.ROLL_ID||''),qty=n(x.ISSUE_MTR);if(!roll)throw err('Roll is required on line '+(i+1)+'.',400);if(seen.has(roll))throw err('Same roll cannot be selected twice in one dye batch.',409);seen.add(roll);requirePos(qty,'Issue meter on line '+(i+1));const rr=await row(db,"SELECT * FROM raw_inward WHERE ROLL_ID=? AND COALESCE(STATUS,'') NOT LIKE 'CANCELLED%'",roll);if(!rr)throw err('Roll '+roll+' is not available.',409);const bal=await rawBalance(db,roll);if(qty>bal+0.0001)throw err('Issue meter exceeds available balance for roll '+(rr.VENDOR_ROLL_NO||roll)+'. Available: '+bal,409);fabrics.add(String(rr.FABRIC_ID||''));resolved.push({x,rr})}
  if(fabrics.size!==1)throw err('One dye batch can contain rolls of only one fabric type. Create separate dye batches for different fabrics.',409);
  const batch=await nextId(db,'DB'),fabric=[...fabrics][0],t=now(),stmts=resolved.map(({x,rr})=>db.prepare('INSERT INTO dye_jobs(ROW_ID,DYE_BATCH_ID,ISSUE_DATE,DYE_VENDOR_ID,ROLL_ID,VENDOR_ROLL_NO,FABRIC_ID,COLOR_ID,ISSUE_MTR,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT,DYE_PLAN_ID) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),batch,d,vendor,String(x.ROLL_ID),String(rr.VENDOR_ROLL_NO||''),fabric,color,n(x.ISSUE_MTR),'AT DYE VENDOR',String(x.NOTES||notes),a.userId,t,a.userId,t,''));
  await db.batch(stmts);const result={DYE_BATCH_ID:batch,ROLL_COUNT:stmts.length,TOTAL_MTR:items.reduce((s,x)=>s+n(x.ISSUE_MTR),0),FABRIC_ID:fabric};await audit(db,a,'CREATE_BULK','DYE',batch,'',JSON.stringify(result));return result
}

async function saveDyePlan(db,r,a){
  const fabric=String(r.FABRIC_ID||''),items=Array.isArray(r.items)?r.items:[],d=dateOnly(r.ISSUE_DATE),notes=String(r.NOTES||'');if(!fabric)throw err('Fabric is required.',400);const fr=await row(db,'SELECT * FROM fabrics WHERE FABRIC_ID=? AND ACTIVE=1',fabric);if(!fr)throw err('Selected fabric is not active.',400);if(!items.length)throw err('Add at least one dye color.',400);
  const seen=new Set();let need=0;for(let i=0;i<items.length;i++){const x=items[i],c=String(x.COLOR_ID||''),v=String(x.DYE_VENDOR_ID||'');if(!c)throw err('Color is required on line '+(i+1)+'.',400);if(seen.has(c))throw err('Same color cannot appear twice in one dye plan.',409);seen.add(c);if(!await row(db,'SELECT 1 ok FROM colors WHERE COLOR_ID=? AND ACTIVE=1',c))throw err('Color on line '+(i+1)+' is not active.',400);if(!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1 AND DYE_VENDOR=1',v))throw err('Select a valid active Dye Vendor on line '+(i+1)+'.',400);requirePos(x.ISSUE_MTR,'Issue meter on line '+(i+1));need+=n(x.ISSUE_MTR)}
  const src=await rows(db,`SELECT r.*,MAX(0,r.INWARD_MTR-COALESCE(d.issued,0)) BALANCE_MTR FROM raw_inward r LEFT JOIN(SELECT ROLL_ID,SUM(ISSUE_MTR) issued FROM dye_jobs GROUP BY ROLL_ID)d ON d.ROLL_ID=r.ROLL_ID WHERE r.FABRIC_ID=? AND COALESCE(r.STATUS,'') NOT LIKE 'CANCELLED%' AND r.INWARD_MTR-COALESCE(d.issued,0)>0.0001 ORDER BY r.INWARD_DATE,r.CREATED_AT,r.ROLL_ID`,fabric);const available=src.reduce((s,x)=>s+n(x.BALANCE_MTR),0);if(need>available+0.0001)throw err('Dye plan total '+need+' m exceeds available '+available+' m for '+await fabricName(db,fabric)+'.',409);
  const plan=await nextId(db,'DP'),t=now(),stmts=[],batches=[];let cursor=0;for(const item of items){const batch=await nextId(db,'DB'),qty=n(item.ISSUE_MTR),vendor=String(item.DYE_VENDOR_ID),color=String(item.COLOR_ID);let left=qty,lines=0;while(left>0.0001){while(cursor<src.length&&n(src[cursor].BALANCE_MTR)<=0.0001)cursor++;if(cursor>=src.length)throw err('Unexpected allocation shortage while creating dye plan.',500);const rr=src[cursor],take=Math.min(left,n(rr.BALANCE_MTR));stmts.push(db.prepare('INSERT INTO dye_jobs(ROW_ID,DYE_BATCH_ID,ISSUE_DATE,DYE_VENDOR_ID,ROLL_ID,VENDOR_ROLL_NO,FABRIC_ID,COLOR_ID,ISSUE_MTR,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT,DYE_PLAN_ID) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),batch,d,vendor,rr.ROLL_ID,rr.VENDOR_ROLL_NO||'',fabric,color,take,'AT DYE VENDOR',String(item.NOTES||notes),a.userId,t,a.userId,t,plan));rr.BALANCE_MTR=n(rr.BALANCE_MTR)-take;left-=take;lines++}batches.push({DYE_BATCH_ID:batch,COLOR_ID:color,DYE_VENDOR_ID:vendor,ISSUE_MTR:qty,ROLL_LINES:lines})}
  await db.batch(stmts);const result={DYE_PLAN_ID:plan,FABRIC_ID:fabric,TOTAL_MTR:need,BATCH_COUNT:batches.length,BATCHES:batches};await audit(db,a,'CREATE_DYE_PLAN','DYE',plan,'',JSON.stringify(result));return result
}
async function saveDyeReceive(db,r,a){
  const batch=String(r.DYE_BATCH_ID||''),received=n(r.RECEIVED_MTR),defect=n(r.DEFECT_MTR),final=truth(r.FINAL_RECEIPT),s=await dyeBatchSummary(db,batch);if(!s)throw err('Invalid dye batch.',400);if(s.CLOSED)throw err('This dye batch is already closed.',409);requirePos(received,'Received meter');if(defect<0||defect>received)throw err('Defect meter must be between 0 and received meter.',409);
  const usable=received-defect,cumulative=n(s.RECEIVED_MTR)+received,variance=final?cumulative-n(s.ISSUE_MTR):0,status=final?(variance>0.0001?'CLOSED EXCESS':variance<-0.0001?'CLOSED SHORT':'CLOSED EXACT'):'PARTIAL',id=await nextId(db,'DR'),t=now();
  await db.prepare('INSERT INTO dye_receipts(RECEIPT_ID,DYE_BATCH_ID,RECEIPT_DATE,RECEIVED_MTR,DEFECT_MTR,USABLE_MTR,VARIANCE_MTR,FINAL_RECEIPT,STATUS,DEFECT_REASON,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,batch,dateOnly(r.RECEIPT_DATE),received,defect,usable,variance,final?1:0,status,String(r.DEFECT_REASON||''),String(r.NOTES||''),a.userId,t,a.userId,t).run();
  const after=await dyeBatchSummary(db,batch),plan=after?.DYE_PLAN_ID?await dyePlanSummary(db,after.DYE_PLAN_ID):null;await audit(db,a,'DYE_RECEIVE','DYE',batch,'',JSON.stringify({receiptId:id,received,defect,usable,finalReceipt:final,batchVariance:after?.VARIANCE_MTR||0,planVariance:plan?.VARIANCE_MTR||0}));return{RECEIPT_ID:id,DYE_BATCH_ID:batch,RECEIVED_MTR:received,DEFECT_MTR:defect,USABLE_MTR:usable,FINAL_RECEIPT:final,BATCH:after,PLAN:plan}
}

async function dyeDownstreamCount(db,batch){
  const r=await row(db,'SELECT COUNT(*) c FROM production_batches WHERE DYE_BATCH_ID=?',batch);
  return n(r?.c);
}
async function getDyeBatchDetail(db,batch){
  const head=await row(db,`
    SELECT j.DYE_BATCH_ID,j.DYE_PLAN_ID,MAX(j.ISSUE_DATE) ISSUE_DATE,MAX(j.DYE_VENDOR_ID) DYE_VENDOR_ID,
           MAX(j.FABRIC_ID) FABRIC_ID,MAX(j.COLOR_ID) COLOR_ID,SUM(j.ISSUE_MTR) ISSUE_MTR,
           MAX(j.NOTES) NOTES
    FROM dye_jobs j WHERE j.DYE_BATCH_ID=? GROUP BY j.DYE_BATCH_ID,j.DYE_PLAN_ID`,batch);
  if(!head)throw err('Dye batch not found.',404);
  const lines=await rows(db,`
    SELECT j.ROW_ID,j.ROLL_ID,j.VENDOR_ROLL_NO,j.ISSUE_MTR,
           MAX(0,r.INWARD_MTR-COALESCE(x.other_issued,0)) MAX_AVAILABLE_MTR
    FROM dye_jobs j
    JOIN raw_inward r ON r.ROLL_ID=j.ROLL_ID
    LEFT JOIN (
      SELECT ROLL_ID,SUM(ISSUE_MTR) other_issued FROM dye_jobs WHERE DYE_BATCH_ID<>? GROUP BY ROLL_ID
    ) x ON x.ROLL_ID=j.ROLL_ID
    WHERE j.DYE_BATCH_ID=? ORDER BY j.ROW_ID`,batch,batch);
  const receipts=await rows(db,'SELECT * FROM dye_receipts WHERE DYE_BATCH_ID=? ORDER BY CREATED_AT,RECEIPT_ID',batch);
  return{...head,lines,receipts,downstreamCount:await dyeDownstreamCount(db,batch)}
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
    const other=await row(db,'SELECT COALESCE(SUM(ISSUE_MTR),0) q FROM dye_jobs WHERE ROLL_ID=? AND DYE_BATCH_ID<>?',roll,batch);
    const max=n(rr.INWARD_MTR)-n(other?.q);
    if(qty>max+0.0001)throw err('Issue exceeds available meter for roll '+(rr.VENDOR_ROLL_NO||roll)+'. Available: '+max,409);
    resolved.push({rr,qty});
  }

  const t=now();
  await db.prepare('DELETE FROM dye_jobs WHERE DYE_BATCH_ID=?').bind(batch).run();
  const stmts=resolved.map(({rr,qty})=>db.prepare(
    'INSERT INTO dye_jobs(ROW_ID,DYE_BATCH_ID,ISSUE_DATE,DYE_VENDOR_ID,ROLL_ID,VENDOR_ROLL_NO,FABRIC_ID,COLOR_ID,ISSUE_MTR,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT,DYE_PLAN_ID) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(uuid(),batch,issueDate,vendor,rr.ROLL_ID,rr.VENDOR_ROLL_NO||'',old.FABRIC_ID,color,qty,'AT DYE VENDOR',notes,a.userId,t,a.userId,t,old.DYE_PLAN_ID));
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
  const other=await row(db,'SELECT COALESCE(SUM(RECEIVED_MTR),0) received FROM dye_receipts WHERE DYE_BATCH_ID=? AND RECEIPT_ID<>?',receipt.DYE_BATCH_ID,receiptId);
  const issued=await row(db,'SELECT COALESCE(SUM(ISSUE_MTR),0) issued FROM dye_jobs WHERE DYE_BATCH_ID=?',receipt.DYE_BATCH_ID);
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
  const old=await getDyeBatchDetail(db,batch);
  await db.batch([
    db.prepare('DELETE FROM dye_receipts WHERE DYE_BATCH_ID=?').bind(batch),
    db.prepare('DELETE FROM dye_jobs WHERE DYE_BATCH_ID=?').bind(batch)
  ]);
  await audit(db,a,'CANCEL_DYE_BATCH','DYE',batch,JSON.stringify(old),JSON.stringify({cancelled:true,reason:String(r.REASON||'Mistaken entry')}));
  return{DYE_BATCH_ID:batch,cancelled:true}
}
async function saveProduction(db,r,a){
  const batch=String(r.DYE_BATCH_ID||''),style=String(r.STYLE_ID||''),alloc=n(r.ALLOCATED_MTR);requirePos(alloc,'Allocated meter');const st=await row(db,'SELECT * FROM styles WHERE STYLE_ID=? AND ACTIVE=1',style);if(!st)throw err('Select a valid active style.',400);const dj=await row(db,'SELECT FABRIC_ID,COLOR_ID FROM dye_jobs WHERE DYE_BATCH_ID=? LIMIT 1',batch);if(!dj)throw err('Select a valid dye batch.',400);if(st.DEFAULT_FABRIC_ID&&String(st.DEFAULT_FABRIC_ID)!==String(dj.FABRIC_ID))throw err('Selected style is mapped to a different fabric type.',409);if(await dyeBalance(db,batch)+0.0001<alloc)throw err('Allocated meter exceeds dyed usable balance.',409);
  const id=await nextId(db,'PB'),t=now();await db.prepare('INSERT INTO production_batches(ROW_ID,PRODUCTION_BATCH_ID,PLAN_DATE,DYE_BATCH_ID,STYLE_ID,FABRIC_ID,COLOR_ID,PLANNED_QTY,ALLOCATED_MTR,M_CUT,L_CUT,XL_CUT,"2XL_CUT","3XL_CUT",OTHER_CUT,TOTAL_CUT,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),id,dateOnly(r.PLAN_DATE),batch,style,dj.FABRIC_ID,dj.COLOR_ID,n(r.PLANNED_QTY),alloc,0,0,0,0,0,0,0,'PLANNED',String(r.NOTES||''),a.userId,t,a.userId,t).run();await audit(db,a,'CREATE','PRODUCTION',id,'',JSON.stringify(r));return{PRODUCTION_BATCH_ID:id}
}
async function saveStitching(db,r,a){
  const pb=String(r.PRODUCTION_BATCH_ID||''),vendor=String(r.STITCHING_VENDOR_ID||''),labels=['M','L','XL','2XL','3XL','OTHER'],sizes=labels.map(x=>n(r[x+'_ISSUED'])),total=sizes.reduce((x,y)=>x+y,0);requirePos(total,'Total stitching issue quantity');if(!await row(db,'SELECT 1 ok FROM vendors WHERE VENDOR_ID=? AND ACTIVE=1 AND STITCHING_VENDOR=1',vendor))throw err('Select a valid active Stitching Vendor.',400);if(await cutBalance(db,pb)+0.0001<total)throw err('Issued pieces exceed cut stock balance.',409);for(let i=0;i<labels.length;i++){const bal=await cutSizeBalance(db,pb,labels[i]);if(sizes[i]>bal+0.0001)throw err(labels[i]+' issue exceeds cut-piece balance. Available: '+bal,409)}
  const p=await row(db,'SELECT STYLE_ID,COLOR_ID FROM production_batches WHERE PRODUCTION_BATCH_ID=?',pb);if(!p)throw err('Invalid production batch.',400);const id=await nextId(db,'STC'),t=now();await db.prepare('INSERT INTO stitching_jobs(ROW_ID,CHALLAN_ID,ISSUE_DATE,STITCHING_VENDOR_ID,PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,M_ISSUED,L_ISSUED,XL_ISSUED,"2XL_ISSUED","3XL_ISSUED",OTHER_ISSUED,M_RECEIVED,L_RECEIVED,XL_RECEIVED,"2XL_RECEIVED","3XL_RECEIVED",OTHER_RECEIVED,TOTAL_ISSUED,TOTAL_RECEIVED,PENDING_QTY,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(uuid(),id,dateOnly(r.ISSUE_DATE),vendor,pb,p.STYLE_ID,p.COLOR_ID,...sizes,0,0,0,0,0,0,total,0,total,'PENDING FROM VENDOR',String(r.NOTES||''),a.userId,t,a.userId,t).run();await audit(db,a,'CREATE','STITCHING',id,'',JSON.stringify(r));return{CHALLAN_ID:id}
}
async function saveQc(db,r,a){
  const challan=String(r.CHALLAN_ID||''),size=String(r.SIZE||'').toUpperCase(),q=n(r.QC_QTY),pass=n(r.PASS_QTY),rw=n(r.REWORK_QTY),rej=n(r.REJECT_QTY);requirePos(q,'QC quantity');if(!size)throw err('Size is required.',400);const pending=await qcSizePending(db,challan,size);if(q>pending+0.0001)throw err('QC quantity exceeds '+size+' quantity pending QC. Available: '+pending,409);if(Math.abs(pass+rw+rej-q)>0.0001)throw err('Pass + Rework + Reject must exactly equal QC Qty.',409);const st=await row(db,'SELECT * FROM stitching_jobs WHERE CHALLAN_ID=?',challan);if(!st)throw err('Invalid stitching challan.',400);const id=await nextId(db,'QC'),t=now();await db.prepare('INSERT INTO qc_events(QC_ID,QC_DATE,CHALLAN_ID,PRODUCTION_BATCH_ID,VENDOR_ID,STYLE_ID,COLOR_ID,SIZE,QC_QTY,PASS_QTY,REWORK_QTY,REJECT_QTY,SHORT_QTY,DEFECT_REASON,REWORK_CHALLAN_ID,REWORK_RETURNED_QTY,FINAL_ACCEPTED_QTY,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,dateOnly(r.QC_DATE),challan,st.PRODUCTION_BATCH_ID,st.STITCHING_VENDOR_ID,st.STYLE_ID,st.COLOR_ID,size,q,pass,rw,rej,0,String(r.DEFECT_REASON||''),'',0,pass,'OPEN',String(r.NOTES||''),a.userId,t,a.userId,t).run();await audit(db,a,'CREATE','QC',id,'',JSON.stringify(r));return{QC_ID:id}
}
async function saveHandover(db,r,a){
  const pb=String(r.PRODUCTION_BATCH_ID||''),style=String(r.STYLE_ID||''),color=String(r.COLOR_ID||''),size=String(r.SIZE||''),accepted=n(r.ACCEPTED_QTY),received=n(r.WAREHOUSE_RECEIVED_QTY);requirePos(accepted,'Accepted quantity');if(received<0||received>accepted)throw err('Warehouse received quantity cannot exceed handover quantity.',409);const ready=(await warehouseReady(db)).find(x=>String(x.PRODUCTION_BATCH_ID)===pb&&String(x.STYLE_ID)===style&&String(x.COLOR_ID)===color&&String(x.SIZE)===size);if(!ready||accepted>n(ready.PENDING_QTY)+0.0001)throw err('Handover quantity exceeds QC-passed quantity available.',409);const pending=Math.max(0,accepted-received),id=await nextId(db,'WH'),t=now();await db.prepare('INSERT INTO warehouse_handover(HANDOVER_ID,HANDOVER_DATE,PRODUCTION_BATCH_ID,STYLE_ID,COLOR_ID,SIZE,ACCEPTED_QTY,WAREHOUSE_RECEIVED_QTY,PENDING_QTY,WAREHOUSE_REF,STATUS,NOTES,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,dateOnly(r.HANDOVER_DATE),pb,style,color,size,accepted,received,pending,String(r.WAREHOUSE_REF||''),pending?'PARTIAL':'RECEIVED',String(r.NOTES||''),a.userId,t,a.userId,t).run();await audit(db,a,'CREATE','HANDOVER',id,'',JSON.stringify(r));return{HANDOVER_ID:id}
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
  const db=env.DB,m=String(p.module||''),perm={raw:'raw',raw_bulk:'raw',raw_edit:'raw',raw_cancel:'raw',dye:'dye',dye_bulk:'dye',dye_plan:'dye',dye_receive:'dye',dye_edit_batch:'dye',dye_edit_receipt:'dye',dye_cancel_batch:'dye',production:'production',production_cancel:'production',stitching:'stitching',stitching_cancel:'stitching',qc:'qc',qc_cancel:'qc',handover:'qc',handover_cancel:'qc'}[m]||null,a=await actor(db,p.actorUserId,perm,false),req=String(p.requestId||''),reservation=await reserveRequest(db,req,m);if(!reservation.owner)return reservation.result;
  try{let record;if(m==='raw_bulk')record=await saveRawBulk(db,p.record||{},a);else if(m==='raw_edit')record=await editRaw(db,p.record||{},a);else if(m==='raw_cancel')record=await cancelRaw(db,p.record||{},a);else if(m==='dye')record=await saveDyeSingle(db,p.record||{},a);else if(m==='dye_bulk')record=await saveDyeBulk(db,p.record||{},a);else if(m==='dye_plan')record=await saveDyePlan(db,p.record||{},a);else if(m==='dye_receive')record=await saveDyeReceive(db,p.record||{},a);else if(m==='dye_edit_batch')record=await editDyeBatch(db,p.record||{},a);else if(m==='dye_edit_receipt')record=await editDyeReceipt(db,p.record||{},a);else if(m==='dye_cancel_batch')record=await cancelDyeBatch(db,p.record||{},a);else if(m==='production')record=await saveProduction(db,p.record||{},a);else if(m==='production_cancel')record=await cancelProduction(db,p.record||{},a);else if(m==='stitching')record=await saveStitching(db,p.record||{},a);else if(m==='stitching_cancel')record=await cancelStitching(db,p.record||{},a);else if(m==='qc')record=await saveQc(db,p.record||{},a);else if(m==='qc_cancel')record=await cancelQc(db,p.record||{},a);else if(m==='handover')record=await saveHandover(db,p.record||{},a);else if(m==='handover_cancel')record=await cancelHandover(db,p.record||{},a);else if(m==='master'){await actor(db,p.actorUserId,null,true);record=await saveMaster(db,p.record||{},a)}else if(m==='raw'){record=await saveRawBulk(db,{...p.record,items:[{FABRIC_ID:p.record?.FABRIC_ID,VENDOR_ROLL_NO:p.record?.VENDOR_ROLL_NO,INWARD_MTR:p.record?.INWARD_MTR,NOTES:p.record?.NOTES}]},a)}else throw err('This legacy transaction type is not available in D1 mode.',404);const result={saved:true,record};await completeRequest(db,req,result);return result}catch(e){await failRequest(db,req);throw e}
}
