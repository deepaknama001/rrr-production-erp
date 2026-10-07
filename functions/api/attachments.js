import {json,errorResponse} from '../_lib/common.js';
import {requireAuth} from '../_lib/auth.js';

function modulePerm(type){
  return ({raw:'raw',dye:'dye',production:'production',stitching:'stitching',qc:'qc',handover:'qc'})[String(type||'').toLowerCase()]||''
}
async function can(context,user,type,action='view'){
  if(user.admin)return true;
  const mod=modulePerm(type);if(!mod||!user.permissions?.[mod])return false;
  const r=await context.env.DB.prepare('SELECT * FROM user_action_permissions WHERE USER_ID=? AND MODULE=?').bind(user.uid,mod).first();
  const col={view:'CAN_VIEW',create:'CAN_CREATE',edit:'CAN_EDIT',cancel:'CAN_CANCEL'}[action]||'CAN_VIEW';
  return !r||Number(r[col])!==0
}
function id(){return crypto.randomUUID()}
async function recordExists(context,module,recordId){
  const cfg={
    raw:['raw_inward','ROLL_ID'],
    dye:['dye_jobs','DYE_BATCH_ID'],
    production:['production_batches','PRODUCTION_BATCH_ID'],
    stitching:['stitching_jobs','CHALLAN_ID'],
    qc:['qc_events','QC_ID'],
    handover:['warehouse_handover','HANDOVER_ID']
  }[String(module||'').toLowerCase()];
  if(!cfg||!recordId)return false;
  const r=await context.env.DB.prepare('SELECT 1 ok FROM '+cfg[0]+' WHERE '+cfg[1]+'=? LIMIT 1').bind(String(recordId)).first();
  return !!r
}
function safeName(s){return String(s||'file').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,120)||'file'}
async function audit(context,user,action,module,recordId,newV){
  try{await context.env.DB.prepare('INSERT INTO audit_log(AUDIT_ID,TIMESTAMP,USER_ID,USER_NAME,ACTION,MODULE,RECORD_ID,OLD_VALUE_JSON,NEW_VALUE_JSON,DEVICE_INFO,IP_HASH) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id(),new Date().toISOString(),user.uid,user.name||'',action,module,recordId,'',JSON.stringify(newV||{}),String(context.request.headers.get('user-agent')||'').slice(0,300),'').run()}catch{}
}
export async function onRequestGet(context){
  try{
    const user=await requireAuth(context),u=new URL(context.request.url),module=String(u.searchParams.get('module')||''),recordId=String(u.searchParams.get('recordId')||''),fileId=String(u.searchParams.get('fileId')||'');
    if(!context.env.DB)return json({error:'D1 unavailable'},503);
    if(fileId){
      if(!context.env.ATTACHMENTS)return json({error:'Attachment storage is not configured.'},503);
      const meta=await context.env.DB.prepare("SELECT * FROM record_attachments WHERE FILE_ID=? AND STATUS='ACTIVE'").bind(fileId).first();if(!meta)return json({error:'File not found.'},404);
      if(!await can(context,user,meta.MODULE,'view'))return json({error:'Permission denied.'},403);
      const obj=await context.env.ATTACHMENTS.get(meta.R2_KEY);if(!obj)return json({error:'Stored file not found.'},404);
      return new Response(obj.body,{headers:{'content-type':meta.CONTENT_TYPE||'application/octet-stream','content-disposition':'inline; filename="'+safeName(meta.FILE_NAME)+'"','cache-control':'private, max-age=60'}})
    }
    if(!module||!recordId)return json({configured:!!context.env.ATTACHMENTS,items:[]});
    if(!await can(context,user,module,'view'))return json({error:'Permission denied.'},403);
    if(!await recordExists(context,module,recordId))return json({error:'Record not found.'},404);
    const rs=await context.env.DB.prepare("SELECT FILE_ID,MODULE,RECORD_ID,FILE_NAME,CONTENT_TYPE,SIZE_BYTES,CREATED_BY,CREATED_AT FROM record_attachments WHERE MODULE=? AND RECORD_ID=? AND STATUS='ACTIVE' ORDER BY CREATED_AT DESC").bind(module,recordId).all();
    return json({configured:!!context.env.ATTACHMENTS,items:rs.results||[]})
  }catch(e){return errorResponse(e)}
}
export async function onRequestPost(context){
  try{
    const user=await requireAuth(context);if(!context.env.DB)return json({error:'D1 unavailable'},503);if(!context.env.ATTACHMENTS)return json({error:'Attachment storage is not configured. Bind an R2 bucket as ATTACHMENTS.'},503);
    const fd=await context.request.formData(),module=String(fd.get('module')||''),recordId=String(fd.get('recordId')||''),file=fd.get('file');
    if(!module||!recordId||!(file instanceof File))return json({error:'Module, record and file are required.'},400);
    if(!await can(context,user,module,'edit'))return json({error:'Edit permission required.'},403);
    if(!await recordExists(context,module,recordId))return json({error:'Record not found.'},404);
    if(file.size<=0||file.size>10*1024*1024)return json({error:'File must be between 1 byte and 10 MB.'},400);
    const allowed=/^(image\/|application\/pdf$|text\/plain$|application\/vnd\.openxmlformats-officedocument\.|application\/msword$|application\/vnd\.ms-excel$)/i;
    if(file.type&&!allowed.test(file.type))return json({error:'Unsupported file type.'},400);
    const fileId=id(),key='rrr/'+module+'/'+recordId+'/'+fileId+'-'+safeName(file.name),t=new Date().toISOString();
    await context.env.ATTACHMENTS.put(key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'}});
    await context.env.DB.prepare('INSERT INTO record_attachments(FILE_ID,MODULE,RECORD_ID,FILE_NAME,CONTENT_TYPE,SIZE_BYTES,R2_KEY,STATUS,CREATED_BY,CREATED_AT,UPDATED_BY,UPDATED_AT) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(fileId,module,recordId,file.name,file.type||'',file.size,key,'ACTIVE',user.uid,t,user.uid,t).run();
    await audit(context,user,'ATTACH_FILE',module.toUpperCase(),recordId,{fileId,fileName:file.name,size:file.size});
    return json({saved:true,file:{FILE_ID:fileId,FILE_NAME:file.name,SIZE_BYTES:file.size,CONTENT_TYPE:file.type||'',CREATED_AT:t}})
  }catch(e){return errorResponse(e)}
}
export async function onRequestDelete(context){
  try{
    const user=await requireAuth(context),u=new URL(context.request.url),fileId=String(u.searchParams.get('fileId')||'');if(!fileId)return json({error:'File ID required.'},400);
    const meta=await context.env.DB.prepare("SELECT * FROM record_attachments WHERE FILE_ID=? AND STATUS='ACTIVE'").bind(fileId).first();if(!meta)return json({error:'File not found.'},404);
    if(!await can(context,user,meta.MODULE,'edit'))return json({error:'Edit permission required.'},403);
    if(context.env.ATTACHMENTS)await context.env.ATTACHMENTS.delete(meta.R2_KEY);
    await context.env.DB.prepare("UPDATE record_attachments SET STATUS='DELETED',UPDATED_BY=?,UPDATED_AT=? WHERE FILE_ID=?").bind(user.uid,new Date().toISOString(),fileId).run();
    await audit(context,user,'DELETE_FILE',meta.MODULE.toUpperCase(),meta.RECORD_ID,{fileId,fileName:meta.FILE_NAME});
    return json({deleted:true})
  }catch(e){return errorResponse(e)}
}
