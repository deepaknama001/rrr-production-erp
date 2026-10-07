import {json,readJson,errorResponse} from '../_lib/common.js';
import {requireAuth} from '../_lib/auth.js';
import {listUsersD1,saveUserD1} from '../_lib/d1.js';
async function meta(req){const ua=String(req.headers.get('user-agent')||'').slice(0,300),ip=String(req.headers.get('cf-connecting-ip')||'');let ipHash='';if(ip){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));ipHash=[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('')}return{device:ua,ipHash}}
export async function onRequestGet(context){
  try{
    if(!context.env.DB)return json({error:'D1 database binding is unavailable.'},503);
    const actor=await requireAuth(context,true);
    const r=await listUsersD1(context.env,actor.uid);
    return json({items:r.items||[],backend:'D1'});
  }catch(e){return errorResponse(e)}
}
export async function onRequestPost(context){
  try{
    if(!context.env.DB)return json({error:'D1 database binding is unavailable.'},503);
    const actor=await requireAuth(context,true),b=await readJson(context.request);
    const r=await saveUserD1(context.env,{...b,actorUserId:actor.uid,auditMeta:await meta(context.request)});
    return json({saved:true,user:r.user,backend:'D1'});
  }catch(e){return errorResponse(e)}
}