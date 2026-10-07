import {json,readJson,errorResponse} from '../_lib/common.js';
import {requireAuth} from '../_lib/auth.js';
import {getDataD1,saveRecordD1} from '../_lib/d1.js';
export async function onRequestGet(context){
  try{
    if(!context.env.DB)return json({error:'D1 database binding is unavailable.'},503);
    const actor=await requireAuth(context);
    const url=new URL(context.request.url),module=url.searchParams.get('module')||'dashboard',id=url.searchParams.get('id')||'',type=url.searchParams.get('type')||'';
    const r=await getDataD1(context.env,{module,id,type,actorUserId:actor.uid});
    return json({...r,actor,backend:'D1'});
  }catch(e){return errorResponse(e)}
}
export async function onRequestPost(context){
  try{
    if(!context.env.DB)return json({error:'D1 database binding is unavailable.'},503);
    const actor=await requireAuth(context),b=await readJson(context.request);
    const payload={module:String(b.module||''),record:b.record||{},requestId:String(b.requestId||''),actorUserId:actor.uid};
    const r=await saveRecordD1(context.env,payload);
    return json({...r,backend:'D1'});
  }catch(e){return errorResponse(e)}
}