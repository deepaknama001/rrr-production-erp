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
const DOC_SETTINGS_KEY='DOCS:COMPANY';
async function getCompany(db){
  const r=await db.prepare('SELECT VALUE FROM settings WHERE KEY=?').bind(DOC_SETTINGS_KEY).first();
  let x={};try{x=JSON.parse(r?.VALUE||'{}')}catch{}
  return{
    name:String(x.name||'RARE RICH RIGHT (RRR)'),
    address:String(x.address||''),
    phone:String(x.phone||''),
    gst:String(x.gst||''),
    email:String(x.email||''),
    footer:String(x.footer||'Material issued for processing / job work only.')
  }
}
async function saveCompany(db,x){
  const v={
    name:String(x?.name||'').slice(0,120),
    address:String(x?.address||'').slice(0,300),
    phone:String(x?.phone||'').slice(0,80),
    gst:String(x?.gst||'').slice(0,80),
    email:String(x?.email||'').slice(0,120),
    footer:String(x?.footer||'').slice(0,250)
  };
  await db.prepare("INSERT INTO settings(KEY,VALUE,UPDATED_AT) VALUES(?,?,?) ON CONFLICT(KEY) DO UPDATE SET VALUE=excluded.VALUE,UPDATED_AT=excluded.UPDATED_AT")
    .bind(DOC_SETTINGS_KEY,JSON.stringify(v),now()).run();
  return v
}
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
    SELECT s.CHALLAN_ID,s.ISSUE_DATE,s.CREATED_AT,s.STATUS,s.STITCHING_VENDOR_ID,COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) VENDOR,
      s.PRODUCTION_BATCH_ID,p.DYE_BATCH_ID,COALESCE(st.STYLE_NAME,s.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,s.COLOR_ID) COLOR,
      COALESCE(f.FABRIC_NAME,p.FABRIC_ID) FABRIC,
      COALESCE(NULLIF(ca.CONSUMED_MTR,0),NULLIF(p.CONSUMED_MTR,0),p.ALLOCATED_MTR,0) FABRIC_QTY,
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
    SELECT d.DYE_PLAN_ID,d.DYE_BATCH_ID,d.ISSUE_DATE,d.DYE_VENDOR_ID,
      COALESCE(v.VENDOR_NAME,d.DYE_VENDOR_ID) VENDOR,
      COALESCE(v.ADDRESS,'') VENDOR_ADDRESS,COALESCE(v.PHONE,'') VENDOR_PHONE,COALESCE(v.GST_REF,'') VENDOR_GST,
      d.ROLL_ID,COALESCE(NULLIF(d.VENDOR_ROLL_NO,''),r.VENDOR_ROLL_NO,'') VENDOR_ROLL_NO,
      COALESCE(f.FABRIC_NAME,d.FABRIC_ID) FABRIC,
      COALESCE(c.COLOR_NAME,d.COLOR_ID) COLOR,d.ISSUE_MTR,
      COALESCE(r.INWARD_MTR,0) ROLL_MTR
    FROM dye_jobs d
    LEFT JOIN vendors v ON v.VENDOR_ID=d.DYE_VENDOR_ID
    LEFT JOIN fabrics f ON f.FABRIC_ID=d.FABRIC_ID
    LEFT JOIN colors c ON c.COLOR_ID=d.COLOR_ID
    LEFT JOIN raw_inward r ON r.ROLL_ID=d.ROLL_ID
    WHERE d.DYE_PLAN_ID=? AND COALESCE(d.STATUS,'') NOT LIKE 'CANCELLED%'
    ORDER BY d.ROLL_ID,d.DYE_BATCH_ID
  `).bind(planId).all()).results||[];
  if(!rows.length)throw Object.assign(new Error('Dye plan not found.'),{status:404});
  const h=rows[0],rollMap=new Map(),planMap=new Map();
  for(const x of rows){
    const rk=String(x.ROLL_ID||x.VENDOR_ROLL_NO||'');
    if(!rollMap.has(rk))rollMap.set(rk,{
      vendorRollNo:String(x.VENDOR_ROLL_NO||''),
      fabric:String(x.FABRIC||''),
      rollMtr:Number(x.ROLL_MTR||0)
    });
    const pk=String(x.FABRIC||'')+'|'+String(x.COLOR||'');
    const old=planMap.get(pk)||{fabric:String(x.FABRIC||''),color:String(x.COLOR||''),mtr:0};
    old.mtr+=Number(x.ISSUE_MTR||0);planMap.set(pk,old)
  }
  const rolls=[...rollMap.values()],plan=[...planMap.values()].sort((a,b)=>a.fabric.localeCompare(b.fabric)||a.color.localeCompare(b.color));
  return{
    sourceId:planId,vendorId:h.DYE_VENDOR_ID,vendor:h.VENDOR,
    vendorAddress:h.VENDOR_ADDRESS||'',vendorPhone:h.VENDOR_PHONE||'',vendorGst:h.VENDOR_GST||'',
    date:h.ISSUE_DATE,title:'Dye Process Challan',
    rolls,plan,
    totalRollMtr:rolls.reduce((s,x)=>s+Number(x.rollMtr||0),0),
    totalPlanMtr:plan.reduce((s,x)=>s+Number(x.mtr||0),0)
  }
}
async function stitchOne(db,id){
  const h=await db.prepare(`
    SELECT s.*,COALESCE(v.VENDOR_NAME,s.STITCHING_VENDOR_ID) VENDOR,
      COALESCE(v.ADDRESS,'') VENDOR_ADDRESS,COALESCE(v.PHONE,'') VENDOR_PHONE,COALESCE(v.GST_REF,'') VENDOR_GST,
      COALESCE(st.STYLE_NAME,s.STYLE_ID) STYLE,COALESCE(c.COLOR_NAME,s.COLOR_ID) COLOR,
      COALESCE(f.FABRIC_NAME,p.FABRIC_ID) FABRIC,
      COALESCE(NULLIF(ca.CONSUMED_MTR,0),NULLIF(p.CONSUMED_MTR,0),p.ALLOCATED_MTR,0) FABRIC_QTY
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
    sourceId:id,vendorId:h.STITCHING_VENDOR_ID,vendor:h.VENDOR,vendorAddress:h.VENDOR_ADDRESS||'',vendorPhone:h.VENDOR_PHONE||'',vendorGst:h.VENDOR_GST||'',date:h.ISSUE_DATE,createdAt:h.CREATED_AT||'',status:h.STATUS||'',
    productionBatchId:h.PRODUCTION_BATCH_ID,style:h.STYLE,color:h.COLOR,fabric:h.FABRIC,
    fabricQty:Number(h.FABRIC_QTY||0),sizes:sizes.map(x=>({size:x.SIZE,qty:Number(x.QTY||0)})),
    totalPcs:sizes.reduce((s,x)=>s+Number(x.QTY||0),0),notes:h.NOTES||''
  }
}
async function buildPayload(db,type,sourceIds,overrides={}){
  if(type==='DYE_CHALLAN'){
    const plans=[];
    for(const id of sourceIds.slice(0,20))plans.push(await dyePayload(db,String(id)));
    if(!plans.length)throw Object.assign(new Error('Select at least one dye plan.'),{status:400});
    const first=plans[0],vendorId=String(first.vendorId||'');
    if(plans.some(x=>String(x.vendorId||'')!==vendorId))throw Object.assign(new Error('Selected dye plans must belong to the same dye vendor.'),{status:409});
    const rollMap=new Map(),planMap=new Map();
    for(const p of plans){
      for(const r of p.rolls||[]){
        const k=String(r.vendorRollNo||'')+'|'+String(r.fabric||'')+'|'+String(r.rollMtr||0);
        if(!rollMap.has(k))rollMap.set(k,{...r})
      }
      for(const x of p.plan||[]){
        const k=String(x.fabric||'')+'|'+String(x.color||'');
        const old=planMap.get(k)||{fabric:x.fabric||'',color:x.color||'',mtr:0};
        old.mtr+=Number(x.mtr||0);planMap.set(k,old)
      }
    }
    const rolls=[...rollMap.values()],plan=[...planMap.values()];
    return{
      title:'Dye Process Challan',
      sourceId:plans.map(x=>x.sourceId).join(', '),sourceIds:plans.map(x=>x.sourceId),
      vendorId:first.vendorId,vendor:first.vendor,vendorAddress:first.vendorAddress,vendorPhone:first.vendorPhone,vendorGst:first.vendorGst,
      date:first.date,rolls,plan,
      totalRollMtr:rolls.reduce((s,x)=>s+Number(x.rollMtr||0),0),
      totalPlanMtr:plan.reduce((s,x)=>s+Number(x.mtr||0),0)
    }
  }
  if(type==='STITCHING_CHALLAN'){
    const items=[];
    for(const id of sourceIds.slice(0,60))items.push(await stitchOne(db,String(id)));
    if(!items.length)throw Object.assign(new Error('Select a Cutting & Stitching issue batch.'),{status:400});
    const first=items[0],vendorId=String(first.vendorId||'');
    if(items.some(x=>String(x.vendorId||'')!==vendorId))throw Object.assign(new Error('Selected issue batches must belong to the same vendor.'),{status:409});
    return{
      title:'Cutting & Stitching Issue Challan',
      vendorId:first.vendorId,vendor:first.vendor,vendorAddress:first.vendorAddress,vendorPhone:first.vendorPhone,vendorGst:first.vendorGst,
      date:first.date,items,
      totalFabricMtr:items.reduce((s,x)=>s+Number(x.fabricQty||0),0),
      totalPcs:items.reduce((s,x)=>s+Number(x.totalPcs||0),0),
      notes:String(overrides.notes??'')
    }
  }
  if(type==='STICKER_SHEET'){
    const items=[];
    for(const id of sourceIds.slice(0,30)){
      const doc=await db.prepare("SELECT DOC_ID,DOC_NO,PAYLOAD_JSON,STATUS FROM docs_documents WHERE DOC_ID=? AND DOC_TYPE='STITCHING_CHALLAN'").bind(String(id)).first();
      if(doc){
        if(String(doc.STATUS||'').toUpperCase()==='CANCELLED')throw Object.assign(new Error('Cancelled stitching challan '+doc.DOC_NO+' cannot generate stickers.'),{status:409});
        let p={};try{p=JSON.parse(doc.PAYLOAD_JSON||'{}')}catch{}
        for(const x of p.items||[])items.push({...x,sourceId:doc.DOC_NO,sourceDocId:doc.DOC_ID,sourceDocNo:doc.DOC_NO,notes:String(x.notes||p.notes||'')});
        continue
      }
      const x=await stitchOne(db,String(id)),ov=overrides?.[id]||{};
      items.push({...x,fabricQty:Number(ov.fabricQty??x.fabricQty),notes:String(ov.notes??x.notes??'')})
    }
    if(!items.length)throw Object.assign(new Error('Select at least one generated stitching challan.'),{status:400});
    return{title:'Production Fabric Stickers',items}
  }
  throw Object.assign(new Error('Unknown document type.'),{status:400})
}
export async function onRequestGet(context){
  try{
    const user=await requireAuth(context);if(!context.env.DB)return json({error:'D1 unavailable.'},503);
    await ensureDocs(context.env.DB);
    const u=new URL(context.request.url),action=u.searchParams.get('action')||'home';
    if(action==='settings')return json({company:await getCompany(context.env.DB)});
    if(action==='history'){
      const type=String(u.searchParams.get('type')||'').toUpperCase();
      const q=type
        ? context.env.DB.prepare("SELECT d.DOC_ID,d.DOC_NO,d.DOC_TYPE,d.SOURCE_IDS,d.VENDOR_ID,COALESCE(v.VENDOR_NAME,d.VENDOR_ID) VENDOR,d.DOC_DATE,d.NOTES,d.STATUS,d.PRINT_COUNT,d.CREATED_BY,d.CREATED_AT FROM docs_documents d LEFT JOIN vendors v ON v.VENDOR_ID=d.VENDOR_ID WHERE d.DOC_TYPE=? ORDER BY d.CREATED_AT DESC LIMIT 500").bind(type)
        : context.env.DB.prepare("SELECT d.DOC_ID,d.DOC_NO,d.DOC_TYPE,d.SOURCE_IDS,d.VENDOR_ID,COALESCE(v.VENDOR_NAME,d.VENDOR_ID) VENDOR,d.DOC_DATE,d.NOTES,d.STATUS,d.PRINT_COUNT,d.CREATED_BY,d.CREATED_AT FROM docs_documents d LEFT JOIN vendors v ON v.VENDOR_ID=d.VENDOR_ID ORDER BY d.CREATED_AT DESC LIMIT 500");
      const rows=(await q.all()).results||[];
      return json({items:rows.filter(x=>user.admin||user.permissions?.[typePerm(x.DOC_TYPE)])})
    }
    if(action==='document'){
      const id=u.searchParams.get('id')||'';
      const r=await context.env.DB.prepare("SELECT * FROM docs_documents WHERE DOC_ID=?").bind(id).first();
      if(!r)return json({error:'Document not found.'},404);
      const perm=typePerm(r.DOC_TYPE);if(!await can(context,user,perm,'view'))return json({error:'Permission denied.'},403);
      return json({document:{...r,payload:JSON.parse(r.PAYLOAD_JSON||'{}')}})
    }
    const out={sources:{dye:[],stitching:[]},history:[],company:await getCompany(context.env.DB)};
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
    if(action==='save_settings'){
      if(!user.admin)return json({error:'Admin permission required.'},403);
      const company=await saveCompany(context.env.DB,b.company||{});
      await audit(context,user,'SAVE_DOC_SETTINGS','DOCS:COMPANY',company);
      return json({saved:true,company})
    }
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
    const snapshot={...payload,company:await getCompany(context.env.DB),docNo,docDate,notes};
    await context.env.DB.prepare("INSERT INTO docs_documents(DOC_ID,DOC_NO,DOC_TYPE,SOURCE_IDS,VENDOR_ID,DOC_DATE,NOTES,PAYLOAD_JSON,STATUS,PRINT_COUNT,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(docId,docNo,type,JSON.stringify(sourceIds),vendorId,docDate,notes,JSON.stringify(snapshot),'ACTIVE',0,user.uid,t,user.uid,t).run();
    await audit(context,user,'CREATE_DOC',docId,{docNo,type,sourceIds});
    return json({document:{DOC_ID:docId,DOC_NO:docNo,DOC_TYPE:type,DOC_DATE:docDate,STATUS:'ACTIVE',payload:snapshot}})
  }catch(e){return errorResponse(e)}
}