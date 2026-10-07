import {json,errorResponse,readJson} from '../_lib/common.js';
import {requireAuth} from '../_lib/auth.js';

async function ensureDocs(db){
  const ddl=[
    `CREATE TABLE IF NOT EXISTS docs_documents(
      DOC_ID TEXT PRIMARY KEY,
      DOC_NO TEXT NOT NULL UNIQUE,
      DOC_TYPE TEXT NOT NULL,
      SOURCE_IDS TEXT NOT NULL DEFAULT '[]',
      VENDOR_ID TEXT,
      DOC_DATE TEXT NOT NULL,
      NOTES TEXT,
      PAYLOAD_JSON TEXT NOT NULL,
      STATUS TEXT NOT NULL DEFAULT 'ACTIVE',
      PRINT_COUNT INTEGER NOT NULL DEFAULT 0,
      CREATED_BY TEXT,
      CREATED_AT TEXT,
      UPDATED_BY TEXT,
      UPDATED_AT TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_docs_type_date ON docs_documents(DOC_TYPE,DOC_DATE)`,
    `CREATE INDEX IF NOT EXISTS idx_docs_status ON docs_documents(STATUS)`
  ];
  for(const sql of ddl)await db.prepare(sql).run()
}
function typePerm(t){return t==='DYE_CHALLAN'?'dye':'stitching'}
async function can(context,user,perm,action='view'){
  if(user.admin)return true;
  if(!user.permissions?.[perm])return false;
  const r=await context.env.DB.prepare('SELECT * FROM user_action_permissions WHERE USER_ID=? AND MODULE=?').bind(user.uid,perm).first();
  if(!r)return true;
  const col={view:'CAN_VIEW',create:'CAN_CREATE',edit:'CAN_EDIT',cancel:'CAN_CANCEL'}[action]||'CAN_VIEW';
  return Number(r[col])!==0
}
function now(){return new Date().toISOString()}
function ymd(v){return String(v||now()).slice(0,10)}
function uuid(){return crypto.randomUUID()}
async function nextDocNo(db,prefix){
  const r=await db.batch([
    db.prepare('INSERT OR IGNORE INTO sequences(prefix,value) VALUES(?,0)').bind(prefix),
    db.prepare('UPDATE sequences SET value=value+1 WHERE prefix=?').bind(prefix),
    db.prepare('SELECT value FROM sequences WHERE prefix=?').bind(prefix)
  ]);
  const n=Number(r[2]?.results?.[0]?.value||0);
  const d=new Date(),yy=String(d.getFullYear()).slice(2),mm=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');
  return prefix+'-'+yy+mm+dd+'-'+String(n).padStart(4,'0')
}
async function audit(context,user,action,id,payload){
  try{
    await context.env.DB.prepare('INSERT INTO audit_log(AUDIT_ID,TIMESTAMP,USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID,OLD_VALUE_JSON,NEW_VALUE_JSON,DEVICE_INFO,IP_HASH) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .bind(uuid(),now(),user.uid,user.name||'',action,'DOCS',id,'',JSON.stringify(payload||{}),String(context.request.headers.get('user-agent')||'').slice(0,300),'').run()
  }catch{}
}
async function listSources(db){
  const dye=(await db.prepare(`
    SELECT d.DYE_PLAN_ID,MAX(d.ISSUE_DATE) ISSUE_DATE,d.DYE_VENDOR_ID,
      COALESCE(v.VENDOR_NAME,d.DYE_VENDOR_ID) VENDOR,
      GROUP_CONCAT(DISTINCT COALESCE(f.FABRIC_NAME,d.FABRIC_ID)) FABRIC,
      COUNT(DISTINCT d.DYE_BATCH_ID) BATCH_COUNT,COUNT(*) ROLL_COUNT,SUM(d.ISSUE_MTR) TOTAL_MTR
    FROM dye_jobs d
    LEFT JOIN vendors v ON v.VENDOR_ID=d.DYE_VENDOR_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=d.FABRIC_ID
    WHERE COALESCE(d.STATUS,'') NOT LIKE 'CANCELLED%' AND COALESCE(d.DYE_PLAN_ID,'')<>''
    GROUP BY d.DYE_PLAN_ID,d.DYE_VENDOR_ID
    ORDER BY MAX(d.ISSUE_DATE) DESC,d.DYE_PLAN_ID DESC LIMIT 250
  `).all()).results||[];
  const stitching=(await db.prepare(`
    SELECT s.CHALLAN_ID,s.ISSUE_DATE,s.STITCHING_VENDOR_ID,COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) VENDOR,
      s.PRODUCTION_BATCH_ID,COALESCE(st.STYLE_NAME,s.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,s.COLOR_ID) COLOR,
      COALESCE(f.FABRIC_NAME,p.FABRIC_ID) FABRIC,
      COALESCE(ca.CONSUMED_MTR,p.CONSUMED_MTR,p.ALLOCATED_MTR,0) FABRIC_QTY,
      COALESCE((SELECT SUM(QTY) FROM stitching_issue_lines l WHERE l.CHALLAN_ID=s.CHALLAN_ID),s.TOTAL_ISSUED,0) TOTAL_PCS
    FROM stitching_jobs s
    LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID
    LEFT JOIN production_batches p ON p.PRODUCTION_BATCH_ID=s.PRODUCTION_BATCH_ID
    LEFT JOIN production_cut_actuals ca ON ca.PRODUCTION_BATCH_ID=s.PRODUCTION_BATCH_ID AND COALESCE(ca.STATUS,'') NOT LIKE 'CANCELLED%'
    LEFT JOIN styles st ON st.STYLE_ID=s.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=s.COLOR_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=p.FABRIC_ID
    WHERE COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%'
    ORDER BY s.ISSUE_DATE DESC,s.CHALLAN_ID DESC LIMIT 350
  `).all()).results||[];
  return{dye,stitching}
}
async function dyePayload(db,planId){
  const rows=(await db.prepare(`
    SELECT d.DYE_PLAN_ID,d.DYE_BATCH_ID,d.ISSUE_DATE,d.DYE_VENDOR_ID,COALESCE(v.VENDOR_NAME,d.DYE_VENDOR_ID) VENDOR,
      d.ROLL_ID,d.VENDOR_ROLL_NO,COALESCE(f.FABRIC_NAME,d.FABRIC_ID) FABRIC,COALESCE(c.COLOR_NAME,d.COLOR_ID) COLOR,d.ISSUE_MTR
    FROM dye_jobs d
    LEFT JOIN vendors v ON v.VENDOR_ID=d.DYE_VENDOR_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=d.FABRIC_ID
    LEFT JOIN colors c ON c.COLOR_ID=d.COLOR_ID
    WHERE d.DYE_PLAN_ID=? AND COALESCE(d.STATUS,'') NOT LIKE 'CANCELLED%'
    ORDER BY d.DYE_BATCH_ID,d.ROLL_ID
  `).bind(planId).all()).results||[];
  if(!rows.length)throw Object.assign(new Error('Dye plan not found.'),{status:404});
  const h=rows[0];
  return{
    sourceId:planId,vendorId:h.DYE_VENDOR_ID,vendor:h.VENDOR,date:h.ISSUE_DATE,
    title:'Dye Process Challan',
    lines:rows.map(x=>({batchId:x.DYE_BATCH_ID,rollId:x.ROLL_ID,vendorRollNo:x.VENDOR_ROLL_NO,fabric:x.FABRIC,color:x.COLOR,mtr:Number(x.ISSUE_MTR||0)})),
    totalMtr:rows.reduce((s,x)=>s+Number(x.ISSUE_MTR||0),0)
  }
}
async function stitchOne(db,id){
  const h=await db.prepare(`
    SELECT s.*,COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) VENDOR,
      COALESCE(st.STYLE_NAME,s.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,s.COLOR_ID) COLOR,
      COALESCE(f.FABRIC_NAME,p.FABRIC_ID) FABRIC,
      COALESCE(ca.CONSUMED_MTR,p.CONSUMED_MTR,p.ALLOCATED_MTR,0) FABRIC_QTY
    FROM stitching_jobs s
    LEFT JOIN vendors v ON v.VENDOR_ID=s.STITCHING_VENDOR_ID
    LEFT JOIN production_batches p ON p.PRODUCTION_BATCH_ID=s.PRODUCTION_BATCH_ID
    LEFT JOIN production_cut_actuals ca ON ca.PRODUCTION_BATCH_ID=s.PRODUCTION_BATCH_ID AND COALESCE(ca.STATUS,'') NOT LIKE 'CANCELLED%'
    LEFT JOIN styles st ON st.STYLE_ID=s.STYLE_ID
    LEFT JOIN colors c ON c.COLOR_ID=s.COLOR_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=p.FABRIC_ID
    WHERE s.CHALLAN_ID=? AND COALESCE(s.STATUS,'') NOT LIKE 'CANCELLED%' LIMIT 1
  `).bind(id).first();
  if(!h)throw Object.assign(new Error('Stitching challan not found.'),{status:404});
  let sizes=(await db.prepare(`
    SELECT COALESCE(sz.SIZE_NAME,l.SIZE_ID) SIZE,l.QTY
    FROM stitching_issue_lines l LEFT JOIN sizes sz ON sz.SIZE_ID=l.SIZE_ID
    WHERE l.CHALLAN_ID=? ORDER BY COALESCE(sz.SORT_ORDER,999),COALESCE(sz.SIZE_NAME,l.SIZE_ID)
  `).bind(id).all()).results||[];
  if(!sizes.length){
    sizes=[['M',h.M_ISSUED],['L',h.L_ISSUED],['XL',h.XL_ISSUED],['2XL',h['2XL_ISSUED']],['3XL',h['3XL_ISSUED']],['OTHER',h.OTHER_ISSUED]]
      .filter(([,q])=>Number(q||0)>0).map(([SIZE,QTY])=>({SIZE,QTY}))
  }
  return{
    sourceId:id,vendorId:h.STITCHING_VENDOR_ID,vendor:h.VENDOR,date:h.ISSUE_DATE,
    productionBatchId:h.PRODUCTION_BATCH_ID,style:h.STYLE,color:h.COLOR,fabric:h.FABRIC,
    fabricQty:Number(h.FABRIC_QTY||0),sizes:sizes.map(x=>({size:x.SIZE,qty:Number(x.QTY||0)})),
    totalPcs:sizes.reduce((s,x)=>s+Number(x.QTY||0),0),notes:h.NOTES||''
  }
}
async function buildPayload(db,type,sourceIds,overrides={}){
  if(type==='DYE_CHALLAN')return dyePayload(db,String(sourceIds[0]||''));
  if(type==='STITCHING_CHALLAN'){
    const x=await stitchOne(db,String(sourceIds[0]||''));
    return{...x,title:'Stitching Issue Challan',fabricQty:Number(overrides.fabricQty??x.fabricQty),notes:String(overrides.notes??x.notes??'')}
  }
  if(type==='STICKER_SHEET'){
    const items=[];
    for(const id of sourceIds.slice(0,40)){
      const x=await stitchOne(db,String(id));
      const ov=overrides?.[id]||{};
      items.push({...x,fabricQty:Number(ov.fabricQty??x.fabricQty),notes:String(ov.notes??x.notes??'')})
    }
    if(!items.length)throw Object.assign(new Error('Select at least one stitching challan.'),{status:400});
    return{title:'Production Fabric Stickers',items}
  }
  throw Object.assign(new Error('Unknown document type.'),{status:400})
}
export async function onRequestGet(context){
  try{
    const user=await requireAuth(context);if(!context.env.DB)return json({error:'D1 unavailable.'},503);
    await ensureDocs(context.env.DB);
    const u=new URL(context.request.url),action=u.searchParams.get('action')||'home';
    if(action==='document'){
      const id=u.searchParams.get('id')||'';
      const r=await context.env.DB.prepare("SELECT * FROM docs_documents WHERE DOC_ID=?").bind(id).first();
      if(!r)return json({error:'Document not found.'},404);
      const perm=typePerm(r.DOC_TYPE);if(!await can(context,user,perm,'view'))return json({error:'Permission denied.'},403);
      return json({document:{...r,payload:JSON.parse(r.PAYLOAD_JSON||'{}')}})
    }
    const out={sources:{dye:[],stitching:[]},history:[]};
    const src=await listSources(context.env.DB);
    if(await can(context,user,'dye','view'))out.sources.dye=src.dye;
    if(await can(context,user,'stitching','view'))out.sources.stitching=src.stitching;
    const history=(await context.env.DB.prepare("SELECT DOC_ID,DOC_NO,DOC_TYPE,SOURCE_IDS,VENDOR_ID,DOC_DATE,NOTES,STATUS,PRINT_COUNT,CREATED_BY,CREATED_AT FROM docs_documents ORDER BY CREATED_AT DESC LIMIT 100").all()).results||[];
    out.history=history.filter(x=>user.admin||user.permissions?.[typePerm(x.DOC_TYPE)]);
    return json(out)
  }catch(e){return errorResponse(e)}
}
export async function onRequestPost(context){
  try{
    const user=await requireAuth(context);if(!context.env.DB)return json({error:'D1 unavailable.'},503);
    await ensureDocs(context.env.DB);
    const b=await readJson(context.request),action=String(b.action||'generate');
    if(action==='cancel'){
      const old=await context.env.DB.prepare("SELECT * FROM docs_documents WHERE DOC_ID=?").bind(String(b.docId||'')).first();
      if(!old)return json({error:'Document not found.'},404);
      const perm=typePerm(old.DOC_TYPE);if(!await can(context,user,perm,'cancel'))return json({error:'Cancel permission required.'},403);
      const reason=String(b.reason||'Cancelled by user').slice(0,300),t=now();
      await context.env.DB.prepare("UPDATE docs_documents SET STATUS='CANCELLED',NOTES=CASE WHEN NOTES='' THEN ? ELSE NOTES||' | '||? END,UPDATED_BY=?,UPDATED_AT=? WHERE DOC_ID=?")
        .bind('Cancelled: '+reason,'Cancelled: '+reason,user.uid,t,old.DOC_ID).run();
      await audit(context,user,'CANCEL_DOC',old.DOC_ID,{reason,docNo:old.DOC_NO});
      return json({cancelled:true})
    }
    if(action==='printed'){
      await context.env.DB.prepare("UPDATE docs_documents SET PRINT_COUNT=PRINT_COUNT+1,UPDATED_BY=?,UPDATED_AT=? WHERE DOC_ID=?").bind(user.uid,now(),String(b.docId||'')).run();
      return json({ok:true})
    }
    const type=String(b.docType||'').toUpperCase(),perm=typePerm(type);
    if(!['DYE_CHALLAN','STITCHING_CHALLAN','STICKER_SHEET'].includes(type))return json({error:'Unknown document type.'},400);
    if(!await can(context,user,perm,'create'))return json({error:'Create permission required.'},403);
    const sourceIds=Array.isArray(b.sourceIds)?b.sourceIds.map(String).filter(Boolean):[];
    if(!sourceIds.length)return json({error:'Select source record(s).'},400);
    const payload=await buildPayload(context.env.DB,type,sourceIds,b.overrides||{});
    const prefix=type==='DYE_CHALLAN'?'DYC':type==='STITCHING_CHALLAN'?'STC':'STK';
    const docNo=await nextDocNo(context.env.DB,prefix),docId=uuid(),t=now(),docDate=ymd(b.docDate||payload.date),notes=String(b.notes||payload.notes||'').slice(0,500);
    const vendorId=type==='STICKER_SHEET'?'':String(payload.vendorId||'');
    const snapshot={...payload,docNo,docDate,notes};
    await context.env.DB.prepare("INSERT INTO docs_documents(DOC_ID,DOC_NO,DOC_TYPE,SOURCE_IDS,VENDOR_ID,DOC_DATE,NOTES,PAYLOAD_JSON,STATUS,PRINT_COUNT,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(docId,docNo,type,JSON.stringify(sourceIds),vendorId,docDate,notes,JSON.stringify(snapshot),'ACTIVE',0,user.uid,t,user.uid,t).run();
    await audit(context,user,'CREATE_DOC',docId,{docNo,type,sourceIds});
    return json({document:{DOC_ID:docId,DOC_NO:docNo,DOC_TYPE:type,DOC_DATE:docDate,STATUS:'ACTIVE',payload:snapshot}})
  }catch(e){return errorResponse(e)}
}