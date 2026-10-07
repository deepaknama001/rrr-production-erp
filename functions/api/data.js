import {json,readJson,errorResponse} from '../_lib/common.js';
import {requireAuth} from '../_lib/auth.js';
import {getDataD1,saveRecordD1} from '../_lib/d1.js';
async function meta(req){const ua=String(req.headers.get('user-agent')||'').slice(0,300),ip=String(req.headers.get('cf-connecting-ip')||'');let ipHash='';if(ip){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));ipHash=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}return{device:ua,ipHash}}
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
    const payload={module:String(b.module||''),record:b.record||{},requestId:String(b.requestId||''),actorUserId:actor.uid,auditMeta:await meta(context.request)};
    const r=await saveRecordD1(context.env,payload);
    return json({...r,backend:'D1'});
  }catch(e){return errorResponse(e)}
}