import {json,errorResponse,readJson} from '../_lib/common.js';
import {requireAuth} from '../_lib/auth.js';

const CFG={
  dye:{perm:'dye',table:'dye_jobs',key:'DYE_BATCH_ID',module:'DYE'},
  stitching:{perm:'stitching',table:'stitching_jobs',key:'CHALLAN_ID',module:'STITCHING'},
  rework:{perm:'qc',table:'rework_jobs',key:'REWORK_ID',module:'REWORK'}
};

async function can(context,user,type,action='edit'){
  if(user.admin)return true;
  const cfg=CFG[type];
  if(!cfg||!user.permissions?.[cfg.perm])return false;
  const r=await context.env.DB.prepare(
    'SELECT CAN_VIEW,CAN_EDIT FROM user_action_permissions WHERE USER_ID=? AND MODULE=?'
  ).bind(user.uid,cfg.perm).first();
  if(!r)return true;
  return Number(action==='view'?r.CAN_VIEW:r.CAN_EDIT)!==0;
}

async function exists(context,cfg,id){
  const r=await context.env.DB.prepare(
    'SELECT 1 ok FROM '+cfg.table+' WHERE '+cfg.key+'=? LIMIT 1'
  ).bind(id).first();
  return !!r;
}

async function audit(context,user,module,id,expectedDate,note){
  try{
    await context.env.DB.prepare(
      'INSERT INTO audit_log(AUDIT_ID,TIMESTAMP,USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID,OLD_VALUE_JSON,NEW_VALUE_JSON,DEVICE_INFO,IP_HASH) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(
      crypto.randomUUID(),new Date().toISOString(),user.uid,user.name||'',
      'SET_EXPECTED_DATE',module,id,'',
      JSON.stringify({expectedDate,note}),
      String(context.request.headers.get('user-agent')||'').slice(0,300),''
    ).run();
  }catch{}
}

export async function onRequestGet(context){
  try{
    const user=await requireAuth(context);
    if(!context.env.DB)return json({error:'D1 unavailable.'},503);
    const u=new URL(context.request.url);
    const type=String(u.searchParams.get('module')||'').toLowerCase();
    const recordId=String(u.searchParams.get('recordId')||'');
    const cfg=CFG[type];
    if(!cfg||!recordId)return json({error:'Module and record are required.'},400);
    if(!await can(context,user,type,'view'))return json({error:'Permission denied.'},403);
    if(!await exists(context,cfg,recordId))return json({error:'Record not found.'},404);
    const r=await context.env.DB.prepare(
      'SELECT EXPECTED_DATE,NOTE,UPDATED_BY,UPDATED_AT FROM record_expectations WHERE MODULE=? AND RECORD_ID=?'
    ).bind(cfg.module,recordId).first();
    return json({
      module:type,recordId,
      expectedDate:r?.EXPECTED_DATE||'',
      note:r?.NOTE||'',
      updatedBy:r?.UPDATED_BY||'',
      updatedAt:r?.UPDATED_AT||''
    });
  }catch(e){return errorResponse(e)}
}

export async function onRequestPost(context){
  try{
    const user=await requireAuth(context);
    if(!context.env.DB)return json({error:'D1 unavailable.'},503);
    const b=await readJson(context.request);
    const type=String(b.module||'').toLowerCase();
    const recordId=String(b.recordId||'');
    const cfg=CFG[type];
    if(!cfg||!recordId)return json({error:'Module and record are required.'},400);
    if(!await can(context,user,type,'edit'))return json({error:'Edit permission required.'},403);
    if(!await exists(context,cfg,recordId))return json({error:'Record not found.'},404);

    const expectedDate=String(b.expectedDate||'').slice(0,10);
    const note=String(b.note||'').slice(0,300);
    if(expectedDate&&!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate))
      return json({error:'Expected date must be YYYY-MM-DD.'},400);

    const t=new Date().toISOString();
    await context.env.DB.prepare(`
      INSERT INTO record_expectations(MODULE,RECORD_ID,EXPECTED_DATE,NOTE,UPDATED_BY,UPDATED_AT)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(MODULE,RECORD_ID) DO UPDATE SET
        EXPECTED_DATE=excluded.EXPECTED_DATE,
        NOTE=excluded.NOTE,
        UPDATED_BY=excluded.UPDATED_BY,
        UPDATED_AT=excluded.UPDATED_AT
    `).bind(cfg.module,recordId,expectedDate,note,user.uid,t).run();

    await audit(context,user,cfg.module,recordId,expectedDate,note);
    return json({saved:true,module:type,recordId,expectedDate,note});
  }catch(e){return errorResponse(e)}
}
