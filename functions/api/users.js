import {json,readJson,errorResponse} from '../_lib/common.js';
import {requireAuth} from '../_lib/auth.js';
import {listUsersD1,saveUserD1} from '../_lib/d1.js';
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
    const r=await saveUserD1(context.env,{...b,actorUserId:actor.uid});
    return json({saved:true,user:r.user,backend:'D1'});
  }catch(e){return errorResponse(e)}
}